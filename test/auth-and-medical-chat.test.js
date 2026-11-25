import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  buildSanitizedAuthReceipt,
  classifyAuthFailureHint,
  isDeprecatedLegacyEmail,
  maskEmailForReceipt,
} from "../src/auth-diagnostics.js";
import {
  extractMedicalCitationBadges,
  parseMedicalRagMessage,
} from "../src/medical-chat-card.js";
import { buildGroundedMedicalPrompt, validateOphthalmicRecord } from "../src/medical-ai-data.js";

test("P0 auth diagnostics flags deprecated legacy emails, guides failure recovery, and redacts secrets in receipts", () => {
  assert.equal(isDeprecatedLegacyEmail("tnineninet@gmail.com"), true);
  assert.equal(isDeprecatedLegacyEmail("buyaocaowo555@gmail.com"), true);
  assert.equal(isDeprecatedLegacyEmail("2458077782sans@gmail.com"), false);
  assert.equal(maskEmailForReceipt("2458077782sans@gmail.com"), "24***@gmail.com");

  const legacyHint = classifyAuthFailureHint({ email: "tnineninet@gmail.com", errorCode: "invalid_credentials" });
  assert.equal(legacyHint.tone, "warn");
  assert.match(legacyHint.title, /旧邮箱/);

  const netHint = classifyAuthFailureHint({ email: "user@example.com", errorCode: "auth_network_unavailable" });
  assert.equal(netHint.tone, "network");
  assert.match(netHint.detail, /并非密码错误|加速/);

  const credHint = classifyAuthFailureHint({ email: "user@example.com", errorCode: "invalid_credentials" });
  assert.equal(credHint.tone, "credentials");

  const receipt = buildSanitizedAuthReceipt({
    mode: "login",
    email: "2458077782sans@gmail.com",
    errorCode: "invalid_credentials",
    feedback: "failed for 2458077782sans@gmail.com Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig",
    authCheck: { status: "ok", message: "可达 (48ms)" },
    isOnline: true,
    origin: "https://www.dengtahome.com/?token=secret",
  });
  assert.match(receipt, /24\*\*\*@gmail\.com/);
  assert.doesNotMatch(receipt, /2458077782sans@gmail\.com/);
  assert.doesNotMatch(receipt, /eyJhbGci/);
  assert.doesNotMatch(receipt, /token=secret/);
});

test("M3 ChatMessage renders Grounded Medical RAG packets as structured cards and preserves verbatim assistant replies with [M1] badges", async () => {
  const val = validateOphthalmicRecord({
    template_id: "zeiss_treatment",
    fields: { treatment_type: "FS-LASIK", cct: "485", ablation_depth: "112", sphere: "-7.50", cylinder: "-1.00", optical_zone: "6.5" },
  });
  const built = buildGroundedMedicalPrompt({
    question: "这份激光方案能直接做吗？",
    validationResult: val,
    mode: "hybrid",
    limit: 4,
  });

  const parsed = parseMedicalRagMessage(built.prompt);
  assert.ok(parsed);
  assert.equal(parsed.question, "这份激光方案能直接做吗？");
  assert.equal(parsed.status, "REVIEW");
  assert.ok(parsed.alerts.some((a) => a.rule === "RSB_SAFETY_REDLINE"));
  assert.ok(parsed.citations.length >= 2);

  assert.deepEqual(extractMedicalCitationBadges("根据 [M1] 和 [M2] 指南，RSB 低于 280μm 建议优先复核 [M1]。"), ["M1", "M2"]);
  assert.deepEqual(extractMedicalCitationBadges("今天天气不错！"), []);

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const vite = await createServer({
    root: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  let tree;
  try {
    const { default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx");
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ChatMessage, {
            item: { id: "u-med-1", role: "user", content: built.prompt, created_at: "2026-11-25T03:00:00Z" },
            userName: "测试用户",
            aiName: "小灯",
          }),
          React.createElement(ChatMessage, {
            item: {
              id: "a-med-1",
              role: "assistant",
              content: "根据 L1 计算结果与 [M1] [M2] 临床共识，RSB=263μm 低于 280μm 安全红线，建议暂缓常规 LASIK 并面诊评估 ICL。",
              created_at: "2026-11-25T03:00:05Z",
            },
            userName: "测试用户",
            aiName: "小灯",
          }),
        ),
      );
    });
    const flatten = (node) =>
      typeof node === "string" || typeof node === "number"
        ? String(node)
        : Array.isArray(node)
          ? node.map(flatten).join("")
          : (node?.children || []).map(flatten).join("");
    const rendered = flatten(tree.toJSON());
    assert.match(rendered, /医疗 AI · Grounded RAG/);
    assert.match(rendered, /RSB_SAFETY_REDLINE/);
    assert.match(rendered, /展开完整 L1\+L2 临床证据包/);
    assert.match(rendered, /已锚定临床证据：\[M1\] \[M2\]/);
    assert.match(rendered, /RSB=263μm 低于 280μm 安全红线/);
  } finally {
    if (tree) await act(async () => tree.unmount());
    await vite.close();
  }
});
