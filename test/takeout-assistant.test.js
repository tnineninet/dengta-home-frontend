import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { buildTakeoutRequest, formatTakeoutPrice, takeoutMenuChoices, takeoutPaymentReady, takeoutShopChoices, takeoutStepIndex, updateTakeoutTask } from "../src/takeout-assistant.js";

const words = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(words).join("");
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const scope = "fictional-account-and-companion-A";
const command = (action, id = action) => ({ id, command: { action, requirement: action === "order" ? "番茄鸡蛋饭" : "热乎的饭", shop_name: action === "search" ? "" : "虚构小馆" } });
const paymentReceipt = { ok: true, receipt_synced: true, status: "ready_for_payment", total: 28.5, lines: [{ name: "番茄鸡蛋饭", quantity: 1 }], paymentSubmitted: false };
const apply = (previous, action, type, extra = {}) => updateTakeoutTask(previous, { scope, command: command(action), type, ...extra });

test("takeout request describes total budget, people and optional preferences without turning people into item quantity", () => {
  const request = buildTakeoutRequest({ query: " 热乎的饭 ", budget: "58.50", people: "2", note: " 不要香菜 " });
  assert.equal(request.ok, true);
  assert.equal(request.query, "热乎的饭");
  assert.equal(request.budget, 58.5);
  assert.equal(request.people, 2);
  assert.equal(request.note, "不要香菜");
  assert.ok(request.text.includes("2 人用餐"));
  assert.ok(request.text.includes("含配送及包装的总预算不超过 58.5 元"));
  assert.ok(request.text.includes("不要香菜"));
  assert.ok(request.text.includes("停在付款前"));
  assert.ok(!request.text.includes("购买2份"));
  assert.equal(buildTakeoutRequest({ query: "先看看", budget: "" }).budget, null);
  for (const budget of ["0", "-1", "Infinity", "not a number", "100001"]) assert.equal(buildTakeoutRequest({ query: "饭", budget }).ok, false, budget);
  assert.equal(buildTakeoutRequest({ query: "   " }).ok, false);
});

test("search and menu stages advance only after successful synchronized receipts", () => {
  let task = apply(null, "search", "start");
  assert.deepEqual(task.completed, []);
  task = apply(task, "search", "progress", { message: "正在等待平台页面" });
  assert.deepEqual(task.completed, []);
  const foreign = updateTakeoutTask(task, { scope, command: command("search", "stale-id"), type: "progress", message: "迟到进度" });
  assert.equal(foreign, task);
  task = apply(task, "search", "done", { outcome: { ok: true, receipt_synced: true, shops: [{ name: "虚构小馆" }] } });
  assert.deepEqual(task.completed, ["search"]);
  assert.equal(task.shops[0].name, "虚构小馆");
  task = apply(task, "menu", "start");
  assert.deepEqual(task.completed, ["search"]);
  task = apply(task, "menu", "done", { outcome: { ok: true, receipt_synced: true, products: [{ name: "番茄鸡蛋饭", price: 23 }] } });
  assert.deepEqual(task.completed, ["search", "menu"]);
  assert.equal(task.products[0].name, "番茄鸡蛋饭");
  assert.equal(task.status, "working");
});

test("payment handoff requires explicit ready status, real amount, line quantities, no payment and synced receipt", () => {
  const working = apply(null, "order", "start");
  const ready = apply(working, "order", "done", { outcome: paymentReceipt });
  assert.equal(ready.status, "awaiting_payment");
  assert.equal(ready.total, 28.5);
  const variants = [
    { status: "done" }, { status: "awaiting_payment" }, { total: null }, { total: 0 }, { total: NaN }, { total: "28.5" },
    { lines: [] }, { lines: null }, { lines: [{ name: "饭", quantity: 0 }] }, { lines: [{ name: " ", quantity: 1 }] },
    { lines: [{ name: "饭", quantity: 1.5 }] }, { paymentSubmitted: true }, { paymentSubmitted: undefined }, { receipt_synced: false }, { ok: false },
  ];
  for (const variant of variants) {
    const task = apply(working, "order", "done", { outcome: { ...paymentReceipt, ...variant } });
    assert.notEqual(task.status, "awaiting_payment", JSON.stringify(variant));
    assert.equal(task.total, null);
  }
});

