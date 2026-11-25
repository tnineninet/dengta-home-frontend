import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompanionDbskillReply,
  buildLocalDbskillCard,
  detectCreatorTopicIntent,
  formatDbskillMarkdown,
} from "../src/dbskill-intent.js";

test("detectCreatorTopicIntent triggers proactively on topic/video ideas and ignores casual chat", () => {
  const bili = detectCreatorTopicIntent("我想拍一期关于AI桌宠从0到1的B站视频，帮我看看这个选题");
  assert.equal(bili.matched, true);
  assert.equal(bili.platform, "bilibili");
  assert.ok(bili.topic.includes("AI桌宠"));

  const hook = detectCreatorTopicIntent("帮我写几个抖音短视频爆款标题和黄金前3秒开头");
  assert.equal(hook.matched, true);
  assert.equal(hook.platform, "douyin");
  assert.equal(hook.mode, "title_cover_intro");

  const slash = detectCreatorTopicIntent("/dbs 普通人用开源工具剪短视频");
  assert.equal(slash.matched, true);
  assert.equal(slash.explicitCommand, true);

  for (const casual of ["今天天气真好", "放一首晴天", "有点累了想休息", "点一杯生椰拿铁"]) {
    assert.equal(detectCreatorTopicIntent(casual).matched, false, `Unexpected trigger for: ${casual}`);
  }
});

test("buildLocalDbskillCard, companion reply, and Markdown export work cleanly", () => {
  const card = buildLocalDbskillCard({
    topic: "普通人从0到1用AI做3D桌宠实测避坑",
    platform: "bilibili",
  });
  assert.equal(card.plugin_id, "dbskill-topic-studio");
  assert.ok(card.overall_score >= 70);
  assert.equal(card.packaging.bilibili.titles.length, 3);
  assert.equal(card.script_flow.beats.length, 4);

  const reply = buildCompanionDbskillReply(card, "小灯");
  assert.match(reply, /dbskill/);
  assert.match(reply, /AI 视频工坊/);

  const md = formatDbskillMarkdown(card);
  assert.match(md, /dbskill 选题诊断报告/);
  assert.match(md, /口播四段节奏/);
});
