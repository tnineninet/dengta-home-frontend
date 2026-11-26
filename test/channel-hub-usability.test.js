import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(root, "..", "src", "ChannelHub.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "..", "src", "channel-hub.css"), "utf8");

test("channel binding has copy, countdown and automatic status detection", () => {
    assert.match(source, /copyBindingCode/);
    assert.match(source, /bindingRemainingMs/);
    assert.match(source, /window\.setInterval/);
    assert.match(source, /bind\/status\?channel=/);
    assert.match(source, /复制绑定码/);
    assert.match(source, /channel-hub-code-row/);
});

test("channel binding explains the concrete steps for WeChat and QQ", () => {
    assert.match(source, /channel-hub-steps/);
    assert.match(source, /给 DengTa 机器人发送/);
    assert.match(source, /登录 <strong>\{meta\.label\}<\/strong>/);
    assert.match(css, /\.channel-hub-steps/);
    assert.match(css, /\.channel-hub-copy/);
});

test("channel hub shows unmistakable live status banner and verifiable sync proof card", () => {
    assert.match(source, /\/api\/v2\/qq-cloud/);
    assert.match(source, /\/api\/v2\/channel-sync\/preview/);
    assert.match(source, /channel-hub-live-banner/);
    assert.match(source, /channel-hub-proof-card/);
    assert.match(source, /检测同步证据/);
    assert.match(source, /一键开启完整人设 \+ 最近 15 条记忆并保存/);
    assert.match(source, /\/同步状态/);
    assert.match(css, /\.channel-hub-live-banner\.is-online/);
    assert.match(css, /\.channel-hub-proof-card\.is-warn/);
});
