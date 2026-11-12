import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { mayCaptureAnonymousScreen } from "./ios-evidence-policy.mjs";

/** A successful command without a real PNG never counts as capture evidence. */
export function captureAnonymousScreenshot({ command, device, output, receipt, file = "login-ready.png" }) {
  if (!device || !mayCaptureAnonymousScreen(receipt) || !["login-ready.png", "startup-failed.png"].includes(file)) return null;
  const target = path.join(output, file);
  // A retry must not accidentally validate an earlier command's file.
  fs.rmSync(target, { force: true });
  const result = command("screenshot", "xcrun", ["simctl", "io", device, "screenshot", "--type=png", target], 30_000, false);
  if (result.status !== 0 || result.error || !fs.existsSync(target)) return null;
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size < 33 || stat.size > 30 * 1024 * 1024) return null;
  const bytes = fs.readFileSync(target);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" || !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20)) return null;
  return { file, sha256: createHash("sha256").update(bytes).digest("hex") };
}
