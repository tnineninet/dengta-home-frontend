import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectMachO, inspectDeviceApp, validateDevicePlist, externalNewPath, nativeToolEnvironment, publishStagedPackage, packageDeviceApp } from "../scripts/ios-device-package.mjs";
import { buildDevice, deviceBuildEnvironment } from "../scripts/ios-device-build.mjs";

function binary({ platform = 2, cpu = 0x0100000c, fileType = 2, encrypted = false } = {}) {
  const b = Buffer.alloc(80);
  [0xfeedfacf, cpu, 0, fileType, 2, 48, 0, 0].forEach((value, i) => b.writeUInt32LE(value, i * 4));
  [0x32, 24, platform, 0x000f0000, 0x001a0500, 0, 0x2c, 24, 0, 0, encrypted ? 1 : 0, 0]
    .forEach((value, i) => b.writeUInt32LE(value, 32 + i * 4));
  return b;
}
const plist = { CFBundleIdentifier: "home.dengta.app", CFBundlePackageType: "APPL", CFBundleSupportedPlatforms: ["iPhoneOS"],
  DTPlatformName: "iphoneos", DTSDKName: "iphoneos26.5", CFBundleExecutable: "App", CAPACITOR_DEBUG: "0", CFBundleShortVersionString: "2.13.43", CFBundleVersion: "1" };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-package-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, "App.app"); fs.mkdirSync(path.join(app, "public"), { recursive: true });
  fs.writeFileSync(path.join(app, "Info.plist"), JSON.stringify(plist));
  fs.writeFileSync(path.join(app, "App"), binary());
  fs.writeFileSync(path.join(app, "public", "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(app, "capacitor.config.json"), JSON.stringify({ appId: "home.dengta.app", ios: { loggingBehavior: "none" } }));
  return { root, app, inspect: () => inspectDeviceApp(app, { plistReader: file => JSON.parse(fs.readFileSync(file, "utf8")) }) };
}

test("accepts an unencrypted thin arm64 iPhoneOS executable", () => {
  assert.deepEqual(inspectMachO(binary()), { architecture: "arm64", platform: "iOS", platformId: 2, fileType: 2, minimumOS: "15.0.0", sdk: "26.5.0", encrypted: false });
});
test("arm64 Simulator, Catalyst, unknown platform, x86_64 and encryption are rejected", () => {
  for (const platform of [7, 6, 0]) assert.throws(() => inspectMachO(binary({ platform })), /platform/);
  assert.throws(() => inspectMachO(binary({ cpu: 0x01000007 })), /arm64/);
  assert.throws(() => inspectMachO(binary({ encrypted: true })), /Encrypted/);
});
test("universal binaries are refused, including a container with a Simulator slice", () => {
  const fat = Buffer.concat([Buffer.from("cafebabe00000002", "hex"), binary(), binary({ platform: 7 })]);
  assert.throws(() => inspectMachO(fat), /thin/);
});
test("rejects truncated headers and invalid command bounds instead of reading outside the buffer", () => {
  for (let n = 0; n < 80; n++) assert.throws(() => inspectMachO(binary().subarray(0, n)));
  for (const [offset, value] of [[16, 0], [16, 999999], [20, 0xffffffff], [36, 0], [36, 7], [36, 16], [36, 0xfffffff8], [52, 0xffffffff]]) {
    const b = binary(); b.writeUInt32LE(value, offset); assert.throws(() => inspectMachO(b));
  }
});
test("no platform command and duplicate platform commands are rejected", () => {
  const absent = binary(); absent.writeUInt32LE(0x24, 32);
  assert.throws(() => inspectMachO(absent), /Missing/);
  const duplicate = binary(); duplicate.writeUInt32LE(0x32, 56);
  assert.throws(() => inspectMachO(duplicate), /platform command/);
});
test("plist identity, real platform, executable path and debug state are checked", () => {
  assert.equal(validateDevicePlist(plist), "App");
  for (const update of [{ CFBundleIdentifier: "other.app" }, { CFBundleSupportedPlatforms: ["iPhoneSimulator"] },
    { DTPlatformName: "iphonesimulator" }, { DTSDKName: "iphonesimulator26.5" }, { CFBundleExecutable: "../App" },
    { CFBundleExecutable: ".." }, { CAPACITOR_DEBUG: "$(CAPACITOR_DEBUG)" }, { CAPACITOR_DEBUG: "1" }]) {
    assert.throws(() => validateDevicePlist({ ...plist, ...update }));
  }
});
test("inspects the app and all embedded frameworks, rejects a Simulator dependency", t => {
  const f = fixture(t), framework = path.join(f.app, "Frameworks", "Capacitor.framework"); fs.mkdirSync(framework, { recursive: true });
  fs.writeFileSync(path.join(framework, "Info.plist"), JSON.stringify({ CFBundleExecutable: "Capacitor" }));
  fs.writeFileSync(path.join(framework, "Capacitor"), binary({ fileType: 6 }));
  assert.equal(f.inspect().binaries.length, 2);
  fs.writeFileSync(path.join(framework, "Capacitor"), binary({ fileType: 6, platform: 7 }));
  assert.throws(f.inspect, /platform/);
  fs.unlinkSync(path.join(framework, "Capacitor")); assert.throws(f.inspect, /missing/);
});
test("rejects private files, server-loaded app configuration and missing web assets", t => {
  const f = fixture(t), privateFile = path.join(f.app, "signing.p12");
  fs.writeFileSync(privateFile, "synthetic"); assert.throws(f.inspect, /Private/); fs.unlinkSync(privateFile);
  fs.writeFileSync(path.join(f.app, "capacitor.config.json"), JSON.stringify({ appId: "home.dengta.app", server: { url: "http://localhost" }, ios: { loggingBehavior: "none" } }));
  assert.throws(f.inspect, /Capacitor/);
  fs.writeFileSync(path.join(f.app, "capacitor.config.json"), JSON.stringify({ appId: "home.dengta.app", ios: { loggingBehavior: "none" } }));
  fs.unlinkSync(path.join(f.app, "public", "index.html")); assert.throws(f.inspect, /entry/);
});
test("symbolic links are refused rather than copied out of the bundle", t => {
  const f = fixture(t), outside = path.join(f.root, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.app, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(f.inspect, /Symbolic/);
});
test("outputs cannot overwrite files or enter the source repository, including through a link", t => {
  const f = fixture(t), repo = path.join(f.root, "repo"); fs.mkdirSync(repo);
  assert.throws(() => externalNewPath(path.join(repo, "out.ipa"), repo), /outside/);
  assert.throws(() => externalNewPath(path.join(f.app, "App"), repo), /new absolute/);
  assert.throws(() => externalNewPath("relative.ipa", repo), /absolute/);
  const link = path.join(f.root, "alias"); fs.symlinkSync(repo, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => externalNewPath(path.join(link, "out.ipa"), repo), /outside/);
  assert.equal(externalNewPath(path.join(f.root, "fresh.ipa"), repo), path.join(fs.realpathSync(f.root), "fresh.ipa"));
});
test("build environment forwards only public auth configuration, not account/signing secrets", () => {
  const e = deviceBuildEnvironment({ PATH: "tools", HOME: "home", VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture_only_not_a_real_key",
    DENGTA_IOS_E2E_PASSWORD: "private-fixture", GITHUB_TOKEN: "private-fixture", VITE_OTHER_SECRET: "private-fixture", APPLE_PASSWORD: "private-fixture" });
  assert.equal(e.VITE_API_URL, "https://dengta-home-backend-rkmq.onrender.com");
  assert.equal(JSON.stringify(e).includes("private-fixture"), false);
  for (const update of [{ VITE_API_URL: "http://localhost" }, { VITE_PUBLIC_AUTH_REDIRECT_URL: "https://example.com" }, { VITE_SUPABASE_URL: "http://example.com" }, { VITE_SUPABASE_URL: "https://user:password@example.com" }]) {
    assert.throws(() => deviceBuildEnvironment({ ...e, ...update }));
  }
  for (const key of ["sb_secret_fixture_only_not_a_real_key", "invalid", `e30.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fixture`]) {
    assert.throws(() => deviceBuildEnvironment({ ...e, VITE_SUPABASE_ANON_KEY: key }), /privileged/);
  }
  assert.ok(deviceBuildEnvironment({ ...e, VITE_SUPABASE_ANON_KEY: `e30.${Buffer.from('{"role":"anon"}').toString("base64url")}.fixture` }));
  assert.deepEqual(nativeToolEnvironment({ PATH: "tools", HOME: "home", GITHUB_TOKEN: "private", DENGTA_IOS_E2E_PASSWORD: "private", APPLE_PASSWORD: "private", VITE_SUPABASE_ANON_KEY: "public" }), { PATH: "tools", HOME: "home" });
});
test("publication is exclusive and preparation failure never exposes a final package", t => {
  const f = fixture(t), target = path.join(f.root, "candidate.ipa");
  const prepare = directory => {
    assert.equal(fs.existsSync(target), false);
    const archive = path.join(directory, "candidate.ipa"); fs.writeFileSync(archive, "complete fixture archive");
    return { archive, receipt: { kind: "fixture" } };
  };
  assert.throws(() => publishStagedPackage(target, directory => { prepare(directory); throw new Error("validation-failed"); }), /validation-failed/);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(publishStagedPackage(target, prepare), { kind: "fixture", temporaryCleanupComplete: true });
  assert.equal(fs.readFileSync(target, "utf8"), "complete fixture archive");
  assert.throws(() => publishStagedPackage(target, directory => {
    const archive = path.join(directory, "candidate.ipa"); fs.writeFileSync(archive, "replacement"); return { archive, receipt: {} };
  }), /EEXIST/);
  assert.equal(fs.readFileSync(target, "utf8"), "complete fixture archive");
});
test("post-publication cleanup failure is reported without turning a valid package into a failed call", t => {
  const f = fixture(t), target = path.join(f.root, "candidate.ipa"), remove = fs.rmSync, warn = console.warn;
  try {
    fs.rmSync = (directory, options) => { if (path.basename(directory).startsWith(".dengta-device-stage-")) throw new Error("injected-cleanup-failure"); return remove(directory, options); };
    console.warn = () => {};
    const receipt = publishStagedPackage(target, directory => {
      const archive = path.join(directory, "candidate.ipa"); fs.writeFileSync(archive, "verified fixture"); return { archive, receipt: { kind: "fixture" } };
    });
    assert.equal(receipt.temporaryCleanupComplete, false);
    assert.equal(fs.readFileSync(target, "utf8"), "verified fixture");
  } finally { fs.rmSync = remove; console.warn = warn; }
});
test("Windows/Linux cannot create a fake native build or IPA", { skip: process.platform === "darwin" }, async t => {
  const f = fixture(t), output = path.join(f.root, "never-created");
  await assert.rejects(buildDevice({ outputDirectory: output, sourceSha: "a".repeat(40) }), /macOS/);
  assert.throws(() => packageDeviceApp({ appPath: f.app, ipaPath: output + ".ipa", sourceSha: "a".repeat(40), repositoryRoot: f.root }), /macOS/);
  assert.equal(fs.existsSync(output), false); assert.equal(fs.existsSync(output + ".ipa"), false);
});
