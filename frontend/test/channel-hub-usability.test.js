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