test("failed work never becomes a completed step or successful payment message", () => {
  const working = apply(null, "order", "start");
  const failed = apply(working, "order", "done", { outcome: { ok: false, receipt_synced: true, status: "error", code: "takeout_budget_exceeded", message: "实际金额超过预算，请检查购物车。" } });
  assert.equal(failed.status, "error");
  assert.deepEqual(failed.completed, []);
  assert.equal(failed.code, "takeout_budget_exceeded");
  assert.equal(failed.total, null);
  const unknown = apply(working, "order", "done", { outcome: { ok: true, receipt_synced: false, message: "结果还没有同步。" } });
  assert.equal(unknown.status, "manual_review");
  assert.deepEqual(unknown.completed, []);
});

test("manual pause survives late progress, successful result and subsequent command callbacks", () => {
  const paused = { ...apply(null, "order", "start"), pausedByUser: true, status: "manual_review", executing: false };
  for (const event of [
    { type: "progress", command: command("order"), message: "继续选餐" },
    { type: "done", command: command("order"), outcome: paymentReceipt },
    { type: "start", command: command("menu", "late-menu") },
  ]) {
    const task = updateTakeoutTask(paused, { scope, ...event });
    assert.equal(task.pausedByUser, true);
    assert.equal(task.status, "manual_review");
    assert.equal(task.executing, false);
    assert.deepEqual(task.completed, []);
  }
});

test("real App pause completion cannot overwrite a new run or a returned A scope", async () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = app.indexOf("async function pauseTakeoutFromChat()");
  assert.ok(start >= 0);
  const end = app.indexOf("\n  }\n", start);
  assert.ok(end > start);
  const source = app.slice(start, end + "\n  }".length);
  for (const switchedAway of [false, true]) {
    const stop = deferred();
    let state = { scope, runId: "old-run", status: "working", executing: true, message: "旧任务正在运行" };
    const owner = { scope }, takeoutLifetimeRef = { current: owner }, takeoutConstraintsRef = { current: null };
    const bindings = {
      takeoutLifetimeRef, takeoutConstraintsRef, takeoutTask: state, privateMediaScope: scope,
      setTakeoutTask: update => { state = update(state); },
      abortChatRequest() {}, chatRequestRef: { current: null },
      stopTakeoutAutomation: () => stop.promise,
      diagnosticScopeKey: () => scope, accountStorageScope: "account-A", companionScope: "companion-A",
      componentMountedRef: { current: true }, settingsSaveScope: () => scope, authSession: { getSnapshot: () => ({}) },
    };
    const pause = new Function(...Object.keys(bindings), `return (${source});`)(...Object.values(bindings));
    const finished = pause();
    assert.equal(state.pausedByUser, true);
    if (switchedAway) {
      takeoutLifetimeRef.current = { scope: "B" };
      takeoutLifetimeRef.current = { scope };
    }
    state = { scope, runId: switchedAway ? "old-run" : "new-run", status: "working", executing: true, message: "当前任务继续运行" };
    stop.resolve({ ok: true, message: "旧暂停调用返回" });
    await finished;
    assert.equal(state.status, "working", switchedAway ? "A→B→A lifetime" : "same-scope new run");
    assert.equal(state.message, "当前任务继续运行");
  }
});

