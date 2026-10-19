import assert from "node:assert/strict";
import test from "node:test";
import { extractMusicRequest } from "../src/music-request-intent.js";

test("explicit song requests extract song and artist before the model starts", () => {
  assert.equal(extractMusicRequest("放《晴天》周杰伦。"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("放一首《晴天》周杰伦，在聊天里播放。"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("播放 晴天 周杰伦"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("不要放歌"), "");
  assert.equal(extractMusicRequest("怎么放歌"), "");
});
