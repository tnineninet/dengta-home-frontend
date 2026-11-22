const assert = require("node:assert/strict");
const test = require("node:test");
const { _timeCapsule } = require("../routes/v2/qq-bridge");

test("time capsule markers: 41-char task name is parsed and stripped", () => {
  const name = "洗".repeat(41);
  const now = Date.now();
  const applied = _timeCapsule.applyCapsuleMarkers(`好，去洗吧。[[进行中:${name}|25]]`, [], now);
  assert.equal(applied.clean, "好，去洗吧。");
  assert.equal(applied.capsules.length, 1);
  assert.equal(applied.capsules[0].name, name);
  assert.equal(applied.capsules[0].estimateMinutes, 25);
});

test("time capsule markers: complete removes the task and hides all markers", () => {
  const now = Date.now();
  const first = _timeCapsule.applyCapsuleMarkers("[[进行中:洗澡|20]]", [], now);
  const done = _timeCapsule.applyCapsuleMarkers("洗完啦。[[完成:洗澡]]", first.capsules, now + 1000);
  assert.equal(done.clean, "洗完啦。");
  assert.equal(done.capsules.length, 0);
});

test("time capsule markers: leftover oversized marker cannot leak to the user", () => {
  const name = "任".repeat(120);
  const applied = _timeCapsule.applyCapsuleMarkers(`文字[[进行中:${name}|10]]尾`, [], Date.now());
  assert.equal(applied.clean.includes("[["), false);
  assert.equal(applied.clean.includes(name), false);
});