import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const MACH_MAGICS = new Set(["cffaedfe", "feedfacf", "cefaedfe", "feedface", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const version = n => `${n >>> 16}.${(n >>> 8) & 255}.${n & 255}`;
const fail = message => { throw new Error(message); };

export function nativeToolEnvironment(source = process.env) {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SystemRoot", "DEVELOPER_DIR"]
    .filter(key => source[key]).map(key => [key, source[key]]));
}

/** This build produces thin, generic arm64 only. Universal/legacy binaries need
 * a separate review; a CPU name alone never establishes the iOS platform.
 * Structures: Apple cctools include/mach-o/loader.h (LC_BUILD_VERSION). */
export function inspectMachO(bytes) {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) fail("Expected a thin 64-bit Mach-O binary.");
  if (bytes.readUInt32LE(4) !== 0x0100000c || bytes.readUInt32LE(8) !== 0) fail("Expected generic arm64.");
  const fileType = bytes.readUInt32LE(12), count = bytes.readUInt32LE(16), size = bytes.readUInt32LE(20);
  if (![2, 6, 8].includes(fileType) || count < 1 || count > 65536 || size > bytes.length - 32 || count > size / 8) fail("Invalid Mach-O header.");
  let cursor = 32, platform = null, minimumOS = null, sdk = null;
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > 32 + size) fail("Truncated load command.");
    const command = bytes.readUInt32LE(cursor), length = bytes.readUInt32LE(cursor + 4);
    if (length < 8 || length % 8 || length > 32 + size - cursor) fail("Invalid load command size.");
    if (command === 0x32) {
      if (platform !== null || length < 24 || bytes.readUInt32LE(cursor + 20) > (length - 24) / 8) fail("Invalid platform command.");
      platform = bytes.readUInt32LE(cursor + 8);
      minimumOS = version(bytes.readUInt32LE(cursor + 12));
      sdk = version(bytes.readUInt32LE(cursor + 16));
      if (platform !== 2) fail("Binary platform is not iPhoneOS (Simulator is rejected).");
    }
    if (command === 0x2c || command === 0x21) {
      if (length < 24 || bytes.readUInt32LE(cursor + 16) !== 0) fail("Encrypted or invalid binary is not a build candidate.");
    }
    cursor += length;
  }
  if (cursor !== 32 + size || platform !== 2) fail("Missing or inconsistent iPhoneOS platform evidence.");
  return { architecture: "arm64", platform: "iOS", platformId: platform, fileType, minimumOS, sdk, encrypted: false };
}

export function validateDevicePlist(plist) {
  if (plist.CFBundleIdentifier !== "home.dengta.app" || plist.CFBundlePackageType !== "APPL") fail("Unexpected application identity.");
  if (JSON.stringify(plist.CFBundleSupportedPlatforms) !== '["iPhoneOS"]' || plist.DTPlatformName !== "iphoneos" || !/^iphoneos\d/.test(plist.DTSDKName || "")) fail("Info.plist does not describe an iPhoneOS build.");
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(plist.CFBundleExecutable || "")) fail("Invalid executable path.");
  if (![false, 0, "0", "false", ""].includes(plist.CAPACITOR_DEBUG)) fail("CAPACITOR_DEBUG must be explicitly disabled.");
  return plist.CFBundleExecutable;
}

function readPlist(file) {
  if (process.platform !== "darwin") fail("Reading built plists requires macOS plutil.");
  return JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { env: nativeToolEnvironment(), encoding: "utf8", maxBuffer: 1024 * 1024 }));
}

