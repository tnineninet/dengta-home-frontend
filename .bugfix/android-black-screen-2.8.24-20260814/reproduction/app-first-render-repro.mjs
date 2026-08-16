import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createStorage(entries = {}, { throwOnAccess = false } = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      if (throwOnAccess) throw new DOMException("storage denied", "SecurityError");
      return values.get(String(key)) ?? null;
    },
    setItem(key, value) {
      if (throwOnAccess) throw new DOMException("storage denied", "SecurityError");
      values.set(String(key), String(value));
    },
    removeItem(key) {
      if (throwOnAccess) throw new DOMException("storage denied", "SecurityError");
      values.delete(String(key));
    },
  };
}

function installAndroidGlobals(storage) {
  globalThis.localStorage = storage;
  globalThis.sessionStorage = createStorage();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.window = globalThis;
  globalThis.innerHeight = 800;
  globalThis.innerWidth = 400;
  globalThis.scrollY = 0;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.scrollTo = () => {};
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
    documentElement: {
      dataset: {},
      style: { setProperty() {}, removeProperty() {} },
    },
  };
}

const scenarios = [
  ["baseline", createStorage()],
  [
    "legacy-values",
    createStorage({
      "dengta.ui-theme.v1": "null",
      "dengta.chat-skin.v1": "[]",
      dengta_home_ambient_location_v1: "{bad-json",
      dengta_home_ambient_weather_v1: JSON.stringify({ weather: "legacy", storedAt: "old" }),
      dengta_companion_status_v1: JSON.stringify({ countdown: { endsAt: "not-a-date" } }),
    }),
  ],
  ["restricted-storage", createStorage({}, { throwOnAccess: true })],
];

const vite = await createServer({
  root: "E:\\chatgpt\\dengta-home-frontend",
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { default: App } = await vite.ssrLoadModule("/src/App.jsx");
  for (const [name, storage] of scenarios) {
    installAndroidGlobals(storage);
    let renderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(App, {
            accountScope: "legacy-user",
            companionScope: "legacy-companion",
            userName: "tester",
            visualPreview: true,
          }),
        );
      });
      console.log("[BUGFIX_REPRO_TRACE]", JSON.stringify({ scenario: name, rendered: true }));
    } catch (error) {
      console.log(
        "[BUGFIX_REPRO_TRACE]",
        JSON.stringify({
          scenario: name,
          rendered: false,
          errorName: error?.name || "Error",
          errorMessage: error?.message || "",
          stack: String(error?.stack || "").split("\n").slice(0, 6),
        }),
      );
    } finally {
      if (renderer) await act(async () => renderer.unmount());
    }
  }
} finally {
  await vite.close();
}
