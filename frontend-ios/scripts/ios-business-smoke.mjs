import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { build } from "vite";
import { createBusinessFixture, BUSINESS_FIXTURE_IDENTITY } from "./ios-business-fixture.mjs";
import { createLiveGuard } from "./ios-business-live.mjs";
import { parseBusinessEvidence, runtimeXctestrun } from "./ios-business-policy.mjs";
import { validateUiReceipt } from "./ios-evidence-policy.mjs";

const [outputArgument, sourceSha] = process.argv.slice(2);
const mode = process.env.DENGTA_BUSINESS_MODE || "synthetic";
// The live UI's terminal-reply proof and cancellation recovery are not complete.
// Keep this path unavailable even if someone later configures account secrets.
if (mode === "live") {
  console.log(JSON.stringify({ mode: "live", outcome: "unavailable", reason: "live-driver-safety-incomplete" }));
  process.exit(1);
}
if (process.platform !== "darwin" || !outputArgument || !/^[a-f\d]{40}$/.test(sourceSha || "") || !["synthetic", "live"].includes(mode)) {
  throw new Error("Usage on macOS: DENGTA_BUSINESS_MODE=synthetic|live node scripts/ios-business-smoke.mjs <evidence-directory> <source-sha>");
}

// Account secrets are removed before Vite, Capacitor, or Xcode build subprocesses.
const liveIdentity = Object.fromEntries(["EMAIL", "PASSWORD", "USER_ID"].map(name => {
  const key = `DENGTA_IOS_E2E_${name}`, value = process.env[key] || "";
  delete process.env[key];
  return [name, value];
}));
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.resolve(outputArgument);
const tempRoot = process.env.RUNNER_TEMP || os.tmpdir();
const privateRoot = fs.mkdtempSync(path.join(tempRoot, "dengta-ios-business-private-"));
fs.chmodSync(privateRoot, 0o700);
const workspace = path.join(privateRoot, "work"), derived = path.join(privateRoot, "derived");
fs.mkdirSync(workspace); fs.mkdirSync(output, { recursive: true });
const nonce = randomUUID().toUpperCase(), bundle = "home.dengta.app";
const manifest = { schemaVersion: 1, sourceSha, runNonce: nonce, mode, outcome: "failed", steps: [] };
let device = "", fixture = null, guard = null, guardReady = false, currentStage = "setup", failed = false;
const save = () => fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

/** Never forward raw XCTest output to Actions. It can contain typed credentials. */
async function command(stage, executable, args, { timeout = 90_000, cwd = workspace, required = true } = {}) {
  currentStage = stage;
  console.log(`iOS business stage: ${stage}`);
  const started = Date.now();
  const rawPath = path.join(privateRoot, `${stage}.log`);
  const file = fs.openSync(rawPath, "w", 0o600);
  let text = "", timeoutHit = false;
  const result = await new Promise(resolve => {
    const child = spawn(executable, args, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const collect = bytes => {
      fs.writeSync(file, bytes);
      // Only receipt parsing and machine metadata need an in-memory copy.
      if (text.length < 12 * 1024 * 1024) text += bytes.toString("utf8");
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timeoutHit = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, timeout);
    child.once("error", () => { clearTimeout(timer); resolve({ code: null }); });
    child.once("close", code => { clearTimeout(timer); resolve({ code }); });
  });
  fs.closeSync(file);
  const passed = result.code === 0 && !timeoutHit;
  manifest.steps.push({ stage, passed, timedOut: timeoutHit, milliseconds: Date.now() - started }); save();
  if (mode === "synthetic" && ["build-for-testing", "business-xctest"].includes(stage)) {
    // This job has no real account credentials or production API configuration.
    fs.copyFileSync(rawPath, path.join(output, `${stage}-synthetic.log`));
  }
  if (!passed && required) throw new Error("business-stage-failed");
  return { passed, text: text.trim() };
}

function safeFixtureReceipt() {
  const value = fixture.snapshot();
  // snapshot() is constructed from counters/booleans only; do not export state.
  const expected = ["schemaVersion", "synthetic", "loopbackOnly", "counts", "observed", "violations"];
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key)) ||
      value.schemaVersion !== 1 || value.synthetic !== true || value.loopbackOnly !== true ||
      Object.values(value.counts).some(n => !Number.isInteger(n) || n < 0 || n > 10000) ||
      Object.values(value.observed).some(n => typeof n !== "boolean") ||
      Object.values(value.violations).some(n => !Number.isInteger(n) || n < 0 || n > 10000)) throw new Error("fixture-receipt-invalid");
  return value;
}

