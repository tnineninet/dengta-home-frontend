import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyIosBuildPolicy } from "../scripts/verify-ios-build-policy.mjs";

const apiUrl = "https://dengta-home-backend-rkmq.onrender.com";
test("iOS emitted policy rejects auth-only, missing callback or wrong-endpoint bundles", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-build-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = value => fs.writeFileSync(path.join(directory, "entry.js"), value);
  write("fictional-public-auth-values-only");
  assert.throws(() => verifyIosBuildPolicy({ directory, apiUrl }));
  write(JSON.stringify(apiUrl)); assert.throws(() => verifyIosBuildPolicy({ directory, apiUrl }));
  write(`${JSON.stringify(apiUrl)}; 'dengta://auth'`);
  assert.deepEqual(verifyIosBuildPolicy({ directory, apiUrl }), { apiLiteralPresent: true, nativeCallbackLiteralPresent: true });
  assert.throws(() => verifyIosBuildPolicy({ directory, apiUrl: "http://localhost:3000" }));
});
