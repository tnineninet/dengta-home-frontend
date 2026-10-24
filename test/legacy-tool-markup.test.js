import test from "node:test";
import assert from "node:assert/strict";
import { stripLegacyToolMarkupForDisplay } from "../src/legacy-tool-markup.js";

const markup = '正文。\n\n<update_companion_status mood="宠溺且无奈" place="DengTa home 的暗光卧室" focus="满足奶油深夜食欲" note="凌晨一点又要点外卖。" energy_level=88 pulse_bpm=102 hot_zones=["heart"] micro_state="无奈地摇摇头" />\n\n尾巴';

test("historical assistant messages hide legacy tool markup", () => {
  assert.equal(stripLegacyToolMarkupForDisplay(markup), "正文。\n\n尾巴");
  assert.equal(stripLegacyToolMarkupForDisplay("<update_companion_status mood=\"x\">text</update_companion_status>"), "");
  assert.equal(stripLegacyToolMarkupForDisplay("普通 <微笑> 文本"), "普通 <微笑> 文本");
});


test("historical function-call text is also hidden", () => {
  const cleaned = stripLegacyToolMarkupForDisplay("好呀 <function=neteseplaysong> <parameter=keyword> 晴天 </parameter> </function> </toolcall>");
  assert.equal(cleaned, "好呀");
  assert.equal(cleaned.includes("function"), false);
});

test("pipe-delimited provider tool tokens are hidden", () => {
  const polluted = [
    "正文。",
    "</selectcompanionsticker:bear-hug|>",
    "<|selectreplysuggestions: 抱紧点 | 把腿盘上来 |>",
    '<|updatecompanionstatus:{"mood":"温柔"}|>',
    '<|post_moment:{"content":"x"}|>',
    "尾巴"
  ].join("\n");
  const cleaned = stripLegacyToolMarkupForDisplay(polluted);
  assert.equal(cleaned, "正文。\n\n尾巴");
  assert.equal(cleaned.includes("selectcompanionsticker"), false);
  assert.equal(cleaned.includes("post_moment"), false);
});
