import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureAnonymousScreenshot } from "../scripts/ios-screenshot-evidence.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=", "base64");
function attempt(t, command, receipt = { state: "anonymous" }) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-screenshot-fixture-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  return captureAnonymousScreenshot({ command: (...args) => command(output, ...args), device: "fictional-device", output, receipt });
}
test("capture requires both command success and a new PNG file", t => {
  assert.equal(attempt(t, () => ({ status: 1 })), null);
  assert.equal(attempt(t, () => ({ status: 0 })), null);
  assert.equal(attempt(t, output => { fs.writeFileSync(path.join(output, "login-ready.png"), "not-an-image"); return { status: 0 }; }), null);
  assert.equal(attempt(t, output => { fs.writeFileSync(path.join(output, "login-ready.png"), png); return { status: 1 }; }), null);
  const result = attempt(t, output => { fs.writeFileSync(path.join(output, "login-ready.png"), png); return { status: 0 }; });
  assert.equal(result.file, "login-ready.png"); assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test("an authenticated or unknown page can never invoke screenshot capture", t => {
  for (const state of ["authenticated", "authenticating", "recovery", "unknown"]) {
    assert.equal(attempt(t, () => { throw new Error("must not invoke screenshot"); }, { state }), null);
  }
});
