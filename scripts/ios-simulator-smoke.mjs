import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { validateKeychainReceipt, validateUiReceipt, mayCaptureAnonymousScreen } from "./ios-evidence-policy.mjs";

const [appArgument, outputArgument, sourceSha] = process.argv.slice(2);
if (process.platform !== "darwin" || !appArgument || !outputArgument || !/^[a-f0-9]{40}$/.test(sourceSha || "")) {
  throw new Error("Usage on macOS: node scripts/ios-simulator-smoke.mjs <App.app> <evidence-directory> <source-sha>");
}
const appPath = fs.realpathSync(appArgument), output = path.resolve(outputArgument);
fs.mkdirSync(output, { recursive: true });
const nonce = randomUUID().toUpperCase(), bundle = "home.dengta.app";
const manifest = { schemaVersion: 1, sourceSha, runNonce: nonce, build: false, launch: false, processAlive: false,
  keychain: false, loginReady: false, businessFlows: "not-exercised", keyboard: "not-exercised", steps: [] };
let createdDevice = "", container = "", uiReceipt = null;
const save = () => fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

function command(stage, executable, args, timeout = 60_000, required = true, log = true) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  const ok = !result.error && result.status === 0;
  manifest.steps.push({ stage, passed: ok, exitCode: result.status, timedOut: result.error?.code === "ETIMEDOUT" });
  if (log) fs.writeFileSync(path.join(output, `${stage}.log`), `${result.stdout || ""}${result.stderr || ""}`);
  save();
  if (!ok && required) throw new Error(`Simulator stage failed: ${stage}`);
  return result;
}

function readReceipt(file, validate) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(container, "tmp", file), "utf8"));
    const result = validate(raw, nonce);
    fs.writeFileSync(path.join(output, file), JSON.stringify(result.receipt, null, 2) + "\n");
    return result;
  } catch { return null; }
}

function captureScreenshot() {
  if (!createdDevice || !mayCaptureAnonymousScreen(uiReceipt)) return;
  const name = manifest.loginReady ? "login-ready.png" : "startup-failed.png";
  const result = command("screenshot", "xcrun", ["simctl", "io", createdDevice, "screenshot", "--type=png", path.join(output, name)], 30_000, false);
  if (result.status === 0) manifest.screenshot = { file: name, sha256: createHash("sha256").update(fs.readFileSync(path.join(output, name))).digest("hex") };
}

