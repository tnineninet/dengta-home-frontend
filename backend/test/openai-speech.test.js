const assert = require("node:assert/strict");
const {
    OPENAI_TTS_VOICES,
    assertSafeOpenAiBaseUrl,
    isPrivateNetworkAddress,
    normalizeOpenAiBaseUrl,
    normalizeOpenAiVoice,
    synthesizeOpenAiSpeech
} = require("../services/openai-speech");

async function run() {
    let captured = null;
    const speech = await synthesizeOpenAiSpeech({
        text: "你好，欢迎回家。",
        apiKey: "sk-filtered-test-key",
        voice: "nova",
        speed: 1.05,
        async fetchImpl(url, options) {
            captured = { url, options, body: JSON.parse(options.body) };
            return {
                ok: true,
                status: 200,
                headers: {
                    get(name) {
                        return name.toLowerCase() === "content-type"
                            ? "audio/mpeg; charset=binary"
                            : null;
                    }
                },
                async arrayBuffer() {
                    return Uint8Array.from(Buffer.from("mp3-audio")).buffer;
                }
            };
        }
    });
    assert.equal(captured.url, "https://api.openai.com/v1/audio/speech");
    assert.match(captured.options.headers.Authorization, /^Bearer sk-/);
    assert.equal(captured.body.model, "gpt-4o-mini-tts");
    assert.equal(captured.body.voice, "nova");
    assert.equal(captured.body.input, "你好，欢迎回家。");
    assert.equal(captured.body.speed, 1.05);
    assert.equal(speech.provider, "openai");
    assert.equal(speech.voice, "nova");
    assert.equal(speech.contentType, "audio/mpeg");
    assert.equal(speech.audio.toString(), "mp3-audio");
    assert.equal(normalizeOpenAiVoice("unknown"), "alloy");
    assert.equal(normalizeOpenAiVoice("NOVA"), "nova");
    assert.equal(normalizeOpenAiBaseUrl("https://tts.example.com/v1"), "https://tts.example.com/v1");
    assert.ok(OPENAI_TTS_VOICES.includes("alloy"));

    assert.equal(isPrivateNetworkAddress("127.0.0.1"), true);
    assert.equal(isPrivateNetworkAddress("10.0.0.8"), true);
    assert.equal(isPrivateNetworkAddress("172.20.1.2"), true);
    assert.equal(isPrivateNetworkAddress("192.168.1.9"), true);
    assert.equal(isPrivateNetworkAddress("::1"), true);
    assert.equal(isPrivateNetworkAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateNetworkAddress("8.8.8.8"), false);
    assert.throws(() => normalizeOpenAiBaseUrl("https://[::1]"), /IPv6|私有/);
    let blockedFetch = false;
    await assert.rejects(
        () => synthesizeOpenAiSpeech({
            text: "test",
            apiKey: "sk-test",
            baseUrl: "https://[::1]",
            fetchImpl: async () => { blockedFetch = true; }
        }),
        /IPv6|私有/
    );
    assert.equal(blockedFetch, false, "private IPv6 TTS URL must be rejected before fetch");

    let redirectFollowed = false;
    await assert.rejects(
        () => synthesizeOpenAiSpeech({
            text: "test",
            apiKey: "sk-test",
            async fetchImpl(url, options) {
                assert.equal(options.redirect, "manual");
                redirectFollowed = true;
                return {
                    ok: false,
                    status: 302,
                    headers: { get: () => null },
                    async text() { return ""; }
                };
            }
        }),
        /不允许重定向/
    );
    assert.equal(redirectFollowed, true);

    await assert.rejects(
        () =>
            synthesizeOpenAiSpeech({
                text: "test",
                apiKey: "sk-invalid",
                async fetchImpl() {
                    return {
                        ok: false,
                        status: 401,
                        headers: { get: () => "application/json" },
                        async text() { return "unauthorized"; }
                    };
                }
            }),
        /API Key 无效/
    );
    console.log("OpenAI speech tests passed");
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
