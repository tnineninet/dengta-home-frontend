import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  OPHTHALMIC_DRUGS,
  MEDICAL_RAG_BENCHMARK,
  OPHTHALMIC_KNOWLEDGE_ENTRIES,
  OPHTHALMIC_PERIOP_PROTOCOLS,
  SAMPLE_CLINICAL_REPORTS,
  SAMPLE_CROSS_DEVICE_PRESETS,
  SAMPLE_LONGITUDINAL_VISITS,
  ZSH_COHORT_BENCHMARK,
  analyzeLongitudinalVisits,
  buildGroundedMedicalPrompt,
  checkOphthalmicDrugSafety,
  formatClinicalSummaryMarkdown,
  parseOphthalmicReportText,
  runCrossDeviceValidation,
  searchMedicalRag,
  validateOphthalmicRecord,
} from "../src/medical-ai-data.js";

test("frontend migrated medical datasets match zsh clinical knowledge, 27 drugs, 4 protocols and anonymized cohort", () => {
  assert.equal(OPHTHALMIC_KNOWLEDGE_ENTRIES.length, 29);
  assert.equal(OPHTHALMIC_DRUGS.length, 27);
  assert.equal(OPHTHALMIC_PERIOP_PROTOCOLS.length, 4);
  assert.equal(SAMPLE_CLINICAL_REPORTS.length, 3);
  assert.equal(ZSH_COHORT_BENCHMARK.cohortKpi.totalRecords, 36);
  assert.equal(ZSH_COHORT_BENCHMARK.cohortKpi.uniquePatients, 9);
  assert.equal(ZSH_COHORT_BENCHMARK.calibration.optimalT, 0.653);
  assert.equal(MEDICAL_RAG_BENCHMARK.queryCount, 36);
  assert.equal(MEDICAL_RAG_BENCHMARK.ragAblation.length, 4);
});

test("frontend L1 clinical validator catches RSB/PTA redlines, Keratoconus, Thin-Cornea IOP mask & shallow ACD mydriatic suppression", () => {
  const rsb = validateOphthalmicRecord({
    template_id: "zeiss_treatment",
    fields: { treatment_type: "FS-LASIK", cct: "485", ablation_depth: "112", sphere: "-7.50", cylinder: "-1.00", optical_zone: "6.5" },
  });
  assert.equal(rsb.validation_status, "REVIEW");
  assert.ok(rsb.alerts.some((a) => a.rule === "RSB_SAFETY_REDLINE"));
  assert.ok(rsb.alerts.some((a) => a.rule === "PTA_SAFETY_REDLINE"));

  const kc = validateOphthalmicRecord({
    template_id: "cornea",
    fields: { kmax_front: "49.1", thinnest_locat_pachy: "458", pachy_apex_pachy: "465", enter_iop: "19.5" },
  });
  assert.equal(kc.validation_status, "REVIEW");
  assert.ok(kc.alerts.some((a) => a.rule === "KERATOCONUS_SCREEN"));
  assert.ok(kc.alerts.some((a) => a.rule === "THIN_CORNEA_IOP_MASK"));

  const acd = validateOphthalmicRecord({
    template_id: "iolmaster",
    fields: { al: "26.82", acd: "2.35", cct: "522", k1: "43.2", k2: "42.5" },
  });
  assert.ok(acd.alerts.some((a) => a.rule === "SHALLOW_ACD_MYDRIATIC_RISK"));
  assert.ok(!acd.recommendations.drugs.some((d) => d.id === "tropicamide_phenylephrine"));
});

test("frontend free-text parser cleans OCR artifacts, drug safety catches X-level risks & L2/L3 RAG builds [M1] citations", () => {
  const parsed = parseOphthalmicReportText(SAMPLE_CLINICAL_REPORTS[0].text);
  assert.equal(parsed.template_id, "zeiss_treatment");
  assert.equal(parsed.fields.eye, "OD");
  assert.equal(parsed.fields.treatment_type, "FS-LASIK");
  assert.equal(parsed.fields.cct, "485");
  const parsedVal = validateOphthalmicRecord(parsed);
  assert.equal(parsedVal.validation_status, "REVIEW");
  assert.ok(parsedVal.alerts.some((a) => a.rule === "RSB_SAFETY_REDLINE"));
  assert.ok(parsedVal.alerts.some((a) => a.rule === "PTA_SAFETY_REDLINE"));

  const parsedPentacam = parseOphthalmicReportText(SAMPLE_CLINICAL_REPORTS[1].text);
  assert.equal(parsedPentacam.template_id, "cornea");
  assert.equal(parsedPentacam.fields.kmax_front, "49.1");

  const timolol = checkOphthalmicDrugSafety(["timolol"], { asthmaOrBradycardia: true });
  assert.equal(timolol.highestSeverity, "X");

  const rag = searchMedicalRag({ query: "做完激光晚上开车炫光暗瞳太大用什么眼药水", mode: "hybrid", limit: 5 });
  assert.ok(rag.results.length >= 2);
  assert.ok(rag.results.some((r) => r.id.includes("pupil") || r.id.includes("brimonidine") || r.id.includes("optical_zone")));

  const prompt = buildGroundedMedicalPrompt({
    question: SAMPLE_CLINICAL_REPORTS[0].question,
    validationResult: validateOphthalmicRecord(parsed),
    mode: "hybrid",
    limit: 4,
  });
  assert.match(prompt.prompt, /L1 确定性临床规则校验结果/);
  assert.match(prompt.prompt, /\[M1\]/);
});