try {
  const info = JSON.parse(command("bundle-info", "plutil", ["-convert", "json", "-o", "-", path.join(appPath, "Info.plist")]).stdout);
  if (info.CFBundleIdentifier !== bundle || !info.CFBundleSupportedPlatforms?.includes("iPhoneSimulator")) throw new Error("Wrong bundle or Simulator platform.");
  manifest.build = true;
  command("signature-verify", "codesign", ["--verify", "--deep", "--strict", appPath]);
  command("signature-details", "codesign", ["--display", "--verbose=4", appPath]);
  command("signature-entitlements", "codesign", ["--display", "--entitlements", ":-", appPath], 30_000, false);
  const runtimes = JSON.parse(command("runtimes", "xcrun", ["simctl", "list", "runtimes", "--json"]).stdout).runtimes;
  const runtime = runtimes.filter(item => item.isAvailable && item.identifier.includes(".iOS-"))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error("No installed iOS Simulator runtime.");
  const types = JSON.parse(command("device-types", "xcrun", ["simctl", "list", "devicetypes", "--json"]).stdout).devicetypes;
  const phone = types.find(item => item.name === "iPhone 17") || types.filter(item => /^iPhone /.test(item.name)).at(-1);
  if (!phone) throw new Error("No installed iPhone device type.");
  manifest.runtime = { name: runtime.name, identifier: runtime.identifier, version: runtime.version };
  manifest.deviceType = { name: phone.name, identifier: phone.identifier };
  const created = command("create-device", "xcrun", ["simctl", "create", `DengTa CI ${nonce.slice(0, 8)}`, phone.identifier, runtime.identifier]).stdout.trim();
  if (!/^[A-F0-9-]{36}$/i.test(created)) throw new Error("Simulator returned an invalid device identifier.");
  createdDevice = created;
  manifest.device = createdDevice;
  command("boot", "xcrun", ["simctl", "boot", createdDevice]);
  command("boot-complete", "xcrun", ["simctl", "bootstatus", createdDevice, "-b"], 180_000);
  command("appearance", "xcrun", ["simctl", "ui", createdDevice, "appearance", "light"], 30_000, false);
  command("status-bar", "xcrun", ["simctl", "status_bar", createdDevice, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100"], 30_000, false);
  command("install", "xcrun", ["simctl", "install", createdDevice, appPath], 90_000);
  const launched = command("launch", "xcrun", ["simctl", "launch", "--terminate-running-process", createdDevice, bundle,
    "--dengta-ci-keychain-diagnostics", "--dengta-ci-run", nonce], 60_000).stdout.trim();
  const pid = Number(launched.match(/:\s*(\d+)\s*$/)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("No valid launch PID.");
  manifest.launch = true;
  container = command("app-container", "xcrun", ["simctl", "get_app_container", createdDevice, bundle, "data"]).stdout.trim();
  if (!path.isAbsolute(container) || !fs.statSync(container).isDirectory()) throw new Error("Invalid Simulator data container.");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const keychain = readReceipt("dengta-ci-keychain-diagnostics.json", validateKeychainReceipt);
    const ui = readReceipt("dengta-ci-ui-diagnostics.json", validateUiReceipt);
    manifest.keychain = keychain?.passed === true;
    manifest.loginReady = ui?.passed === true;
    if (ui) uiReceipt = ui.receipt;
    if (uiReceipt && ["authenticated", "recovery", "authenticating"].includes(uiReceipt.state)) throw new Error("Unexpected account state; screen capture refused.");
    if (manifest.keychain && manifest.loginReady) break;
    await pause(1000);
  }
  const processes = command("process-liveness", "xcrun", ["simctl", "spawn", createdDevice, "launchctl", "list"], 30_000, true, false).stdout;
  manifest.processAlive = processes.split("\n").some(line => new RegExp(`^\\s*${pid}\\s`).test(line) && line.includes(bundle));
  captureScreenshot();
  if (!manifest.keychain || !manifest.loginReady || !manifest.processAlive) throw new Error("Native Keychain/login readiness/process acceptance failed.");
  manifest.outcome = "startup-passed";
} catch (error) {
  manifest.outcome = "failed";
  // Every thrown message here is fixed by this script; no provider errors or
  // page content are emitted. Preserve allowlisted receipts if available.
  manifest.failure = error instanceof Error && /^(Simulator stage failed: [a-z-]+|Wrong bundle or Simulator platform\.|No installed iOS Simulator runtime\.|No installed iPhone device type\.|Simulator returned an invalid device identifier\.|No valid launch PID\.|Invalid Simulator data container\.|Unexpected account state; screen capture refused\.|Native Keychain\/login readiness\/process acceptance failed\.)$/.test(error.message)
    ? error.message : "Simulator smoke could not complete; inspect stage receipts.";
  if (container) {
    readReceipt("dengta-ci-keychain-diagnostics.json", validateKeychainReceipt);
    const ui = readReceipt("dengta-ci-ui-diagnostics.json", validateUiReceipt);
    uiReceipt = ui?.receipt || uiReceipt;
  }
  captureScreenshot();
  process.exitCode = 1;
} finally {
  if (createdDevice) {
    command("shutdown-created-device", "xcrun", ["simctl", "shutdown", createdDevice], 60_000, false);
    command("delete-created-device", "xcrun", ["simctl", "delete", createdDevice], 60_000, false);
  }
  save();
  console.log(JSON.stringify({ outcome: manifest.outcome, build: manifest.build, launch: manifest.launch,
    keychain: manifest.keychain, loginReady: manifest.loginReady, processAlive: manifest.processAlive }));
}
