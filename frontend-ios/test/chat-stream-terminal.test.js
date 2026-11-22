import assert from "node:assert/strict";
import test from "node:test";
import { streamChat } from "../src/api.js";

const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

for (const ok of [true, false]) test(`terminal done(ok=${ok}) settles without waiting for the transport to close`, async () => {
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  const events = []; let source, cancelled = 0, settled = false;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { source = controller; },
    cancel() { cancelled++; },
  }), { headers: { "content-type": "text/event-stream" } });
  let running;
  try {
    running = streamChat({ message: "synthetic terminal fixture" }, event => events.push(event), {
      authSession: { getRequestContext: async () => ({}) },
    });
    running.then(() => { settled = true; }, () => { settled = true; });
    await settle();
    source.enqueue(new TextEncoder().encode(`data: {"type":"meta","user_message":{"id":"fictional-user"}}\n\ndata: {"type":"done","ok":${ok},"message":"fictional save failure"}\n\n`));
    await settle();
    assert.equal(settled, true, "done is the application terminal; a keep-alive transport must not retain sending state");
    if (ok) assert.equal((await running).ok, true);
    else await assert.rejects(running, error => error.message === "fictional save failure" && error.userMessageCommitted === true);
    assert.deepEqual(events.map(event => event.type), ["meta", "done"]);
    assert.equal(cancelled, 1, "the unfinished response is released after the terminal event");
  } finally {
    try { source?.close(); } catch { /* The fixed reader already cancelled this source. */ }
    await running?.catch(() => {});
    globalThis.fetch = previousFetch; globalThis.window = previousWindow;
  }
});
