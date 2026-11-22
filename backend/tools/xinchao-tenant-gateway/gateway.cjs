"use strict";

// Lazy per-tenant gateway in front of the unmodified Xinchao core.
//
// DengTa only talks to this gateway with a machine token. The tenant id
// (user_id:companion_id) is selected by DengTa's authenticated server code,
// never by a browser. Each tenant gets its own xinchao-dynamic-mind child
// process, state file, transition journal, service token and port, so one
// tenant's drives / emotion / events can never leak into another tenant.
//
// This deliberately keeps the upstream core unmodified (AGPL compliance is
// simpler) and lazily stops idle tenants to keep a small VPS usable.

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");

const PORT = integerEnv("PORT", 18200, 1, 65535);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = String(process.env.GATEWAY_TOKEN || "").trim();
const CORE_DIR = path.resolve(
  String(process.env.XINCHAO_CORE_DIR || "/opt/xinchao-nian")
);
const STATE_ROOT = path.resolve(
  String(process.env.TENANT_STATE_ROOT || "/opt/xinchao-tenants/state")
);
const BASE_PORT = integerEnv("TENANT_BASE_PORT", 19100, 1024, 65000);
const MAX_PORT = integerEnv("TENANT_MAX_PORT", 19999, BASE_PORT, 65535);
const MAX_ACTIVE = integerEnv("MAX_ACTIVE_TENANTS", 20, 1, 500);
const IDLE_MINUTES = integerEnv("TENANT_IDLE_MINUTES", 30, 1, 1440);
const STARTUP_TIMEOUT_MS = integerEnv("TENANT_STARTUP_TIMEOUT_MS", 20000, 2000, 120000);
const OWNER_TENANT_ID = String(process.env.OWNER_TENANT_ID || "").trim();
const OWNER_STATE_FILE = String(process.env.OWNER_STATE_FILE || "").trim();
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/;

if (!TOKEN || TOKEN.length < 32) {
  throw new Error("GATEWAY_TOKEN must be at least 32 characters");
}
if (!fs.existsSync(path.join(CORE_DIR, "src", "server.js"))) {
  throw new Error(`Xinchao core not found under ${CORE_DIR}/src/server.js`);
}

const tenants = new Map();
const pendingStarts = new Map();
let nextPort = BASE_PORT;
let shuttingDown = false;
let idleTimer = null;

function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function log(event, fields = {}) {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), event, ...fields })
  );
}

function tenantKey(value) {
  const text = String(value || "").trim();
  if (!TENANT_ID_PATTERN.test(text)) return "";
  return text;
}

function statePaths(tenant) {
  const key = createHash("sha256").update(tenant, "utf8").digest("hex").slice(0, 32);
  const dir = path.join(STATE_ROOT, key);
  return {
    dir,
    state: path.join(dir, "state.json"),
    journal: path.join(dir, "transitions.jsonl")
  };
}

function allocatePort() {
  const used = new Set(Array.from(tenants.values(), (tenant) => tenant.port));
  for (let port = nextPort; port <= MAX_PORT; port += 1) {
    if (!used.has(port)) {
      nextPort = port + 1;
      return port;
    }
  }
  for (let port = BASE_PORT; port <= MAX_PORT; port += 1) {
    if (!used.has(port)) return port;
  }
  return 0;
}

function childEnv(tenant, port, token, paths) {
  const env = {
    ...process.env,
    PORT: String(port),
    SERVICE_TOKEN: token,
    STATE_PATH: paths.state,
    TRANSITION_JOURNAL_PATH: paths.journal,
    SHADOW_MODE: "true",
    MODEL_ENABLED: "false",
    BARK_ENABLED: "false",
    BRIDGE_ENABLED: "false",
    MCP_ENABLED: "false",
    OAUTH_ENABLED: "false",
    DASHBOARD_ENABLED: "false",
    DAYTIME_EMERGENCE_ENABLED: "false",
    OMBRE_READ_ENABLED: "false",
    OMBRE_WRITE_ENABLED: "false",
    CONTEXT_OMBRE_ENABLED: "false",
    SETTLE_INTERVAL_MINUTES: "15",
    AGENT_NAME: "心潮"
  };
  // Do not let the parent core's single-instance secrets or file paths leak
  // into a tenant child.
  for (const name of [
    "OMBRE_MCP_URL",
    "OMBRE_MCP_TOKEN",
    "BARK_KEY",
    "BRIDGE_MACHINE_TOKEN",
    "XINCHAO_BOARD_TOKEN",
    "MCP_PATH_TOKEN",
    "OAUTH_APPROVAL_TOKEN",
    "DASHBOARD_ACCESS_TOKEN"
  ]) {
    if (name in env) delete env[name];
  }
  return env;
}

function healthUrl(port) {
  return `http://127.0.0.1:${port}/health`;
}

