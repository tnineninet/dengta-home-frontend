import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { externalNewPath, nativeToolEnvironment, packageDeviceApp } from "./ios-device-package.mjs";

const API = "https://dengta-home-backend-rkmq.onrender.com";
const root = fileURLToPath(new URL("..", import.meta.url));

export function deviceBuildEnvironment(source) {
  if (source.VITE_API_URL && source.VITE_API_URL !== API) throw new Error("Unexpected public API configuration.");
  if (source.VITE_PUBLIC_AUTH_REDIRECT_URL) throw new Error("Device builds require the native auth callback.");
  let url;
  try { url = new URL(source.VITE_SUPABASE_URL); } catch { throw new Error("Public Supabase HTTPS configuration required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid public Supabase origin.");
  const key = source.VITE_SUPABASE_ANON_KEY?.trim() || "";
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
  if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try { publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role === "anon"; } catch { /* Reject malformed keys without printing them. */ }
  }
  if (!publicKey) throw new Error("A publishable or legacy anon key is required; privileged keys are rejected.");
  // Account credentials, signing credentials, arbitrary VITE_* and env files
  // are not inherited by build tools. build:web also verifies emitted literals.
  const env = nativeToolEnvironment(source);
  return { ...env, CI: "true", DEVELOPER_DIR: source.DEVELOPER_DIR || "/Applications/Xcode_26.6.app/Contents/Developer",
    VITE_API_URL: API, VITE_SUPABASE_URL: url.origin, VITE_SUPABASE_ANON_KEY: key,
    VITE_PUBLIC_AUTH_REDIRECT_URL: "" };
}

