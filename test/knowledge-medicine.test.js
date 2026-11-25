import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  createHybridSemanticIndex,
  expandSemanticTokens,
  tokenizeCjkHybrid,
} from "../src/semantic-search.js";
import {
  BUILTIN_KNOWLEDGE_ARTICLES,
  COMMON_MEDICATIONS,
  MEDICATION_CATEGORIES,
  checkLocalMedicationInteractions,
  searchLocalMedications,
} from "../src/medications-data.js";

test("frontend CJK hybrid tokenizer and synonym expansion bridge colloquial symptom queries", () => {
  const tokens = tokenizeCjkHybrid("发烧头疼 喉咙痛");
  assert.ok(tokens.includes("发烧"));
  assert.ok(tokens.includes("头疼"));
  const expanded = expandSemanticTokens("拉肚子");
  assert.ok(expanded.tokens.includes("腹泻"));
  assert.ok(expanded.expandedConcepts.length >= 1);
});

test("frontend OTC medications database has 28+ structured entries and hybrid search ranks accurately", () => {
  assert.ok(COMMON_MEDICATIONS.length >= 28);
  assert.ok(MEDICATION_CATEGORIES.length >= 6);
  assert.ok(BUILTIN_KNOWLEDGE_ARTICLES.length >= 5);

  const fever = searchLocalMedications({ query: "高烧浑身疼发冷", mode: "hybrid" });
  assert.ok(fever.medications.length >= 2);
  assert.ok(
    fever.medications.slice(0, 3).some((item) => item.id === "ibuprofen" || item.id === "acetaminophen"),
    "fever query must prioritize ibuprofen or acetaminophen",
  );

  const diarrhea = searchLocalMedications({ query: "吃坏肚子拉稀", mode: "hybrid" });
  assert.ok(
    diarrhea.medications.slice(0, 3).some((item) => item.id === "montmorillonite"),
    "colloquial diarrhea query must retrieve 蒙脱石散",
  );

  const allergy = searchLocalMedications({ query: "皮肤起风团特别痒", mode: "hybrid" });
  assert.ok(
    allergy.medications.slice(0, 3).some((item) => item.id === "loratadine" || item.id === "cetirizine"),
    "allergy symptom must retrieve antihistamines",
  );
});

test("5-tier A/B/C/D/X interaction checker detects lethal alcohol, duplicate acetaminophen, NSAID overlap and driving sedation", () => {
  const acetDrugs = COMMON_MEDICATIONS.filter((d) => d.activeIngredients.includes("对乙酰氨基酚"));
  assert.ok(acetDrugs.length >= 2, "must include multiple acetaminophen-containing drugs");
  const dupAcet = checkLocalMedicationInteractions([acetDrugs[0].id, acetDrugs[1].id]);
  assert.equal(dupAcet.highestSeverity, "X");
  assert.ok(dupAcet.alerts.some((a) => a.id === "dup-acetaminophen"));

  const alcoholRisk = checkLocalMedicationInteractions(["acetaminophen"], { alcohol: true });
  assert.equal(alcoholRisk.highestSeverity, "X");
  assert.ok(alcoholRisk.alerts.some((a) => a.id === "alcohol-liver-gi"));

  const nsaidOverlap = checkLocalMedicationInteractions(["ibuprofen", "aspirin-ec"]);
  assert.equal(nsaidOverlap.highestSeverity, "X");
  assert.ok(nsaidOverlap.alerts.some((a) => a.id === "dup-nsaids"));

  const driving = checkLocalMedicationInteractions(["chlorpheniramine"], { driving: true });
  assert.equal(driving.highestSeverity, "D");
  assert.ok(driving.alerts.some((a) => a.id === "driving-sedation"));

  const timing = checkLocalMedicationInteractions(["omeprazole", "hydrotalcite"]);
  assert.equal(timing.highestSeverity, "C");

  const safe = checkLocalMedicationInteractions(["ors-iii"]);
  assert.equal(safe.highestSeverity, "A");
});

test("hybrid semantic engine supports WorldBook simulation and mode comparison", () => {
  const docs = [
    {
      id: "wb-1",
      title: "深夜失眠安抚仪式",
      category: "陪伴习惯",
      tags: ["失眠", "睡不着", "熬夜"],
      content: "凌晨睡不着时先调暗灯塔天幕到银河22:00，一起听轻音乐并做4-7-8呼吸。",
    },
    {
      id: "wb-2",
      title: "胃痛忌口清单",
      category: "健康偏好",
      tags: ["胃痛", "反酸", "清淡"],
      content: "胃不舒服时避免冰美式和麻辣锅底，优先小米粥与温水。",
    },
  ];
  const engine = createHybridSemanticIndex(docs);
  const out = engine.search("凌晨翻来覆去闭眼睡不着怎么办", { mode: "hybrid", limit: 3 });
  assert.ok(out.results.length >= 1);
  assert.equal(out.results[0].doc.id, "wb-1");
  assert.ok(out.results[0].rrfScore > 0 && out.results[0].rrfScore <= 1);
});

test("KnowledgeMedicineHub and TakeoutWorkspace establish vertical scroll containers inside .view-content", () => {
  const khCss = fs.readFileSync(new URL("../src/knowledge-hub.css", import.meta.url), "utf8");
  const toCss = fs.readFileSync(new URL("../src/takeout-assistant.css", import.meta.url), "utf8");
  assert.match(khCss, /\.kh-page\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(toCss, /\.takeout-workspace\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow-y:\s*auto;/);
});

test("KnowledgeMedicineHub renders all 3 tabs and runs interactive medication safety check", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevFetch = globalThis.fetch;
  const prevNode = globalThis.Node;
  const prevElement = globalThis.Element;
  const prevHTMLElement = globalThis.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  class StubNode {}
  class StubElement extends StubNode {}
  class StubHTMLElement extends StubElement {}
  globalThis.Node = StubNode;
  globalThis.Element = StubElement;
  globalThis.HTMLElement = StubHTMLElement;
  globalThis.window = {
    Node: StubNode,
    Element: StubElement,
    HTMLElement: StubHTMLElement,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    documentElement: { dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ entries: [] }) });

  const vite = await createServer({
    root: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  let tree;
  try {
    const { default: KnowledgeMedicineHub } = await vite.ssrLoadModule(
      "/src/KnowledgeMedicineHub.jsx",
    );
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(KnowledgeMedicineHub, {
          scope: "test-scope",
          aiName: "小灯",
          initialTab: "medications",
          onSendToChat: () => {},
          onOrderTakeout: () => {},
        }),
      );
    });
    const text = JSON.stringify(tree.toJSON());
    assert.match(text, /语义知识库/);
    assert.match(text, /常见药品/);
    assert.match(text, /布洛芬/);
    assert.match(text, /对乙酰氨基酚/);
    assert.match(text, /联合用药/);

    const tabs = tree.root.findAllByProps({ role: "tab" });
    assert.equal(tabs.length, 3);
    await act(async () => {
      tabs[0].props.onClick();
    });
    const kbText = JSON.stringify(tree.toJSON());
    assert.match(kbText, /混合 RRF 融合/);
  } finally {
    if (tree) {
      await act(async () => tree.unmount());
    }
    await vite.close();
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.fetch = prevFetch;
    globalThis.Node = prevNode;
    globalThis.Element = prevElement;
    globalThis.HTMLElement = prevHTMLElement;
  }
});
