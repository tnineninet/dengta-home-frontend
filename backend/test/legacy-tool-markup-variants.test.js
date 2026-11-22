const assert = require("node:assert/strict");
const { stripVisibleToolMarkup } = require("../services/legacy-tool-markup");

const polluted = [
    "疼你。",
    "</selectcompanionsticker:bear-hug|>",
    "<|selectreplysuggestions: 抱紧点，今天哪里都不去。 | 把腿盘上来，让我靠一会儿。 |>",
    '<|updatecompanionstatus:{"mood":"温柔又带点掌控欲","place":"卧室床边","focus":"回应奶油的撒娇和称呼","note":"她叫了主人，我顺势回应，给了个温柔的吻。","energy_level":48,"pulse_bpm":102,"hot_zones":["heart"]}>'
].join("\n");

const result = stripVisibleToolMarkup(polluted);
assert.equal(result.text, "疼你。");
assert.equal(result.text.includes("selectcompanionsticker"), false);
assert.equal(result.text.includes("selectreplysuggestions"), false);
assert.equal(result.text.includes("updatecompanionstatus"), false);
assert.deepEqual(
    result.toolCalls.map((call) => call.name),
    ["select_companion_sticker", "select_reply_suggestions"]
);
assert.deepEqual(
    JSON.parse(result.toolCalls[0].arguments),
    { sticker_id: "hug" }
);
assert.deepEqual(
    JSON.parse(result.toolCalls[1].arguments),
    {
        suggestions: [
            "抱紧点，今天哪里都不去。",
            "把腿盘上来，让我靠一会儿。"
        ]
    }
);

const normal = stripVisibleToolMarkup("我只是在说 1 < 2，没有工具标记。");
assert.equal(normal.text, "我只是在说 1 < 2，没有工具标记。");

console.log("legacy tool markup variant tests passed");
