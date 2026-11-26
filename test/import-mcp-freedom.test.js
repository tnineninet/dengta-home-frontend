import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_IMPORT_ACCEPT_STRING,
  CONTENT_IMPORT_SUPPORTED_EXTENSIONS,
  formatWorldBookForExport,
  validateImportFile,
} from "../src/content-import-api.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function textContent(node) {
  if (typeof node === "string") return node;
  return (node?.children || []).map(textContent).join("");
}

test("Expanded 45+ file extensions pass validation while dangerous binaries remain blocked", () => {
  const validFiles = [
    "card.png", "v3.charx", "vault.zip", "lore.yaml", "lore.toml", "book.json5",
    "world.lorebook", "world.worldbook", "card.persona", "chat.mht", "chat.mhtml",
    "sheet.xlsx", "book.epub", "note.rtf", "session.jsonl.zstd", "export.mbox",
    "outline.opml", "evernote.enex", "notes.org", "doc.rst", "backup.sql",
  ];
  for (const name of validFiles) {
    assert.ok(CONTENT_IMPORT_SUPPORTED_EXTENSIONS.test(name), `Expected extension supported: ${name}`);
    assert.equal(validateImportFile({ name, size: 1024 }).name, name);
  }
  assert.match(CONTENT_IMPORT_ACCEPT_STRING, /\.png/);
  assert.match(CONTENT_IMPORT_ACCEPT_STRING, /\.charx/);
  assert.match(CONTENT_IMPORT_ACCEPT_STRING, /\.zip/);
  assert.throws(() => validateImportFile({ name: "bad.exe", size: 10 }), /此入口不支持该格式/);
});

