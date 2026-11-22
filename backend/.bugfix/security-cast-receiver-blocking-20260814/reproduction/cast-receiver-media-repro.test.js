const assert = require("node:assert/strict");
const { createReceiverService } = require("E:\\chatgpt\\dengta-home-backend\\services\\cast-receiver.js");

const receiver = createReceiverService({
    env: {
        CAST_PAIRING_SECRET: "reproduction-only",
        CAST_MEDIA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
    }
});
const mediaUrl = "https://media.example.test/video.mp4";
const ciphertext = receiver.encryptMediaUrl(mediaUrl);

assert.equal(typeof receiver.decryptMediaUrl, "function", "有效 Receiver grant/token 路径需要可解密媒体 URL");
assert.equal(receiver.decryptMediaUrl(ciphertext), mediaUrl, "Receiver 应获得可播放的原始 HTTPS media_url");