export function inspectDeviceApp(appPath, { plistReader = readPlist } = {}) {
  const root = path.resolve(appPath);
  if (!root.endsWith(".app") || fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) fail("Expected a real .app directory.");
  const files = [], frameworks = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail("Symbolic links are not supported in this device build.");
      if (/(^\.env(?:\.|$)|\.(?:p12|p8|pem|mobileprovision)$)/i.test(name) || name === "_credentials") fail("Private signing/configuration file found in app.");
      if (stat.isDirectory()) {
        if (/\.(app|appex)$/i.test(name)) fail("Nested applications/extensions require separate packaging support.");
        if (name.endsWith(".framework")) frameworks.push(file);
        walk(file);
      } else if (stat.isFile()) files.push(file);
      else fail("Unsupported app filesystem entry.");
    }
  }
  walk(root);
  const plist = plistReader(path.join(root, "Info.plist"));
  const executable = validateDevicePlist(plist), main = path.join(root, executable);
  const required = new Set([main]);
  for (const framework of frameworks) {
    const name = plistReader(path.join(framework, "Info.plist")).CFBundleExecutable;
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name || "")) fail("Invalid framework executable path.");
    required.add(path.join(framework, name));
  }
  for (const file of required) if (!files.includes(file)) fail("Required executable is missing.");
  const config = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8"));
  if (config.appId !== "home.dengta.app" || config.server?.url || config.server?.cleartext === true || config.ios?.loggingBehavior !== "none") fail("Unexpected Capacitor release configuration.");
  if (!files.includes(path.join(root, "public", "index.html"))) fail("Bundled web entry is missing.");
  const binaries = [];
  for (const file of files) {
    const fd = fs.openSync(file, "r"), prefix = Buffer.alloc(4);
    try { fs.readSync(fd, prefix, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (required.has(file) || file.endsWith(".dylib") || MACH_MAGICS.has(prefix.toString("hex"))) {
      const bytes = fs.readFileSync(file), binary = inspectMachO(bytes);
      if (file === main && binary.fileType !== 2) fail("Main binary is not executable.");
      if (file !== main && binary.fileType !== 6) fail("Unexpected embedded executable/bundle.");
      binaries.push({ file: path.relative(root, file).split(path.sep).join("/"), bytes: bytes.length, sha256: sha256(bytes), ...binary });
    }
  }
  return { bundleId: plist.CFBundleIdentifier, version: plist.CFBundleShortVersionString, build: plist.CFBundleVersion, platform: "iPhoneOS", architecture: "arm64", binaries };
}

export function externalNewPath(target, repositoryRoot) {
  if (!path.isAbsolute(target) || fs.existsSync(target)) fail("Output must be a new absolute path.");
  const parent = fs.realpathSync(path.dirname(target)), root = fs.realpathSync(repositoryRoot);
  const resolved = path.join(parent, path.basename(target));
  const relative = path.relative(root, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) fail("Output must stay outside the repository.");
  return resolved;
}

/** The final filename appears atomically, exclusively, after preparation.
 * Cleanup after publication cannot invalidate an already verified candidate. */
export function publishStagedPackage(target, prepare) {
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), ".dengta-device-stage-"));
  fs.chmodSync(temporary, 0o700);
  let receipt;
  try {
    const prepared = prepare(temporary);
    if (path.dirname(prepared.archive) !== temporary || !fs.lstatSync(prepared.archive).isFile()) fail("Invalid staged package.");
    receipt = prepared.receipt;
    // The staging directory is on the destination filesystem. link is atomic
    // and refuses an existing file/symlink; no partial final IPA is visible.
    fs.linkSync(prepared.archive, target);
    return receipt;
  } finally {
    try {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (receipt) receipt.temporaryCleanupComplete = true;
    } catch {
      if (receipt) receipt.temporaryCleanupComplete = false;
      console.warn("Device package staging cleanup incomplete; inspect the output directory's hidden staging folder.");
    }
  }
}

/** Returns an unsigned candidate, never an install/signing success claim. */
export function packageDeviceApp({ appPath, ipaPath, sourceSha, repositoryRoot }) {
  if (process.platform !== "darwin") fail("IPA packaging requires macOS.");
  if (!/^[a-f0-9]{40}$/.test(sourceSha || "")) fail("Exact source SHA required.");
  const target = externalNewPath(ipaPath, repositoryRoot);
  if (!target.endsWith(".ipa")) fail("Expected an .ipa output filename.");
  // Check before copying so cp never follows a foreign link; check the snapshot again.
  inspectDeviceApp(appPath);
  return publishStagedPackage(target, temporary => {
    const payload = path.join(temporary, "Payload"); fs.mkdirSync(payload);
    const snapshot = path.join(payload, "App.app");
    fs.cpSync(appPath, snapshot, { recursive: true, dereference: false, preserveTimestamps: true });
    const validation = inspectDeviceApp(snapshot);
    const archive = path.join(temporary, "candidate.ipa");
    execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", payload, archive], { env: nativeToolEnvironment(), stdio: "pipe", timeout: 120000 });
    const bytes = fs.readFileSync(archive);
    if (bytes.length < 100 || bytes.readUInt32LE(0) !== 0x04034b50) fail("IPA archive was not created.");
    const receipt = { schemaVersion: 1, sourceSha, kind: "unsigned-device-candidate", signingPerformed: false, requiresDeviceSigning: true, installed: false, ...validation,
      ipa: { file: path.basename(target), bytes: bytes.length, sha256: sha256(bytes) } };
    return { archive, receipt };
  });
}