test("MedicalAiStudio establishes a vertical scroll container inside .view-content", () => {
  const css = fs.readFileSync(new URL("../src/medical-ai-studio.css", import.meta.url), "utf8");
  assert.match(css, /\.med-studio-page\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow-y:\s*auto;/);
});

test("frontend cross-device consistency validator & longitudinal analyzer match E:\\zsh clinical rules", () => {
  const conflict = runCrossDeviceValidation(SAMPLE_CROSS_DEVICE_PRESETS.conflict);
  assert.equal(conflict.status, "REVIEW");
  assert.ok(conflict.findings.some((f) => f.rule === "CROSS_DOC_CCT_CRITICAL"));
  assert.ok(conflict.findings.some((f) => f.rule === "CROSS_DOC_K1_CRITICAL"));

  const ok = runCrossDeviceValidation(SAMPLE_CROSS_DEVICE_PRESETS.consistent);
  assert.equal(ok.status, "PASS");

  const trend = analyzeLongitudinalVisits(SAMPLE_LONGITUDINAL_VISITS);
  assert.equal(trend.status, "REVIEW");
  assert.ok(trend.alerts.some((a) => a.rule === "STEROID_IOP_SPIKE"));
  assert.ok(trend.alerts.some((a) => a.rule === "RAPID_AXIAL_PROGRESSION"));

  const md = formatClinicalSummaryMarkdown({ crossDeviceResult: conflict, longitudinalResult: trend });
  assert.match(md, /Zero-PII/);
  assert.match(md, /CROSS_DOC_CCT_CRITICAL/);
});

test("MedicalAiStudio renders all 6 tabs cleanly and sends Grounded RAG prompt to chat", async () => {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
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

  const vite = await createServer({
    root: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  let tree;
  const sentPrompts = [];
  try {
    const { default: MedicalAiStudio } = await vite.ssrLoadModule("/src/MedicalAiStudio.jsx");
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(MedicalAiStudio, {
          aiName: "小灯",
          onSendToChat: (prompt) => sentPrompts.push(prompt),
          onOpenHouseholdMeds: () => {},
        }),
      );
    });

    const tabs = tree.root.findAllByProps({ role: "tab" });
    assert.equal(tabs.length, 6);
    assert.match(JSON.stringify(tree.toJSON()), /RSB_SAFETY_REDLINE/);

    const flatten = (node) =>
      typeof node === "string" || typeof node === "number"
        ? String(node)
        : Array.isArray(node)
          ? node.map(flatten).join("")
          : (node?.children || []).map(flatten).join("");
    const sendBtn = tree.root.findAllByType("button").find((b) => flatten(b).includes("带着临床证据问"));
    assert.ok(sendBtn, "must render chat RAG handoff button");
    await act(async () => sendBtn.props.onClick());
    assert.equal(sentPrompts.length, 1);
    assert.match(sentPrompts[0], /\[M1\]/);

    // Switch through Tabs 2..6 (Follow-Up, RAG, Formulary, Cohort, Architecture)
    await act(async () => tabs[1].props.onClick());
    const followJson = JSON.stringify(tree.toJSON());
    assert.match(followJson, /CROSS_DOC_CCT_CRITICAL/);
    assert.match(followJson, /STEROID_IOP_SPIKE/);
    assert.match(followJson, /Zero-PII/);

    await act(async () => tabs[2].props.onClick());
    assert.match(JSON.stringify(tree.toJSON()), /统一医疗混合语义 RAG 检索引擎/);

    await act(async () => tabs[3].props.onClick());
    assert.match(JSON.stringify(tree.toJSON()), /氟米龙滴眼液/);

    await act(async () => tabs[4].props.onClick());
    const cohortJson = JSON.stringify(tree.toJSON());
    assert.match(cohortJson, /四阶段 OCR \+ 临床语义消融精确率/);
    assert.match(cohortJson, /L2 医疗 RAG 消融实测 Recall@1/);

    await act(async () => tabs[5].props.onClick());
    assert.match(JSON.stringify(tree.toJSON()), /确定性临床规则护栏 \+ 混合语义增强 RAG/);
  } finally {
    if (tree) {
      await act(async () => tree.unmount());
    }
    await vite.close();
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    globalThis.Node = prevNode;
    globalThis.Element = prevElement;
    globalThis.HTMLElement = prevHTMLElement;
  }
});
