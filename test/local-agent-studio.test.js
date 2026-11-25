import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { attachmentKind } from "../src/chat-attachments.js";
import { FEATURE_LABELS, filterFeatures } from "../src/feature-navigation.js";
import {
  addBrowserKbCollection,
  addBrowserKbDocument,
  deleteBrowserKbDocument,
  getBrowserKbOverview,
  getBrowserPolicy,
  searchBrowserKb,
  updateBrowserPolicy,
} from "../src/local-agent-client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Minimal in-memory localStorage mock for Node test runtime
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
};

test("chat-attachments accepts expanded audio, video, subtitle, office, and .motion/.zip resource packs", () => {
  assert.equal(attachmentKind({ name: "clip.mkv", type: "video/x-matroska" }), "video");
  assert.equal(attachmentKind({ name: "demo.motion", type: "application/zip" }), "document");
  assert.equal(attachmentKind({ name: "pack.zip", type: "application/zip" }), "document");
  assert.equal(attachmentKind({ name: "captions.srt", type: "text/plain" }), "document");
  assert.equal(attachmentKind({ name: "deck.pptx", type: "" }), "document");
  assert.equal(attachmentKind({ name: "sheet.xlsx", type: "" }), "document");
  assert.equal(attachmentKind({ name: "bgm.flac", type: "audio/flac" }), "audio");
});

test("feature-navigation registers AI 工作台·剪映 and matches Jianying/adudir keywords", () => {
  assert.equal(FEATURE_LABELS["agent-studio"], "AI 工作台·剪映");
  const hits = filterFeatures([{ id: "agent-studio", label: "AI 工作台·剪映" }], "剪映 adudir");
  assert.equal(hits.length, 1);
});

test("browser/mobile fallback policy and hybrid Knowledge Base CRUD + search work offline", () => {
  memStore.clear();
  const initial = getBrowserPolicy();
  assert.equal(initial.authorized, true);
  assert.equal(initial.scopes.jianying_control, true);

  const updated = updateBrowserPolicy({ scopes: { jianying_control: false } });
  assert.equal(updated.scopes.jianying_control, false);

  addBrowserKbCollection("剪辑知识库", "阿杜导演与剪映实操规范");
  const added = addBrowserKbDocument({
    kbName: "剪辑知识库",
    title: "adudir-open 响度规范",
    content: "对白目标响度为 -18 LUFS，配音为 -16 LUFS，背景音乐 BGM 为 -23 LUFS，真峰上限 -1 dBTP。",
    tags: ["adudir", "响度"],
  });
  assert.equal(added.ok, true);
  assert.ok(added.chunkCount >= 1);

  const search = searchBrowserKb("对白 响度 LUFS", { kbName: "剪辑知识库" });
  assert.equal(search.hits.length, 1);
  assert.match(search.hits[0].snippet, /-18 LUFS/);

  const deleted = deleteBrowserKbDocument(added.documentId);
  assert.equal(deleted.overview.documentCount, 0);
  assert.equal(getBrowserKbOverview().documentCount, 0);
});

test("PWA manifest ships shortcuts and share_target while preserving standalone mobile install fields", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);
  assert.ok(manifest.share_target && manifest.share_target.action.includes("agent-studio"));
});