export async function buildDevice({ outputDirectory, sourceSha }) {
  // Fail before creating files or invoking a build tool on an unsupported host.
  if (process.platform !== "darwin") throw new Error("A real macOS/Xcode host is required; no device build was attempted.");
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node 24 required.");
  if (!/^[a-f0-9]{40}$/.test(sourceSha || "")) throw new Error("Exact source SHA required.");
  const git = args => execFileSync("git", args, { cwd: root, env: nativeToolEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git(["rev-parse", "HEAD"]) !== sourceSha || git(["status", "--porcelain"])) throw new Error("A clean checkout at the reviewed source SHA is required.");
  const tracked = git(["ls-tree", "-r", "--name-only", sourceSha]).split("\n");
  if (tracked.some(file => /(^|\/)\.env(?:$|\.)/.test(file) && !file.endsWith(".env.example"))) throw new Error("Tracked environment files are not permitted in this build.");
  const env = deviceBuildEnvironment(process.env);
  if (!fs.existsSync(env.DEVELOPER_DIR)) throw new Error("Configured Xcode installation is unavailable.");
  const output = externalNewPath(outputDirectory, root);
  fs.mkdirSync(output, { mode: 0o700 });
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-device-build-"));
  fs.chmodSync(privateRoot, 0o700);
  const workspace = path.join(privateRoot, "source"), derived = path.join(privateRoot, "derived");
  fs.mkdirSync(workspace);
  const npmrc = path.join(privateRoot, "user.npmrc"), globalNpmrc = path.join(privateRoot, "global.npmrc");
  for (const file of [npmrc, globalNpmrc]) fs.writeFileSync(file, "", { mode: 0o600 });
  Object.assign(env, { NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc, NPM_CONFIG_CACHE: path.join(privateRoot, "npm-cache") });
  const manifest = { schemaVersion: 1, sourceSha, platform: "iPhoneOS", configuration: "Release", outcome: "failed",
    signing: "not-performed", installation: "not-performed", deviceAcceptance: "not-performed", steps: [] };
  const save = () => fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  let child = null, interrupted = false, ipa = null;
  const interrupt = () => {
    interrupted = true;
    if (child?.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  async function run(stage, executable, args, { cwd = workspace, timeout = 600000, capture = false } = {}) {
    if (interrupted) throw new Error("Device build interrupted.");
    console.log(`Device build: ${stage}`);
    const logPath = path.join(output, `${stage}.log`), log = fs.openSync(logPath, "wx", 0o600);
    const started = Date.now(); let timedOut = false, code = null;
    try {
      code = await new Promise(resolve => {
        child = spawn(executable, args, { cwd, env, detached: true, stdio: ["ignore", log, log] });
        const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, timeout);
        child.once("error", () => { clearTimeout(timer); resolve(null); });
        child.once("close", exitCode => { clearTimeout(timer); resolve(exitCode); });
      });
    } finally { fs.closeSync(log); child = null; }
    const passed = code === 0 && !timedOut && !interrupted;
    manifest.steps.push({ stage, passed, exitCode: code, timedOut, milliseconds: Date.now() - started }); save();
    if (!passed) throw new Error(`Device build stage failed: ${stage}; see its local log.`);
    if (capture) {
      if (fs.statSync(logPath).size > 65536) throw new Error("Unexpected toolchain metadata size.");
      return fs.readFileSync(logPath, "utf8").trim();
    }
  }
  try {
    save();
    manifest.toolchain = {
      node: process.version,
      xcode: await run("xcode-version", "/usr/bin/xcodebuild", ["-version"], { capture: true }),
      sdk: await run("iphoneos-sdk", "/usr/bin/xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], { capture: true }),
    };
    // Build only committed source in a fresh directory; ignored local env,
    // cached generated iOS assets and local dependencies cannot enter the IPA.
    const archive = path.join(privateRoot, "source.tar");
    await run("source-archive", "git", ["archive", "--format=tar", `--output=${archive}`, sourceSha], { cwd: root });
    await run("source-extract", "/usr/bin/tar", ["-xf", archive, "-C", workspace]);
    await run("install", "npm", ["ci", "--no-audit", "--no-fund"]);
    await run("device-package-tests", "npm", ["run", "test:ios-device"]);
    await run("ios-tests", "npm", ["run", "test:ios"]);
    await run("web-build", "npm", ["run", "build:web"]);
    await run("ios-build-policy", "npm", ["run", "verify:ios-build-policy"]);
    await run("capacitor-sync", "npx", ["--no-install", "cap", "sync", "ios"]);
    await run("iphoneos-release", "/usr/bin/xcodebuild", ["-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release",
      "-sdk", "iphoneos", "-destination", "generic/platform=iOS", "-derivedDataPath", derived,
      "ARCHS=arm64", "ONLY_ACTIVE_ARCH=NO", "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CAPACITOR_DEBUG=0", "build"], { timeout: 900000 });
    const target = path.join(output, `DengTa-${sourceSha.slice(0, 12)}-unsigned.ipa`);
    manifest.package = packageDeviceApp({ appPath: path.join(derived, "Build/Products/Release-iphoneos/App.app"), ipaPath: target, sourceSha, repositoryRoot: root });
    ipa = target;
    if (interrupted) throw new Error("Device build interrupted.");
    manifest.outcome = "unsigned-candidate-created"; save();
    console.log(JSON.stringify({ outcome: manifest.outcome, sourceSha, ipa: manifest.package.ipa, installed: false }));
    return manifest;
  } catch (error) {
    manifest.outcome = interrupted ? "interrupted" : "failed";
    // Only this invocation's newly created IPA can be removed on failure.
    if (ipa) fs.unlinkSync(ipa);
    delete manifest.package; save();
    throw error;
  } finally {
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    try { fs.rmSync(privateRoot, { recursive: true, force: true }); manifest.workspaceCleanupComplete = true; }
    catch { manifest.workspaceCleanupComplete = false; console.warn(`Temporary build directory cleanup incomplete: ${privateRoot}`); }
    save();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outputDirectory, sourceSha] = process.argv.slice(2);
  try { await buildDevice({ outputDirectory, sourceSha }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
