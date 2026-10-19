import assert from "node:assert/strict";
import test from "node:test";
import { extractMusicRequest, isRandomMusicRequest } from "../src/music-request-intent.js";

test("explicit song requests extract song and artist before the model starts", () => {
  assert.equal(extractMusicRequest("放《晴天》周杰伦。"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("放一首《晴天》周杰伦，在聊天里播放。"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("播放 晴天 周杰伦"), "晴天 周杰伦");
  assert.equal(extractMusicRequest("不要放歌"), "");
  assert.equal(extractMusicRequest("怎么放歌"), "");
  assert.equal(extractMusicRequest("放个假"), "");
  assert.equal(extractMusicRequest("放点儿盐"), "");
  assert.equal(extractMusicRequest("播放列表"), "");
  assert.equal(extractMusicRequest("放首歌"), "");
});

test("random music requests are explicit but not keyword-based", () => {
  assert.equal(isRandomMusicRequest("随便来首歌"), true);
  assert.equal(isRandomMusicRequest("来点音乐"), true);
  assert.equal(isRandomMusicRequest("不要放歌"), false);
  assert.equal(isRandomMusicRequest("怎么放歌"), false);
});
