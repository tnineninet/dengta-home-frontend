import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch } from "../src/api.js";

function fixture() {
  let invalidations = 0;
  return {
    get invalidations() { return invalidations; },
    session: {
      getSnapshot: () => ({ user: null, activeCompanionId: null }),
      getRequestContext: async () => ({}),
      invalidateSession: () => { invalidations += 1; },
    },
  };
}

async function responseWith(code) {
  return new Response(JSON.stringify({ code, message: "fictional provider failure" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

test("third-party 401 does not sign the DengTa session out", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const fake = fixture();
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async () => responseWith("netease_qr_session_expired");
  try {
    const response = await apiFetch("/fixture/provider", { authSession: fake.session, retry: false });
    assert.equal(response.status, 401);
    assert.equal(fake.invalidations, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("DengTa session 401 still invalidates the session", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const fake = fixture();
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async () => responseWith("invalid_session");
  try {
    const response = await apiFetch("/fixture/session", { authSession: fake.session, retry: false });
    assert.equal(response.status, 401);
    assert.equal(fake.invalidations, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
