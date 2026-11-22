// These small standard APIs arrived after the supported iOS 15.0 floor.
// Install before app imports, retaining the browser's implementation when present.
export function installWebCompatibility(runtime = globalThis) {
  if (typeof runtime.Object.hasOwn !== "function") {
    Object.defineProperty(runtime.Object, "hasOwn", {
      configurable: true,
      writable: true,
      value(object, key) { return Object.prototype.hasOwnProperty.call(object, key); },
    });
  }
  const signal = runtime.AbortSignal?.prototype;
  if (signal && typeof signal.throwIfAborted !== "function") {
    Object.defineProperty(signal, "throwIfAborted", {
      configurable: true,
      writable: true,
      value() {
        if (!this.aborted) return;
        if (this.reason !== undefined) throw this.reason;
        throw new runtime.DOMException("The operation was aborted.", "AbortError");
      },
    });
  }
}

if (typeof window !== "undefined") installWebCompatibility();