async function waitForChild(port, child) {
  const start = Date.now();
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Xinchao tenant process exited with ${child.exitCode}`);
    }
    try {
      const response = await fetch(healthUrl(port), {
        signal: AbortSignal.timeout(1500)
      });
      if (response.ok) return;
    } catch {
      // Keep waiting for the child to bind its port.
    }
    await sleep(250);
  }
  throw new Error("Xinchao tenant process did not become healthy");
}

async function seedOwnerState(tenant, paths) {
  if (!OWNER_STATE_FILE || tenant !== OWNER_TENANT_ID) return;
  try {
    await fsp.access(paths.state, fs.constants.F_OK);
    return;
  } catch {
    // No tenant state yet; copy the old single-instance state once.
  }
  await fsp.mkdir(paths.dir, { recursive: true });
  await fsp.copyFile(OWNER_STATE_FILE, paths.state);
  log("owner_state_seeded", { tenant });
}

async function startTenant(tenant) {
  const existing = tenants.get(tenant);
  if (existing?.ready) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (pendingStarts.has(tenant)) return pendingStarts.get(tenant);

  const starting = (async () => {
    if (tenants.size >= MAX_ACTIVE) {
      const oldest = Array.from(tenants.entries())
        .filter(([, value]) => value.ready)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) throw new Error("tenant capacity is full");
      await stopTenant(oldest[0], "capacity");
    }

    const port = allocatePort();
    if (!port) throw new Error("no tenant port available");
    const token = randomBytes(32).toString("hex");
    const paths = statePaths(tenant);
    await fsp.mkdir(paths.dir, { recursive: true });
    await seedOwnerState(tenant, paths);
    const env = childEnv(tenant, port, token, paths);
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: CORE_DIR,
      env,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true
    });
    const record = {
      tenant,
      port,
      token,
      child,
      ready: false,
      lastUsed: Date.now()
    };
    tenants.set(tenant, record);
    try {
      await waitForChild(port, child);
      record.ready = true;
      log("tenant_started", { tenant, port });
      return record;
    } catch (error) {
      record.ready = false;
      if (child.exitCode === null) child.kill("SIGKILL");
      tenants.delete(tenant);
      throw error;
    }
  })();
  pendingStarts.set(tenant, starting);
  try {
    return await starting;
  } finally {
    pendingStarts.delete(tenant);
  }
}

async function stopTenant(tenant, reason) {
  const record = tenants.get(tenant);
  if (!record) return;
  tenants.delete(tenant);
  record.ready = false;
  try {
    record.child.kill("SIGTERM");
  } catch {
    // The process may already be gone.
  }
  log("tenant_stopped", { tenant, reason });
}

async function ensureTenant(tenant) {
  const record = await startTenant(tenant);
  record.lastUsed = Date.now();
  return record;
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function authorized(request) {
  const value = String(request.headers.authorization || "");
  return value === `Bearer ${TOKEN}`;
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function proxy(request, response, tenant) {
  let record;
  try {
    record = await ensureTenant(tenant);
  } catch (error) {
    log("tenant_unavailable", { tenant, message: error.message });
    sendJson(response, 503, { error: "xinchao_tenant_unavailable" });
    return;
  }

  const target = new URL(request.url, `http://127.0.0.1:${record.port}`);
  const headers = {
    Authorization: `Bearer ${record.token}`,
    Accept: request.headers.accept || "application/json"
  };
  if (request.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"];
  }
  let body;
  try {
    body = await readBody(request);
  } catch {
    sendJson(response, 413, { error: "request_too_large" });
    return;
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body && request.method !== "GET" && request.method !== "HEAD"
        ? body
        : undefined,
      signal: AbortSignal.timeout(15000)
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = {
      "Content-Type":
        upstream.headers.get("content-type") ||
        "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": responseBody.length
    };
    response.writeHead(upstream.status, responseHeaders);
    response.end(responseBody);
    record.lastUsed = Date.now();
  } catch (error) {
    log("tenant_proxy_failed", { tenant, message: error.message });
    sendJson(response, 502, { error: "xinchao_tenant_proxy_failed" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "xinchao-tenant-gateway",
        activeTenants: tenants.size,
        maxActiveTenants: MAX_ACTIVE
      });
      return;
    }
    if (!authorized(request)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    if (!url.pathname.startsWith("/v1/")) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    const tenant = tenantKey(request.headers["x-tenant-id"]);
    if (!tenant) {
      sendJson(response, 400, { error: "invalid_tenant" });
      return;
    }
    await proxy(request, response, tenant);
  } catch (error) {
    log("gateway_request_failed", { message: error.message });
    if (!response.headersSent) sendJson(response, 500, { error: "gateway_error" });
    else response.destroy();
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

idleTimer = setInterval(() => {
  const cutoff = Date.now() - IDLE_MINUTES * 60_000;
  for (const [tenant, record] of tenants) {
    if (record.ready && record.lastUsed < cutoff) {
      void stopTenant(tenant, "idle");
    }
  }
}, 60_000);
idleTimer.unref();

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(idleTimer);
  await Promise.all(Array.from(tenants.keys(), (tenant) => stopTenant(tenant, "shutdown")));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

server.listen(PORT, HOST, () => {
  log("gateway_started", {
    host: HOST,
    port: PORT,
    coreDir: CORE_DIR,
    stateRoot: STATE_ROOT
  });
});
