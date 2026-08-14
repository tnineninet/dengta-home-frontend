const CHUNK_RECOVERY_KEY = "dengta:app-chunk-recovery";

export function reloadApplication() {
  globalThis.sessionStorage?.removeItem(CHUNK_RECOVERY_KEY);
  globalThis.location?.reload();
}

export function installChunkRecovery() {
  globalThis.addEventListener?.("vite:preloadError", (event) => {
    event.preventDefault?.();
    const storage = globalThis.sessionStorage;
    if (storage?.getItem(CHUNK_RECOVERY_KEY) === "attempted") return;
    storage?.setItem(CHUNK_RECOVERY_KEY, "attempted");
    globalThis.location?.reload();
  });
}

export function markAppLoaded() {
  globalThis.sessionStorage?.removeItem(CHUNK_RECOVERY_KEY);
}
