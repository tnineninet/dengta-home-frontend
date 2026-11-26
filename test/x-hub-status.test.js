import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveXConnectionState } from "../src/x-hub-utils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("resolveXConnectionState never false-matches non-X MCP connections containing letter x", () => {
  const res = resolveXConnectionState([
    {
      id: "conn-1",
      name: "阿杜导演 x 剪映工作台",
      endpoint: "https://example.com/mcp",
      enabled: true,
      last_status: "connected",
      discovered_tools: [{ name: "adudir_analyze_media" }],
    },
    {
      id: "conn-2",
      name: "Project X Memory",
      endpoint: "https://mem.example.com/mcp",
      enabled: true,
      last_status: "connected",
      discovered_tools: [{ name: "search_memory" }],
    },
  ]);
  assert.equal(res.state, "none");
  assert.equal(res.connection, null);
});

test("resolveXConnectionState distinguishes disabled, offline/error, missing-tools, and truly connected states", () => {
  const disabled = resolveXConnectionState([
    {
      id: "x-1",
      name: "X / Twitter",
      enabled: false,
      last_status: "connected",
      discovered_tools: [{ name: "search_tweets" }, { name: "post_tweet" }],
    },
  ]);
  assert.equal(disabled.state, "disabled");

  const offline = resolveXConnectionState([
    {
      id: "x-2",
      name: "X / Twitter",
      enabled: true,
      last_status: "error",
      last_error: "ECONNREFUSED",
      discovered_tools: [{ name: "search_tweets" }],
    },
  ]);
  assert.equal(offline.state, "disconnected");
  assert.match(offline.reason, /ECONNREFUSED/);

  const zeroTools = resolveXConnectionState([
    {
      id: "x-3",
      name: "X / Twitter twikit",
      enabled: true,
      last_status: "connected",
      discovered_tools: [],
    },
  ]);
  assert.equal(zeroTools.state, "disconnected");

  const healthy = resolveXConnectionState([
    {
      id: "x-4",
      name: "My Twikit Gateway",
      enabled: true,
      last_status: "connected",
      discovered_tools: [{ name: "search_tweets" }, { name: "post_tweet" }],
    },
  ]);
  assert.equal(healthy.state, "connected");
  assert.equal(healthy.connection.xTools.length, 2);
});

test("XHub renders honest states, live connectivity test, and never hardcodes MCP 网关在线", () => {
  const jsx = fs.readFileSync(path.join(root, "src", "XHub.jsx"), "utf8");
  assert.match(jsx, /resolveXConnectionState/);
  assert.match(jsx, /实测连通性/);
  assert.match(jsx, /一键启用并实测连通/);
  assert.match(jsx, /当前未连接 X \/ Twitter/);
  assert.doesNotMatch(jsx, /MCP 网关在线/);
  assert.doesNotMatch(jsx, /\\bx\\b/);
});
