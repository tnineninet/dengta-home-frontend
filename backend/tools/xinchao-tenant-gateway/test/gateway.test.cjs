"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const gatewayDir = path.resolve(__dirname, "..");
const coreDir = path.resolve(
  process.env.XINCHAO_CORE_DIR ||
    path.join(gatewayDir, "..", "..", "..", ".research", "xinchao-dynamic-mind")
);
const token = "g".repeat(40);

function waitFor(check, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      try {
        const value = await check();
        if (value) {
          clearInterval(timer);
          resolve(value);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error("timeout"));
        }
      } catch {
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error("timeout"));
        }
      }
    }, 250);
  });
}

test("gateway isolates each tenant into its own xinchao process/state", { timeout: 60000 }, async () => {
  if (!fs.existsSync(path.join(coreDir, "src", "server.js"))) {
    test.skip("local xinchao core checkout not available");
    return;
  }
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xinchao-gateway-test-"));
  const port = 21000 + Math.floor(Math.random() * 1000);
  const basePort = 22000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["gateway.cjs"], {
    cwd: gatewayDir,
    env: {
      ...process.env,
      PORT: String(port),
      GATEWAY_TOKEN: token,
      XINCHAO_CORE_DIR: coreDir,
      TENANT_STATE_ROOT: stateRoot,
      TENANT_BASE_PORT: String(basePort),
      TENANT_MAX_PORT: String(basePort + 50),
      MAX_ACTIVE_TENANTS: "4"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const headers = { Authorization: `Bearer ${token}` };
  const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    });
    const stateA = await (await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { ...headers, "X-Tenant-Id": tenantA }
    })).json();
    const stateB = await (await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { ...headers, "X-Tenant-Id": tenantB }
    })).json();
    assert.ok(stateA.revision >= 0);
    assert.ok(stateB.revision >= 0);

    const eventResponse = await fetch(`http://127.0.0.1:${port}/v1/conversation-event`, {
      method: "POST",
      headers: { ...headers, "X-Tenant-Id": tenantA, "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: "test-event-a", exchange: "她说：你好\n他回：我在。" })
    });
    assert.equal(eventResponse.status, 200);
    const afterA = await (await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { ...headers, "X-Tenant-Id": tenantA }
    })).json();
    const afterB = await (await fetch(`http://127.0.0.1:${port}/v1/state`, {
      headers: { ...headers, "X-Tenant-Id": tenantB }
    })).json();
    assert.ok(
      Number(afterA.revision) > Number(afterB.revision),
      `tenant A revision ${afterA.revision} should be greater than tenant B ${afterB.revision}`
    );
    assert.notEqual(
      fs.readdirSync(stateRoot).length,
      0,
      "tenant state directories should exist"
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(stateRoot, { recursive: true, force: true });
    if (child.exitCode !== null && child.exitCode !== 0 && logs) {
      console.error(logs.slice(-3000));
    }
  }
});
