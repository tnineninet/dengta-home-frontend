const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildProactiveRuntimeContext,
  isRepeatedProactiveMessage,
  pushSimilarity,
  recentMemoriesForProactive
} = require("../services/tenant-proactive-message");

test("proactive pushes reject near-duplicate recent wording", () => {
  const recent = [{ content: "忙完了吗？我刚才想起你。" }];
  assert.equal(pushSimilarity("忙完了吗？我刚才想起你。", recent[0].content), 1);
  assert.equal(isRepeatedProactiveMessage("忙完了吗？我刚才又想起你了。", recent), true);
  assert.equal(isRepeatedProactiveMessage("窗外的雨停了，你那边呢？", recent), false);
});

test("stale memories are excluded from proactive context but locked facts remain", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const kept = recentMemoriesForProactive([
    { summary: "最近在忙项目", updated_at: "2026-10-18T00:00:00Z" },
    { summary: "半年前的旅行", updated_at: "2026-01-01T00:00:00Z" },
    { summary: "稳定关系事实", locked: true, updated_at: "2025-01-01T00:00:00Z" }
  ], now);
  assert.deepEqual(kept.map((item) => item.summary), ["最近在忙项目", "稳定关系事实"]);
});

test("proactive runtime context labels old memory dates and recent pushes", () => {
  const text = buildProactiveRuntimeContext({
    now: new Date("2026-10-20T00:00:00Z"),
    recentPushes: [{ content: "记得吃饭。", created_at: "2026-10-19T00:00:00Z" }],
    memories: [{ summary: "很久以前的旅行", updated_at: "2026-01-01T00:00:00Z" }]
  });
  assert.match(text, /2026-10-19/);
  assert.match(text, /2026-01-01/);
  assert.match(text, /不要重复/);
  assert.match(text, /48 小时/);
});
