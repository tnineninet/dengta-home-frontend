const assert = require("node:assert/strict");
const test = require("node:test");
const { createCompanionCreativeToolExecutor } = require("../services/companion-creative-tool");

function fakeCenter({ enabled = true, surprise = false } = {}) {
  const generated = [];
  return {
    generated,
    async status() {
      return {
        settings: { generation_mode: "confirm", surprise_enabled: surprise },
        provider: { enabled, auth_configured: true, credential_state: "ready" }
      };
    },
    async createIdea(input, options) {
      return { row: { id: "00000000-0000-4000-8000-000000000001", title: input.title, alt_text: input.alt_text, visibility: "ordinary" }, input, options };
    },
    generateArtwork(id) {
      generated.push(id);
      return Promise.resolve({ id, state: "ready" });
    }
  };
}

test("chat image tool creates an artwork and starts background generation without blocking", async () => {
  const center = fakeCenter();
  let attached = null;
  const executor = createCompanionCreativeToolExecutor({ center, scope: { userId: "u", companionId: "c" }, onArtwork: payload => { attached = payload; } });
  const result = await executor.execute({ name: "create_artwork", arguments: JSON.stringify({ prompt: "雨夜灯塔下的两个人", title: "雨夜" }) });
  assert.equal(result.ok, true);
  assert.equal(result.state, "generating");
  assert.equal(result.surprise, false);
  assert.equal(center.generated.length, 1);
  assert.equal(attached.artwork_id, result.artwork_id);
  assert.equal(executor.getArtwork().artwork_state, "generating");
});

test("chat image tool asks for setup instead of pretending when image provider is disabled", async () => {
  const center = fakeCenter({ enabled: false });
  const executor = createCompanionCreativeToolExecutor({ center, scope: { userId: "u", companionId: "c" } });
  const result = await executor.execute({ name: "create_artwork", arguments: JSON.stringify({ prompt: "一张图" }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "creative_provider_not_enabled");
  assert.equal(result.setup_required, true);
});

test("chat image tool rejects a second artwork in the same turn", async () => {
  const center = fakeCenter();
  const executor = createCompanionCreativeToolExecutor({ center, scope: { userId: "u", companionId: "c" } });
  await executor.execute({ name: "create_artwork", arguments: JSON.stringify({ prompt: "第一张" }) });
  const second = await executor.execute({ name: "create_artwork", arguments: JSON.stringify({ prompt: "第二张" }) });
  assert.equal(second.code, "creative_turn_limit");
});