test("World Book multi-format client export generates valid JSON, YAML, CSV, MD and TXT", () => {
  const sample = [{ title: "海边灯塔", keywords: ["灯塔", "海风"], content: "傍晚亮起琥珀光。", priority: 120, constant: true, enabled: true }];
  const jsonOut = formatWorldBookForExport(sample, "json");
  assert.equal(JSON.parse(jsonOut.content).entries["0"].comment, "海边灯塔");
  assert.match(formatWorldBookForExport(sample, "yaml").content, /title: "海边灯塔"/);
  assert.match(formatWorldBookForExport(sample, "csv").content, /海边灯塔/);
  assert.match(formatWorldBookForExport(sample, "md").content, /# 海边灯塔/);
  assert.match(formatWorldBookForExport(sample, "txt").content, /【海边灯塔】/);
});

test("McpMemoryImporter & PersonaFreedomStudio render and complete discover -> preview -> commit & curate -> distill -> export flows", async () => {
  const calls = [];
  const api = {
    async apiRequest(url, options) {
      calls.push({ url, options });
      if (url === "/api/external-memory/mcp-import/sources") {
        return { ok: true, saved_connections: [{ id: "conn-1", name: "我的 Mem0", endpoint: "https://mem0.example.com/mcp", tool_count: 3 }] };
      }
      if (url === "/api/external-memory/mcp-import/discover") {
        return {
          ok: true,
          result: {
            source_label: "我的 Mem0",
            endpoint: "https://mem0.example.com/mcp",
            server_name: "mem0-mcp",
            protocol_version: "2025-03-26",
            adapter_id: "mem0_openmemory",
            adapter_label: "Mem0 / OpenMemory MCP",
            recommended_tool: "get_all_memories",
            suggested_args: {},
            read_only_tools: [{ name: "get_all_memories", description: "列出记忆" }],
          },
        };
      }
      if (url === "/api/external-memory/mcp-import/preview") {
        return {
          ok: true,
          result: {
            source_label: "我的 Mem0",
            endpoint: "https://mem0.example.com/mcp",
            tool_name: "get_all_memories",
            total: 2,
            new_count: 1,
            duplicate_count: 1,
            items: [
              { id: "k1", title: "饮品偏好", summary: "喜欢热抹茶拿铁", category: "mem0", duplicate_of_existing: false, tags: ["饮食"] },
              { id: "k2", title: "已有记忆", summary: "住在海边", category: "mem0", duplicate_of_existing: true, tags: [] },
            ],
          },
        };
      }
      if (url === "/api/external-memory/mcp-import/commit") {
        return { ok: true, result: { ok: true, imported: 1, skipped: 0, total: 1 } };
      }
      if (url === "/api/v2/persona-freedom/curate-memories") {
        return {
          ok: true,
          result: {
            stats: { raw_count: 4, curated_count: 3, duplicate_count: 1, residue_count: 0 },
            world_book_count: 2,
            groups: [{ id: "user_facts", label: "关于你的核心事实与偏好", items: [{ id: "m1", summary: "喜欢雨夜抹茶", category: "user_facts", category_label: "关于你的核心事实与偏好" }] }],
            curated: [{ id: "m1", summary: "喜欢雨夜抹茶", category: "user_facts", category_label: "关于你的核心事实与偏好" }],
            duplicates: [{ id: "m2", summary: "喜欢雨夜抹茶" }],
          },
        };
      }
      if (url === "/api/v2/persona-freedom/distill") {
        return {
          ok: true,
          result: {
            mode: "local_structured",
            model: "local-deterministic-engine",
            distilled_persona: "# 小小灯 · 蒸馏人格档案\n温柔陪伴。",
            memory_stats: { curated_count: 3 },
            world_book_count: 2,
            style_stats: { message_count: 20, average_chars_per_message: 38, address_terms: ["阿海"], top_phrases: ["慢慢来"] },
          },
        };
      }
      if (url === "/api/v2/persona-freedom/export") {
        return {
          ok: true,
          format: "agents_md",
          filename: "DengTa-小小灯-AGENTS.md",
          mime_type: "text/markdown; charset=utf-8",
          encoding: "utf8",
          size: 128,
          content: "# AGENTS.md — 小小灯",
        };
      }
      throw new Error(`Unexpected API URL: ${url}`);
    },
  };

  const prevWindow = globalThis.window;
  const prevCustomEvent = globalThis.CustomEvent;
  const savedExports = [];
  globalThis.window = {
    dispatchEvent: () => {},
    DengTaFileBridge: { saveExport: (dataUrl, filename) => savedExports.push({ dataUrl, filename }) },
  };
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

  const vite = await createServer({ root: projectRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { default: McpMemoryImporter } = await vite.ssrLoadModule("/src/McpMemoryImporter.jsx");
    const { default: PersonaFreedomStudio } = await vite.ssrLoadModule("/src/PersonaFreedomStudio.jsx");

    // 1. Test McpMemoryImporter
    let r1;
    await act(async () => { r1 = TestRenderer.create(React.createElement(McpMemoryImporter, { api })); });
    const discoverBtn = r1.root.find((n) => n.type === "button" && textContent(n).includes("探测服务与记忆工具"));
    await act(async () => discoverBtn.props.onClick());
    assert.match(textContent(r1.toJSON()), /Mem0 \/ OpenMemory MCP/);
    const previewBtn = r1.root.find((n) => n.type === "button" && textContent(n).includes("拉取只读记忆预览"));
    await act(async () => previewBtn.props.onClick());
    assert.match(textContent(r1.toJSON()), /新增 1/);
    const commitBtn = r1.root.find((n) => n.type === "button" && textContent(n).includes("确认导入选中的记忆"));
    await act(async () => commitBtn.props.onClick());
    assert.match(textContent(r1.toJSON()), /导入完成：新增同步 1 条/);
    await act(async () => r1.unmount());

    // 2. Test PersonaFreedomStudio
    let r2;
    await act(async () => { r2 = TestRenderer.create(React.createElement(PersonaFreedomStudio, { api })); });
    const curateBtn = r2.root.find((n) => n.type === "button" && textContent(n).includes("扫描并整理本机记忆"));
    await act(async () => curateBtn.props.onClick());
    assert.match(textContent(r2.toJSON()), /去重精选/);
    const distillBtn = r2.root.find((n) => n.type === "button" && textContent(n).includes("一键蒸馏当前伴侣人格"));
    await act(async () => distillBtn.props.onClick());
    assert.match(textContent(r2.toJSON()), /本地极速零 Token 蒸馏完成/);
    const exportBtn = r2.root.find((n) => n.type === "button" && textContent(n).includes("导出 .md"));
    await act(async () => exportBtn.props.onClick());
    assert.equal(savedExports[0]?.filename, "DengTa-小小灯-AGENTS.md");
    await act(async () => r2.unmount());
  } finally {
    await vite.close();
    globalThis.window = prevWindow;
    globalThis.CustomEvent = prevCustomEvent;
  }
});
