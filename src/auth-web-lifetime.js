import { IOS_AUTH_STORAGE_KEYS } from "./auth-keychain-storage.js";

export const AUTH_WEB_LIFETIME_KEY = "dengta_home_auth_v1:lifetime";
const LOCK_NAME = "dengta-home-auth-lifetime-v1";
const valid = value => /^(active|retiring|retired):[a-f0-9-]{36}$/i.test(value || "");
const failure = code => Object.assign(new Error("登录存储暂不可用，请重试。"), { code });

/** Real Web localStorage only. A nonsecret epoch and one origin-wide Web Lock
 * fence old refresh writes even before a peer receives the storage event.
 * Native stores retain their own revocable lease without this Web protocol. */
export async function createWebAuthLifetime({ storage, windowObject } = {}) {
  let locks, randomUUID;
  try {
    if (!windowObject || windowObject.localStorage !== storage) return null;
    locks = windowObject.navigator?.locks;
    randomUUID = windowObject.crypto?.randomUUID?.bind(windowObject.crypto);
  } catch { return null; }
  if (typeof locks?.request !== "function" || !randomUUID) return null;
  const locked = operation => locks.request(LOCK_NAME, { mode: "exclusive" }, operation).catch(error => {
    throw failure(["auth_storage_retired", "auth_storage_clear_failed", "auth_storage_write_failed"].includes(error?.code)
      ? error.code : "auth_storage_unavailable");
  });
  const read = () => storage.getItem(AUTH_WEB_LIFETIME_KEY);
  const write = value => {
    storage.setItem(AUTH_WEB_LIFETIME_KEY, value);
    if (read() !== value) throw failure("auth_storage_write_failed");
  };
  const clearKeys = () => {
    let failed = false;
    for (const key of IOS_AUTH_STORAGE_KEYS) {
      try { storage.removeItem(key); if (storage.getItem(key) !== null) failed = true; }
      catch { failed = true; }
    }
    if (failed) throw failure("auth_storage_clear_failed");
  };
  let epoch;
  await locked(() => {
    let current = read();
    // Continue a previously requested exit before any other tab can restore.
    if (valid(current) && current.startsWith("retiring:")) {
      clearKeys(); write(current.replace("retiring:", "retired:"));
      current = read();
    }
    if (!valid(current) || !current.startsWith("active:")) {
      current = `active:${randomUUID()}`; write(current);
    }
    epoch = current;
  });
  let retiredMarker = null;
  let sdkRemoved = false;
  const retire = () => {
    if (!retiredMarker) retiredMarker = `retiring:${randomUUID()}`;
    write(retiredMarker);
    clearKeys();
    write(retiredMarker.replace("retiring:", "retired:"));
  };
  const identity = value => {
    try { return JSON.parse(value)?.user?.id || null; } catch { return null; }
  };
  return Object.freeze({
    isCurrent: ({ requireSession = false } = {}) => locked(() => {
      if (read() !== epoch) return false;
      if (requireSession && storage.getItem(IOS_AUTH_STORAGE_KEYS[0]) === null) {
        // Covers real localStorage removals outside the SDK lease as well.
        // Check and fence under one lock so a newer login is never cleared.
        retire();
        return false;
      }
      return true;
    }),
    run: operation => locked(() => {
      if (read() !== epoch) throw failure("auth_storage_retired");
      return operation();
    }),
    set: (key, value, operation) => locked(() => {
      if (read() !== epoch) throw failure("auth_storage_retired");
      const changedIdentity = key === IOS_AUTH_STORAGE_KEYS[0] && identity(value) &&
        identity(value) !== identity(storage.getItem(key));
      try {
        const result = operation();
        // Also covers a Web implicit/PKCE callback and a stale anonymous tab
        // signing in while another tab has already committed an account.
        if (changedIdentity) { const next = `active:${randomUUID()}`; write(next); epoch = next; }
        return result;
      } catch {
        retire();
        throw failure("auth_storage_write_failed");
      }
    }),
    matchesSession: candidate => locked(() => {
      if (read() !== epoch) return false;
      let stored;
      try { stored = JSON.parse(storage.getItem(IOS_AUTH_STORAGE_KEYS[0])); } catch { return false; }
      if (!candidate) return stored === null;
      return Boolean(stored && candidate.user?.id === stored.user?.id &&
        candidate.access_token === stored.access_token && candidate.refresh_token === stored.refresh_token);
    }),
    remove: (key, operation) => locked(() => {
      // GoTrue removes three keys before emitting SIGNED_OUT. Complete those
      // tail calls without touching a later account, after the main key has
      // already atomically fenced every peer's old refresh lease.
      if (sdkRemoved) return;
      if (read() !== epoch) throw failure("auth_storage_retired");
      if (key !== IOS_AUTH_STORAGE_KEYS[0]) return operation();
      retire();
      sdkRemoved = true;
    }),
    clear: operation => locked(async () => {
      const current = read();
      // An old lease must never delete a newer identity's persistence.
      if (current !== epoch && current !== retiredMarker) return;
      if (!retiredMarker) { retiredMarker = `retiring:${randomUUID()}`; write(retiredMarker); }
      await operation();
      write(retiredMarker.replace("retiring:", "retired:"));
    }),
  });
}
