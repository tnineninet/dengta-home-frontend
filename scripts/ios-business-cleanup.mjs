import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Workflow cancellation may bypass the harness's finally. Clean only its exact
// private directories and the individual Simulator IDs recorded inside them.
const directory = process.env.RUNNER_TEMP;
if (process.platform !== "darwin" || !directory || !path.isAbsolute(directory) ||
    path.resolve(directory).split(path.sep).filter(Boolean).length < 3 ||
    fs.realpathSync(directory) !== path.resolve(directory)) throw new Error("Private runner cleanup requires its real temporary directory.");
let removed = 0, failed = false;
for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^dengta-ios-business-private-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
  const target = path.join(directory, entry.name);
  if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) { failed = true; continue; }
  const deviceFile = path.join(target, "created-device.txt");
  if (fs.existsSync(deviceFile)) {
    const device = fs.readFileSync(deviceFile, "utf8").trim();
    if (!/^[A-F\d-]{36}$/i.test(device)) { failed = true; continue; }
    spawnSync("xcrun", ["simctl", "shutdown", device], { stdio: "ignore", timeout: 30_000 });
    const result = spawnSync("xcrun", ["simctl", "delete", device], { stdio: "ignore", timeout: 30_000 });
    if (result.status !== 0) failed = true;
  }
  fs.rmSync(target, { recursive: true, force: true }); removed += 1;
}
console.log(JSON.stringify({ schemaVersion: 1, privateWorkspacesRemoved: removed, cleanupPassed: !failed }));
if (failed) process.exitCode = 1;
