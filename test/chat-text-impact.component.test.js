import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act, StrictMode } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const names = ["window", "document", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__textImpactFixture"];
const originals = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const storage = new Map();
const flush = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => globalThis.setImmediate(resolve)); };
class Events {
  listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { [...(this.listeners.get(type) || [])].forEach(listener => listener(event)); }
  get listenerCount() { return [...this.listeners.values()].reduce((total, value) => total + value.size, 0); }
}
let tree, state, props, strict = false, serial = 0, doc, view, trigger;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false,
  appType: "custom", logLevel: "silent", server: { middlewareMode: true, watch: null }, plugins: [{ name: "text-impact-fixture-boundaries", enforce: "pre",
    load(id) {
      if (id.replaceAll("\\", "/").endsWith("/src/text-impact-player.js")) {
        return "export async function playTextImpact(source, options) { return globalThis.__textImpactFixture.play(source, options); }";
      }
    },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/ChatTextImpact.jsx")) {
        return code.replace('import { createPortal } from "react-dom";', "const createPortal = children => children;");
      }
    },
  }] });
const { default: Control } = await vite.ssrLoadModule("/src/ChatTextImpact.jsx");
const preference = await vite.ssrLoadModule("/src/text-impact-preferences.js");
const buttons = () => tree.root.findAllByType("button");
const triggerButton = () => buttons().find(node => Boolean(node.props["aria-expanded"]) || node.props.className?.includes("text-impact-trigger"));
const targetButton = index => buttons().filter(node => "aria-pressed" in node.props)[index];
const modeButton = mode => buttons().find(node => String(node.props.onClick || "").includes(mode));
const output = () => {
  const visit = node => typeof node === "string" ? node : (node?.children || []).map(visit).join("");
  return visit(tree.toJSON());
};
const render = () => strict ? React.createElement(StrictMode, null, React.createElement(Control, props)) : React.createElement(Control, props);
async function mount(changes = {}, useStrict = false) {
  strict = useStrict;
  props = {
    rowRef: { current: { querySelector: selector => selector === ".message-avatar" ? state.avatar : null } },
    scopeKey: `fixture-account-${serial}:companion-a:conversation-a`,
    messageId: "fixture-message-a",
    onAvatarHit: hit => state.hits.push(hit),
    ...changes,
  };
  await act(async () => { tree = TestRenderer.create(render(), { createNodeMock: element => element.type === "button" ? trigger : { contains: () => false } }); await flush(); });
}
async function update(changes) { props = { ...props, ...changes }; await act(async () => { tree.update(render()); await flush(); }); }
async function open() { await act(async () => { triggerButton().props.onClick({ currentTarget: trigger }); await flush(); }); }
async function clickTarget(index) { await act(async () => { targetButton(index).props.onClick(); await flush(); }); }
async function clickMode(mode) { await act(async () => { modeButton(mode).props.onClick(); await flush(); }); }
beforeEach(() => {
  serial++; strict = false;
  doc = Object.assign(new Events(), { body: {}, querySelector: () => ({
    value: "",
    getBoundingClientRect: () => ({ width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40 })
  }) });
  view = Object.assign(new Events(), { innerWidth: 390, innerHeight: 740, setTimeout, clearTimeout });
  trigger = { getBoundingClientRect: () => ({ right: 370, top: 700 }), focus() { state.focuses++; }, contains: target => target === trigger };
  const classList = new Set();
  state = {
    calls: [], hits: [], focuses: 0,
    avatar: {
      classList: {
        add(...names) { names.forEach(name => classList.add(name)); },
        remove(...names) { names.forEach(name => classList.delete(name)); },
        contains(name) { return classList.has(name); },
      },
      offsetWidth: 1,
    },
    async play(source, options) {
      state.calls.push({ source, ...options });
      return { started: true, stop: () => {} };
    },
  };
  for (const [key, value] of Object.entries({
    document: doc, window: view, __textImpactFixture: state,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: () => assert.fail("text impact controls must never call an AI or modify input through an API"),
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); await flush(); });
  tree = null;
  assert.equal(doc.listenerCount + view.listenerCount, 0, "popover listeners must not outlive the control");
});
after(async () => { await vite.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

test("manual controls expose target and direction without starting playback", async () => {
  await mount({ recent: true });
  assert.equal(state.calls.length, 0);
  assert.deepEqual(preference.readTextImpactPreference(props.scopeKey), { auto: false, mode: "scatter", target: "avatar", enabled: true });
  await open();
  assert.ok(targetButton(0));
  assert.ok(targetButton(1));
  assert.ok(modeButton("burst"));
  assert.ok(modeButton("scatter"));
});

test("avatar burst animates the assistant avatar and reports a hit", async () => {
  await mount();
  await open();
  await clickTarget(0);
  await clickMode("burst");
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), true);
  assert.equal(state.hits.length, 1);
  assert.equal(state.hits[0].target, "avatar");
});

test("avatar gravity animates the avatar falling without a hit reaction", async () => {
  await mount();
  await open();
  await clickTarget(0);
  await clickMode("scatter");
  assert.equal(state.avatar.classList.contains("text-impact-avatar-fall"), true);
  assert.equal(state.hits.length, 0);
});

test("composer gravity refuses to animate an empty input", async () => {
  await mount();
  await open();
  await clickTarget(1);
  await clickMode("scatter");
  assert.equal(state.calls.length, 0);
  assert.notEqual(output(), "");
});

test("new completed assistant reply auto plays only once; streaming never starts", async () => {
  const scopeKey = `fixture-account-${serial}:strict-companion:conversation`;
  preference.saveTextImpactPreference(scopeKey, { auto: true, mode: "burst", target: "avatar" });
  await mount({ scopeKey, generating: true, recent: true }, true);
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), false);
  await update({ generating: false });
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), true);
  await update({ recent: true });
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), true);
});

test("reduced motion or a generating reply renders no control", async () => {
  await mount({ generating: true, recent: true });
  assert.equal(tree.toJSON(), null);
  await update({ generating: false, reducedMotion: true });
  assert.equal(tree.toJSON(), null);
});

test("unmount removes the avatar animation it owns", async () => {
  await mount();
  await open();
  await clickTarget(0);
  await clickMode("burst");
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), true);
  await act(async () => { tree.unmount(); await flush(); });
  tree = null;
  assert.equal(state.avatar.classList.contains("text-impact-avatar-burst"), false);
});

test("hidden avatar on phone seamlessly falls back to animating message bubble text", async () => {
  const bubbleClasses = new Set();
  const bubbleNode = {
    classList: {
      add(...names) { names.forEach(n => bubbleClasses.add(n)); },
      remove(...names) { names.forEach(n => bubbleClasses.delete(n)); },
      contains(n) { return bubbleClasses.has(n); },
    },
    offsetWidth: 1,
    textContent: "早安呀，今天也要开心",
  };
  state.avatar.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  await mount({
    rowRef: {
      current: {
        querySelector: (selector) => {
          if (selector === ".message-avatar") return state.avatar;
          if (selector === ".message-content") return bubbleNode;
          return null;
        },
      },
    },
  });
  await open();
  assert.ok(targetButton(2), "third target button 消息文字 must be exposed");
  await clickTarget(0);
  await clickMode("burst");
  assert.equal(bubbleNode.classList.contains("text-impact-bubble-burst"), true);
  assert.equal(state.hits.length, 1);
  assert.equal(state.hits[0].target, "bubble");
});
