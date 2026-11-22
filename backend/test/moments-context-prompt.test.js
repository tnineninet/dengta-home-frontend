const assert = require("node:assert/strict");
const { buildMomentInteractionPrompt } = require("../services/tenant-moment-interaction");

const prompt = buildMomentInteractionPrompt({
    moment: {
        id: "00000000-0000-4000-8000-000000000001",
        content: "今天路过一家店。",
        context_note: "active_session_id:session-1\n今天心情很轻。"
    },
    comment: { content: "哪家店？" },
    context: {
        background: "【最近朋友圈】\nAI 动态：昨天拍了晚霞。\n【当前动态的评论链】\n用户：好看。",
        imageDescriptions: [
            { sha256: "a".repeat(64), description: "窗边的橘猫，下午的暖光。" }
        ]
    }
});
assert.match(prompt, /最近朋友圈/);
assert.match(prompt, /当前动态的评论链/);
assert.match(prompt, /图片 1：窗边的橘猫/);
assert.match(prompt, /今天路过一家店/);
assert.match(prompt, /哪家店/);

console.log("moment four-layer prompt tests passed");
