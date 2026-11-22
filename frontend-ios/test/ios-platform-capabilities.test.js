import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Capacitor } from "@capacitor/core";
import { openNeteasePlayback, playNeteaseSilent } from "../src/netease-playback.js";

test("iOS missing Android playback plugin returns unsupported without invoking it", async t => {
  t.mock.method(Capacitor, "isNativePlatform", () => true);
  t.mock.method(Capacitor, "getPlatform", () => "ios");
  t.mock.method(Capacitor, "isPluginAvailable", () => false);
  await assert.rejects(openNeteasePlayback("song", "123"), { code: "music_native_unsupported" });
  await assert.rejects(playNeteaseSilent("song", "123"), { code: "music_native_unsupported" });
});

for (const platform of ["ios", "android", "web"]) test(`compatibility marks only actual Android (${platform})`, async t => {
  t.mock.method(Capacitor, "isNativePlatform", () => platform !== "web");
  t.mock.method(Capacitor, "getPlatform", () => platform);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  let nativeTimers = 0, sharedListeners = 0;
  const root = { dataset: {}, style: { setProperty() {} }, classList: { add() {} } };
  globalThis.window = { innerHeight: 844, addEventListener() { sharedListeners++; }, setTimeout() { nativeTimers++; } };
  globalThis.document = { documentElement: root, addEventListener() {} };
  try {
    const { installAndroidCompatibility } = await import(`../src/android-compat.js?platform-fixture=${platform}`);
    installAndroidCompatibility();
    assert.equal(root.dataset.dengtaAndroid, platform === "android" ? "true" : undefined);
    assert.equal(nativeTimers, platform === "android" ? 1 : 0);
    assert.ok(sharedListeners > 0, "shared viewport and touch adaptation remains available");
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test("native configuration has no plaintext transport, fake team, APNs or HTTP proxy switch", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
  assert.equal(config.appId, "home.dengta.app"); assert.equal(config.ios.loggingBehavior, "none");
  assert.equal(config.server.cleartext, false); assert.notEqual(config.plugins?.CapacitorHttp?.enabled, true);
  const project = fs.readFileSync(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  for (const source of ["DengTaKeychainStore.swift", "DengTaKeychainPlugin.swift", "DengTaBridgeViewController.swift"]) assert.ok(project.includes(`${source} in Sources`));
  assert.doesNotMatch(project, /DENGTACI00|DEVELOPMENT_TEAM\s*=|aps-environment|keychain-access-groups/);
  const spm = fs.readFileSync(new URL("../ios/App/CapApp-SPM/Package.swift", import.meta.url), "utf8");
  assert.match(spm, /exact: "8\.4\.3"/); assert.doesNotMatch(spm, /path: "[^"\n]*\\/);
});
