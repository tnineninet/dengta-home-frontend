import { IOS_AUTH_STORAGE_KEYS } from "./auth-keychain-storage.js";
import { AuthRetryableFetchError } from "@supabase/auth-js";

// GoTrue resolves recognized retryable errors to all refresh waiters. An
// ordinary Error instead rejects its internal Deferred with no guaranteed
// observer. Retain the SDK's name (its classifier checks that exact string).
// Our manager still treats a retired lease as permanently cancelled.
export class AuthStorageLeaseError extends AuthRetryableFetchError {
  constructor(code = "auth_storage_unavailable") {
    super("安全登录存储暂不可用，请解锁设备后重试。", 0);
    this.code = code;
  }
}

/**
 * Each SDK client gets its own revocable storage lease. Retirement fences old
 * refreshes immediately, then drains the operation already in progress before
 * clearing credentials. The next client must wait for this barrier to finish.
 */
export function createAuthStorageLease(storage, keys = IOS_AUTH_STORAGE_KEYS, { coordinator, sdkCompatibleReads = false } = {}) {
  if (storage === undefined || storage === null) return undefined;
  if (!["getItem", "setItem", "removeItem"].every(method => typeof storage[method] === "function")) {
    throw new AuthStorageLeaseError();
  }
  const authKeys = new Set(keys);
  let queue = Promise.resolve();
  let retired = false;
  let retirement = null;

  function assertActive() {
    if (retired) throw new AuthStorageLeaseError("auth_storage_retired");
  }

  function serialize(key, code, operation, action, storedValue) {
    if (!authKeys.has(key)) return Promise.reject(new AuthStorageLeaseError("auth_storage_invalid_key"));
    if (retired) return Promise.reject(new AuthStorageLeaseError("auth_storage_retired"));
    const result = queue.then(async () => {
      assertActive();
      const value = await (coordinator
        ? action === "remove" ? coordinator.remove(key, operation)
          : action === "set" ? coordinator.set(key, storedValue, operation) : coordinator.run(operation)
        : operation());
      assertActive();
      return value;
    }).catch(error => {
      // Storage providers can include credentials in messages or causes.
      throw new AuthStorageLeaseError(error instanceof AuthStorageLeaseError || error?.code === "auth_storage_retired" ? error.code : code);
    });
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    retire() {
      retired = true;
      return queue;
    },
    getItem(key) {
      const read = serialize(key, "auth_storage_read_failed", () => storage.getItem(key));
      // A disposed SDK's detached INITIAL_SESSION read has no public error
      // observer. Returning absence for retirement never exposes old tokens;
      // active-provider failures still reject and remain visible to callers.
      return sdkCompatibleReads ? read.catch(error => {
        if (error.code === "auth_storage_retired") return null;
        throw error;
      }) : read;
    },
    setItem(key, value) {
      return serialize(key, "auth_storage_write_failed", () => storage.setItem(key, value), "set", value);
    },
    removeItem(key) {
      return serialize(key, "auth_storage_remove_failed", () => storage.removeItem(key), "remove");
    },
    retireAndClear() {
      retired = true;
      if (retirement) return retirement;
      const clearStorage = async () => {
        try {
          if (typeof storage.retireAndClear === "function") {
            await storage.retireAndClear();
            return;
          }
          let failed = false;
          for (const key of authKeys) {
            try {
              await storage.removeItem(key);
              if (await storage.getItem(key) !== null) failed = true;
            } catch {
              failed = true;
            }
          }
          if (failed) throw new AuthStorageLeaseError("auth_storage_clear_failed");
        } catch {
          throw new AuthStorageLeaseError("auth_storage_clear_failed");
        }
      };
      const clear = queue.then(() => coordinator ? coordinator.clear(clearStorage) : clearStorage());
      retirement = clear;
      queue = clear.catch(() => {});
      void clear.catch(() => {
        // Keep the lease sealed, but permit explicit clearing after unlock.
        if (retirement === clear) retirement = null;
      });
      return clear;
    },
  });
}
