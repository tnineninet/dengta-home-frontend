import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { apiRequest } from "../src/api.js";

// Use real loopback HTTP: headers arrive, then the JSON body stays open.
// Only fictional data is served; every fetch is redirected to this server.
async function fixture(run) {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  let requests = 0, bodyClosed = 0, headersArrived;
  const headers = new Promise(resolve => { headersArrived = resolve; });
  const server = createServer((request, response) => {
    requests++;
    if (request.url === "/success") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"fixture":"complete"}'); return;
    }
    response.writeHead(request.url === "/auth-stall" ? 401 : 200, { "content-type": "application/json" });
    response.write('{"fixture":');
    response.on("close", () => { bodyClosed++; });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, "http://localhost:3000");
    const response = await originalFetch(base + new URL(url).pathname, options);
    headersArrived(); return response;
  };
  const authSession = { getRequestContext: async () => ({}), getSnapshot: () => ({}) };
  try { await run({ authSession, headers, get requests() { return requests; }, get bodyClosed() { return bodyClosed; } }); }
  finally {
    globalThis.fetch = originalFetch; globalThis.window = originalWindow;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

for (const path of ["/body-stall", "/auth-stall"]) test(`JSON deadline still runs after ${path} headers`, async () => {
  await fixture(async h => {
    const pending = apiRequest(path, { timeoutMs: 150, retry: false, authSession: h.authSession });
    const rejected = assert.rejects(pending, { code: "request_timeout" });
    await h.headers; await rejected;
    assert.equal(h.requests, 1, "an incomplete body is never replayed");
    for (let i = 0; i < 50 && !h.bodyClosed; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(h.bodyClosed, 1, "deadline aborts the actual HTTP body");
    assert.deepEqual(await apiRequest("/success", { timeoutMs: 500, retry: false, authSession: h.authSession }), { fixture: "complete" });
  });
});

for (const timeoutMs of [0, 10_000]) test(`external cancellation covers an unfinished JSON body (timeout ${timeoutMs})`, async () => {
  await fixture(async h => {
    const controller = new AbortController();
    const pending = apiRequest("/body-stall", { signal: controller.signal, timeoutMs, retry: false, authSession: h.authSession });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await h.headers;
    for (let i = 0; i < 30; i++) await Promise.resolve();
    controller.abort(); await rejected;
    assert.equal(h.requests, 1);
  });
});