test("real takeout assistant preserves drafts, task scope and payment truth while requests are pending", async t => {
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { activeElement: null, visibilityState: "visible" });
  for (const [name, value] of [["window", win], ["document", doc], ["IS_REACT_ACT_ENVIRONMENT", true]]) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { default: Assistant, TakeoutTaskCard } = await vite.ssrLoadModule("/src/TakeoutAssistant.jsx");
    const { appBackLayers } = await vite.ssrLoadModule("/src/app-back-navigation.js");
    function fixture(extra = {}) {
      let tree;
      let props = { scope, open: true, available: true, onClose() {}, onStart: async () => ({ ok: true }), ...extra };
      return {
        async mount() { await act(async () => { tree = TestRenderer.create(React.createElement(Assistant, props)); }); },
        async update(next) { props = { ...props, ...next }; await act(async () => tree.update(React.createElement(Assistant, props))); },
        text: () => words(tree.toJSON()),
        start: () => tree.root.findAllByType("button").find(node => node.props.className === "takeout-start"),
        button: label => tree.root.findAllByType("button").find(node => node.props["aria-label"] === label || words(node.props.children) === label),
        input: label => tree.root.findAllByType("input").find(node => node.props["aria-label"] === label),
        query: () => tree.root.findByType("textarea"),
        note: () => tree.root.findAllByType("input").find(node => node.props.maxLength === 300),
        select: () => tree.root.findByType("select"),
        steps: () => tree.root.findAllByType("li").map(node => ({ label: words(node.props.children), className: node.props.className })),
        alerts: () => tree.root.findAll(node => node.props.role === "alert").map(node => words(node.props.children)),
        async close() { if (tree) await act(async () => tree.unmount()); tree = null; },
      };
    }
    await t.test("two start calls in the same tick submit once and preserve edited preferences", async () => {
      const pending = deferred(), requests = [];
      const h = fixture({ onStart: request => { requests.push(request); return pending.promise; } });
      try {
        await h.mount();
        await act(async () => {
          h.query().props.onChange({ target: { value: "想吃热汤面" } });
          h.input("含配送费的总预算").props.onChange({ target: { value: "42" } });
          h.select().props.onChange({ target: { value: "2" } });
          h.note().props.onChange({ target: { value: "少辣" } });
        });
        const start = h.start().props.onClick;
        await act(async () => { start(); start(); });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].budget, 42);
        assert.equal(requests[0].people, 2);
        assert.equal(requests[0].note, "少辣");
        assert.equal(h.start().props.disabled, true);
        await act(async () => pending.resolve({ ok: true }));
        assert.equal(h.start().props.disabled, false);
        assert.equal(h.query().props.value, "想吃热汤面");
        assert.deepEqual(h.alerts(), []);
      } finally { await h.close(); }
    });
    await t.test("busy or unavailable controls never launch native work", async () => {
      let calls = 0;
      const h = fixture({ initialQuery: "想吃饭", busy: true, onStart: () => { calls++; return { ok: true }; } });
      try {
        await h.mount(); assert.equal(h.start().props.disabled, true);
        await act(async () => h.start().props.onClick()); assert.equal(calls, 0);
        await h.update({ busy: false, available: false }); assert.equal(h.start().props.disabled, true);
        await act(async () => h.start().props.onClick()); assert.equal(calls, 0);
        await h.update({ available: true, scope: "" }); assert.equal(h.start().props.disabled, true);
        await act(async () => h.start().props.onClick()); assert.equal(calls, 0);
      } finally { await h.close(); }
    });
    await t.test("folding and system back close only the sheet and keep the task and draft intact", async () => {
      let closes = 0, stops = 0;
      const task = apply(null, "menu", "start");
      const h = fixture({ task, onClose: () => { closes++; }, onStop: () => { stops++; } });
      try {
        await h.mount();
        await act(async () => h.query().props.onChange({ target: { value: "编辑中的晚饭需求" } }));
        await act(async () => h.button("收起外卖弹窗").props.onClick());
        assert.equal(closes, 1); assert.equal(stops, 0);
        await h.update({ open: false }); assert.equal(h.text(), "");
        await h.update({ open: true }); assert.equal(h.query().props.value, "编辑中的晚饭需求");
        assert.ok(h.text().includes("正在查看这家店的真实菜单"));
        assert.equal(h.start().props.disabled, true);
        await act(async () => { assert.equal(appBackLayers.closeTop(), true); });
        assert.equal(closes, 2); assert.equal(stops, 0);
        await act(async () => h.button("暂停自动操作，我来看看").props.onClick());
        assert.equal(stops, 1);
      } finally { await h.close(); }
      assert.equal(appBackLayers.closeTop(), false);
    });
    await t.test("A to B to A cannot receive the first A request's late error or disable its fresh form", async () => {
      const requests = [deferred(), deferred()]; let calls = 0;
      const h = fixture({ initialQuery: "饭", onStart: () => requests[calls++].promise });
      try {
        await h.mount(); await act(async () => h.start().props.onClick());
        await h.update({ scope: "fictional-B" }); await h.update({ scope });
        assert.equal(h.start().props.disabled, false);
        await act(async () => h.start().props.onClick()); assert.equal(calls, 2);
        await act(async () => requests[0].resolve({ ok: false, message: "过期账号A的错误" }));
        assert.ok(!h.text().includes("过期账号A的错误")); assert.equal(h.start().props.disabled, true);
        await act(async () => requests[1].resolve({ ok: true })); assert.equal(h.start().props.disabled, false);
      } finally { await h.close(); }
    });
    await t.test("scope change hides previous companion's menu, amount and payment status", async () => {
      const task = apply(apply(null, "order", "start"), "order", "done", { outcome: paymentReceipt });
      const h = fixture({ task });
      try {
        await h.mount(); assert.ok(h.text().includes("¥28.50")); assert.ok(h.text().includes("等你核对付款"));
        await h.update({ scope: "fictional-B" });
        assert.ok(!h.text().includes("¥28.50")); assert.ok(!h.text().includes("虚构小馆")); assert.ok(!h.text().includes("等你核对付款"));
      } finally { await h.close(); }
    });
    await t.test("only a verified payment receipt produces payment CTA, price and current final step", async () => {
      const initial = apply(null, "order", "start");
      const ready = apply(initial, "order", "done", { outcome: paymentReceipt });
      const h = fixture({ task: ready });
      try {
        await h.mount(); assert.ok(h.text().includes("等你核对付款")); assert.ok(h.text().includes("¥28.50"));
        assert.ok(h.steps().find(step => step.label.endsWith("你来付款")).className.includes("is-current"));
        for (const outcome of [{ ...paymentReceipt, total: null }, { ...paymentReceipt, lines: [] }, { ...paymentReceipt, paymentSubmitted: true }, { ...paymentReceipt, receipt_synced: false }]) {
          await h.update({ task: apply(initial, "order", "done", { outcome }) });
          assert.ok(!h.text().includes("等你核对付款")); assert.ok(!h.text().includes("¥28.50"));
          assert.ok(!h.steps().find(step => step.label.endsWith("你来付款")).className.includes("is-current"));
        }
      } finally { await h.close(); }
    });
    await t.test("error and missing price stay recoverable without a successful order claim", async () => {
      const task = apply(apply(null, "order", "start"), "order", "done", { outcome: { ok: false, receipt_synced: true, status: "error", code: "takeout_budget_exceeded", message: "实际金额超过预算，请检查购物车。" } });
      const h = fixture({ task, initialQuery: "饭", onStart: async () => ({ ok: false, message: "连接没能开始" }) });
      try {
        await h.mount(); assert.ok(h.text().includes("点餐暂时停下了")); assert.ok(h.text().includes("takeout_budget_exceeded"));
        assert.ok(!h.text().includes("等你核对付款")); assert.ok(!h.text().includes("¥0.00"));
        assert.ok(!h.steps().some(step => step.className.includes("is-complete")));
        await act(async () => h.start().props.onClick()); assert.deepEqual(h.alerts(), ["连接没能开始"]);
      } finally { await h.close(); }
    });
    await t.test("rejected start reports uncertainty without exposing arbitrary errors", async () => {
      const h = fixture({ initialQuery: "饭", onStart: async () => { throw Error("fictional-private-provider-body"); } });
      try {
        await h.mount(); await act(async () => h.start().props.onClick());
        assert.equal(h.alerts().length, 1); assert.ok(h.alerts()[0].includes("避免重复操作"));
        assert.ok(!h.text().includes("fictional-private-provider-body")); assert.equal(h.start().props.disabled, false);
      } finally { await h.close(); }
    });
    await t.test("menu choices, shop candidates and the payment review action come from the real task", async () => {
      let reviewed = 0;
      const menuTask = apply(apply(null, "menu", "start"), "menu", "done", { outcome: {
        ok: true, receipt_synced: true, products: [{ name: "番茄鸡蛋饭", price: 23, available: true }, { name: "售罄的那道", price: null, available: false }]
      } });
      const ready = apply({ ...menuTask, shop: "虚构小馆", shops: [{ name: "虚构小馆", meta: "虚构小馆 | 4.9 | 分 | 起送¥20" }] }, "order", "done", { outcome: paymentReceipt });
      const h = fixture({ task: ready, onReview: () => { reviewed++; } });
      try {
        await h.mount();
        assert.ok(h.text().includes("虚构小馆 的真实菜单"));
        assert.ok(h.text().includes("番茄鸡蛋饭"));
        assert.ok(h.text().includes("AI 选中"));
        assert.ok(h.text().includes("售罄的那道"));
        assert.ok(h.text().includes("价格待确认"));
        assert.ok(h.text().includes("已经核对的这一单"));
        assert.ok(h.text().includes("× 1"));
        assert.ok(h.text().includes("不会替你付款"));
        await act(async () => h.button("回到平台页面付款").props.onClick());
        assert.equal(reviewed, 1);
      } finally { await h.close(); }
    });
    await t.test("task card exposes only current state and opens the task without starting another order", async () => {
      let opens = 0, tree;
      const task = apply(apply(null, "order", "start"), "order", "done", { outcome: paymentReceipt });
      try {
        await act(async () => { tree = TestRenderer.create(React.createElement(TakeoutTaskCard, { task, onOpen: () => { opens++; } })); });
        assert.ok(words(tree.toJSON()).includes("等你核对付款"));
        assert.ok(words(tree.toJSON()).includes("¥28.50"), "a ready card shows the real total");
        assert.ok(words(tree.toJSON()).includes("4/4 · 你来付款"), "a ready card shows the current stage");
        await act(async () => tree.root.findByType("button").props.onClick()); assert.equal(opens, 1);
        await act(async () => tree.update(React.createElement(TakeoutTaskCard, { task: null }))); assert.equal(tree.toJSON(), null);
      } finally { if (tree) await act(async () => tree.unmount()); }
    });
  } finally {
    await vite.close();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
test("menu and shop projections expose only safe real values and a stable step index", () => {
  assert.equal(formatTakeoutPrice(28.5), "¥28.50");
  assert.equal(formatTakeoutPrice(null), "");
  assert.deepEqual(takeoutMenuChoices({ products: [
    { name: " 番茄鸡蛋饭 ", price: 23, available: true },
    { name: "", price: 10 },
    { name: "售罄的那道", price: null, available: false },
    { name: "负价格", price: -1 }
  ] }), [
    { name: "番茄鸡蛋饭", price: 23, available: true },
    { name: "售罄的那道", price: null, available: false },
    { name: "负价格", price: null, available: true }
  ]);
  assert.deepEqual(takeoutShopChoices({ shops: [
    { name: "虚构小馆", meta: "虚构小馆 | 4.9 | 分 | 起送¥20" },
    { shop_name: "没有评分的店" }
  ] }), [
    { name: "虚构小馆", meta: "虚构小馆 | 4.9 | 分 | 起送¥20", rating: 4.9 },
    { name: "没有评分的店", meta: "", rating: null }
  ]);
  assert.equal(takeoutStepIndex({ status: "awaiting_payment", action: "order" }), 3);
  assert.equal(takeoutStepIndex({ status: "working", action: "menu" }), 1);
  assert.equal(takeoutStepIndex(null), -1);
  assert.equal(takeoutPaymentReady({ status: "awaiting_payment", total: 28.5, lines: [{ name: "饭", quantity: 1 }] }), true);
  assert.equal(takeoutPaymentReady({ status: "awaiting_payment", total: null, lines: [] }), false);
});

test("a retryable miss keeps the task working instead of ending it in error", () => {
  const started = apply(null, "menu", "start");
  const retried = apply(started, "menu", "done", { outcome: {
    ok: false, receipt_synced: true, retryable: true, code: "takeout_product_not_found", message: "这家没有合适的，正在换一家继续看。"
  } });
  assert.equal(retried.status, "working");
  assert.equal(retried.executing, false);
  assert.equal(retried.code, "takeout_product_not_found");
  assert.deepEqual(retried.completed, []);
  assert.equal(retried.message, "这家没有合适的，正在换一家继续看。");
});