async function copySyntheticScreen(fileName) {
  if (mode !== "synthetic" || !device) return false;
  const result = await command("test-runner-container", "xcrun", ["simctl", "get_app_container", device, "home.dengta.app.uitests.xctrunner", "data"], { required: false });
  if (!result.passed || !path.isAbsolute(result.text)) return false;
  try {
    const png = fs.readFileSync(path.join(result.text, "tmp/dengta-ci-business.png"));
    if (png.length < 5000 || png.length > 8 * 1024 * 1024 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return false;
    fs.writeFileSync(path.join(output, fileName), png);
    return true;
  } catch { return false; }
}

try {
  if (mode === "live" && Object.values(liveIdentity).some(value => !value)) {
    currentStage = "live-account-unavailable"; throw new Error("dedicated-credentials-required");
  }
  let authUrl, anonKey, apiUrl;
  if (mode === "synthetic") {
    fixture = await createBusinessFixture({ runNonce: nonce });
    // localhost receives a narrowly scoped, temporary Simulator ATS exception.
    authUrl = apiUrl = fixture.url.replace("127.0.0.1", "localhost");
    anonKey = BUSINESS_FIXTURE_IDENTITY.anonKey;
  } else {
    authUrl = process.env.VITE_SUPABASE_URL;
    anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    apiUrl = "https://dengta-home-backend-rkmq.onrender.com";
    guard = createLiveGuard({ authUrl, anonKey, apiUrl, email: liveIdentity.EMAIL,
      password: liveIdentity.PASSWORD, expectedUserId: liveIdentity.USER_ID, runNonce: nonce });
  }
  // Copy source only; source Info.plist/release network policy remain untouched.
  fs.cpSync(path.join(root, "ios"), path.join(workspace, "ios"), { recursive: true,
    filter: file => !/(?:^|[/\\])(?:\.build|build|DerivedData|xcuserdata)(?:[/\\]|$)/.test(file) });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
  fs.copyFileSync(path.join(root, "package.json"), path.join(workspace, "package.json"));
  fs.copyFileSync(path.join(root, "capacitor.config.json"), path.join(workspace, "capacitor.config.json"));

  currentStage = "web-build";
  await build({ root, configFile: path.join(root, "vite.config.js"), envDir: false, envPrefix: [], logLevel: "warn",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(authUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(anonKey), "import.meta.env.VITE_PUBLIC_AUTH_REDIRECT_URL": '""' },
    build: { outDir: path.join(workspace, "dist"), emptyOutDir: true } });
  manifest.steps.push({ stage: "web-build", passed: true }); save();
  await command("capacitor-sync", process.execPath, [path.join(root, "node_modules/@capacitor/cli/bin/capacitor"), "sync", "ios"], { timeout: 180_000 });
  const project = path.join(workspace, "ios/App/App.xcodeproj");
  if (mode === "synthetic") {
    const plistPath = path.join(workspace, "ios/App/App/Info.plist");
    const plist = JSON.parse((await command("temporary-info-read", "plutil", ["-convert", "json", "-o", "-", plistPath])).text);
    plist.NSAppTransportSecurity = { NSAllowsLocalNetworking: true, NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } } };
    fs.writeFileSync(path.join(privateRoot, "temporary-info.json"), JSON.stringify(plist), { mode: 0o600 });
    await command("temporary-local-network-policy", "plutil", ["-convert", "xml1", "-o", plistPath, path.join(privateRoot, "temporary-info.json")]);
  }
  const runtimes = JSON.parse((await command("runtimes", "xcrun", ["simctl", "list", "runtimes", "--json"])).text).runtimes;
  const runtime = runtimes.filter(item => item.isAvailable && item.identifier.includes(".iOS-"))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  const types = JSON.parse((await command("device-types", "xcrun", ["simctl", "list", "devicetypes", "--json"])).text).devicetypes;
  const type = types.find(item => item.name === "iPhone 17");
  if (!runtime || !type) throw new Error("business-simulator-unavailable");
  manifest.runtime = { name: runtime.name, version: runtime.version }; manifest.device = "iPhone 17";
  const created = (await command("create-device", "xcrun", ["simctl", "create", `DengTa Business ${nonce.slice(0, 8)}`, type.identifier, runtime.identifier])).text;
  if (!/^[A-F\d-]{36}$/i.test(created)) throw new Error("business-simulator-invalid");
  device = created;
  fs.writeFileSync(path.join(privateRoot, "created-device.txt"), device, { mode: 0o600 });
  await command("boot-device", "xcrun", ["simctl", "boot", device]);
  await command("boot-ready", "xcrun", ["simctl", "bootstatus", device, "-b"], { timeout: 180_000 });
  await command("build-for-testing", "xcodebuild", ["-project", project, "-scheme", "App", "-configuration", "Debug", "-sdk", "iphonesimulator",
    "-destination", `id=${device}`, "-derivedDataPath", derived, "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "build-for-testing"], { timeout: 600_000 });
  const appPath = path.join(derived, "Build/Products/Debug-iphonesimulator/App.app");
  await command("install-product", "xcrun", ["simctl", "install", device, appPath]);
  await command("anonymous-native-launch", "xcrun", ["simctl", "launch", device, bundle, "--dengta-ci-keychain-diagnostics", "--dengta-ci-run", nonce]);
  const container = (await command("product-container", "xcrun", ["simctl", "get_app_container", device, bundle, "data"])).text;
  if (!path.isAbsolute(container)) throw new Error("business-container-invalid");
  let readiness = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(container, "tmp/dengta-ci-ui-diagnostics.json"), "utf8"));
      const result = validateUiReceipt(raw, nonce);
      if (result.passed) { readiness = result.receipt; break; }
    } catch { /* Await the anonymous UI; never dump container contents. */ }
    await pause(1000);
  }
  if (!readiness || readiness.state !== "anonymous") throw new Error("business-readiness-failed");
  await command("stop-anonymous-product", "xcrun", ["simctl", "terminate", device, bundle]);
  let baseline = { unified_system_prompt: "", user_details: "" };
  if (guard) {
    // The closed live path still lacks a coordinator that awaits a registered
    // personalization plan and selects the exact guard-created conversation.
    // Do not remove the entry gate based on the helper's unit tests.
    currentStage = "live-preflight";
    manifest.preflight = await guard.preflight(); guardReady = true;
    baseline = guard.runtimeBaseline();
  }
  const products = path.join(derived, "Build/Products");
  const plans = fs.readdirSync(products).filter(name => name.endsWith(".xctestrun"));
  if (plans.length !== 1) throw new Error("business-test-target-invalid");
  const buildDocument = JSON.parse((await command("test-plan-read", "plutil", ["-convert", "json", "-o", "-", path.join(products, plans[0])])).text);
  const environment = {
    DENGTA_BUSINESS_MODE: mode, DENGTA_BUSINESS_NONCE: nonce,
    DENGTA_BUSINESS_EMAIL: mode === "synthetic" ? BUSINESS_FIXTURE_IDENTITY.email : liveIdentity.EMAIL,
    DENGTA_BUSINESS_PASSWORD: mode === "synthetic" ? BUSINESS_FIXTURE_IDENTITY.password : liveIdentity.PASSWORD,
    DENGTA_BUSINESS_CONTROL_URL: fixture?.url || "",
    DENGTA_BUSINESS_PROMPT_BASELINE: baseline.unified_system_prompt, DENGTA_BUSINESS_DETAILS_BASELINE: baseline.user_details,
    DENGTA_BUSINESS_SCREENSHOT_PATH: mode === "synthetic" ? "__TEST_RUNNER_TMP__/dengta-ci-business.png" : "",
    DENGTA_UI_SAFE_TOP: String(readiness.safeAreaTop), DENGTA_UI_SAFE_BOTTOM: String(readiness.safeAreaBottom),
  };
  const runtimeDocument = runtimeXctestrun(buildDocument, environment);
  const runtimeJson = path.join(privateRoot, "runtime-test-plan.json");
  fs.writeFileSync(runtimeJson, JSON.stringify(runtimeDocument), { mode: 0o600 });
  // Keep beside the original: __TESTROOT__ remains Build/Products, no secret argv.
  const runtimePlan = path.join(products, "business-private.xctestrun");
  await command("runtime-test-plan", "plutil", ["-convert", "xml1", "-o", runtimePlan, runtimeJson]); fs.chmodSync(runtimePlan, 0o600);
  const tested = await command("business-xctest", "xcodebuild", ["-xctestrun", runtimePlan, "-destination", `id=${device}`,
    "-parallel-testing-enabled", "NO", "-maximum-concurrent-test-simulator-destinations", "1",
    "-only-testing:AppUITests/BusinessFlowTests/testCoreBusinessFlow", "-test-timeouts-enabled", "YES",
    "-default-test-execution-time-allowance", "600", "-maximum-test-execution-time-allowance", "720",
    "-resultBundlePath", path.join(privateRoot, "business.xcresult"), "test-without-building"], { timeout: 840_000, required: false });
  if (!tested.passed) {
    manifest.syntheticFailureScreenshot = await copySyntheticScreen("synthetic-failed.png");
    currentStage = "business-xctest";
    throw new Error("business-ui-test-failed");
  }
  currentStage = "receipt-validation";
  const receipt = parseBusinessEvidence(tested.text, { runNonce: nonce, mode, safeAreaTop: readiness.safeAreaTop, safeAreaBottom: readiness.safeAreaBottom });
  fs.writeFileSync(path.join(output, "business-evidence.json"), JSON.stringify(receipt, null, 2) + "\n");
  if (fixture) {
    const server = safeFixtureReceipt();
    if (Object.values(server.violations).some(n => n !== 0) ||
        !["settingsAtBaseline", "settingsChanged", "settingsRestored", "streamAcknowledged", "terminalSent", "userMessagePersisted", "assistantMessagePersisted", "loggedOut"].every(key => server.observed[key])) throw new Error("fixture-acceptance-failed");
    fs.writeFileSync(path.join(output, "fixture-evidence.json"), JSON.stringify(server, null, 2) + "\n");
    if (!await copySyntheticScreen("synthetic-chat.png")) throw new Error("synthetic-screenshot-invalid");
    manifest.outcome = "synthetic-native-business-passed";
  } else {
    // Current live UI cannot deterministically prove partial rendering before
    // a real server's terminal event. Preserve this gap in the outcome.
    manifest.outcome = receipt.streamedBeforeTerminal ? "live-native-business-passed" : "live-native-business-partial";
    manifest.personaReadBack = await guard.verifyBaseline();
    manifest.createdSession = await guard.recordCreatedSessions();
  }
} catch {
  failed = true;
  manifest.failureStage = currentStage;
  manifest.outcome = "failed";
} finally {
  if (device) {
    const stopped = await command("stop-tested-product", "xcrun", ["simctl", "terminate", device, bundle], { required: false });
    if (guardReady) {
      try {
        // If XCTest already terminated it, simctl exit status alone is not proof.
        const listing = await command("verify-product-stopped", "xcrun", ["simctl", "spawn", device, "launchctl", "list"], { required: false });
        const appStopped = stopped.passed || (listing.passed && !listing.text.includes(bundle));
        if (!appStopped) throw new Error("business-app-stop-failed");
        manifest.cleanup = await guard.restoreAndCleanup({ appStopped: true });
      } catch { failed = true; manifest.cleanupFailed = true; }
    }
  }
  if (guard) {
    try { manifest.revocation = await guard.close(); } catch { failed = true; manifest.revocationFailed = true; }
  }
  if (fixture) {
    try {
      fs.writeFileSync(path.join(output, "fixture-evidence.json"), JSON.stringify(safeFixtureReceipt(), null, 2) + "\n");
    } catch { failed = true; }
    await fixture.close();
  }
  if (device) {
    await command("shutdown-created-device", "xcrun", ["simctl", "shutdown", device], { required: false });
    const deleted = await command("delete-created-device", "xcrun", ["simctl", "delete", device], { required: false });
    if (!deleted.passed) { failed = true; manifest.simulatorCleanupFailed = true; }
  }
  if (failed) manifest.outcome = "failed";
  save();
  // Never retain credentials, xctestrun, xcresult, containers or raw live output.
  fs.rmSync(privateRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ mode, outcome: manifest.outcome, failureStage: manifest.failureStage || null }));
  if (failed || manifest.outcome === "live-native-business-partial") process.exitCode = 1;
}
