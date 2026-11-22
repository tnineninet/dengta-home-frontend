const assert = require("node:assert/strict");
const { createVoiceProviderCenter } = require("../services/voice-provider-center");

const env = {
    MCP_ENCRYPTION_KEY: "voice-provider-encryption-secret-long-enough"
};

function database() {
    const state = { row: null };
    function result(values, insert) {
        state.row = { ...(insert ? {} : state.row || {}), ...values };
        return {
            select() {
                return {
                    async single() { return { data: { ...state.row }, error: null }; }
                };
            },
            then(resolve) { resolve({ data: null, error: null }); }
        };
    }
    return {
        state,
        from(table) {
            assert.equal(table, "voice_provider_profiles");
            return {
                select() {
                    return {
                        async maybeSingle() {
                            return { data: state.row ? { ...state.row } : null, error: null };
                        }
                    };
                },
                insert(values) { return result(values, true); },
                update(values) { return result(values, false); },
                async delete() { state.row = null; return { data: null, error: null }; }
            };
        }
    };
}

async function run() {
    const db = database();
    let capturedBody = null;
    const center = createVoiceProviderCenter({
        database: db,
        env,
        async fetchImpl(url, options) {
            assert.match(url, /^https:\/\/api\.openai\.com\/v1\/audio\/speech$/);
            assert.match(options.headers.Authorization, /^Bearer openai-tenant-key/);
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                headers: { get: (name) => (name.toLowerCase() === "content-type" ? "audio/mpeg" : null) },
                async arrayBuffer() { return Uint8Array.from(Buffer.from("mp3")).buffer; }
            };
        }
    });

    const saved = await center.saveProfile({
        provider: "openai",
        enabled: true,
        model: "nova",
        speed: 1.1,
        credential: "openai-tenant-key"
    });
    assert.equal(saved.provider, "openai");
    assert.equal(saved.configured, true);
    assert.equal(saved.model, "nova");
    assert.doesNotMatch(JSON.stringify(saved), /openai-tenant-key|secret_ciphertext/);

    const status = await center.status();
    assert.equal(status.profile.provider, "openai");
    assert.ok(status.providers.some((item) => item.id === "openai"));
    assert.ok(status.profile.model_options.some((item) => item.id === "nova"));

    const profile = await center.resolveRuntimeProfile();
    assert.equal(profile.provider, "openai");
    assert.equal(profile.model, "nova");
    assert.equal(profile.apiKey, "openai-tenant-key");

    const speech = await center.testProfile({ text: "你好" });
    assert.equal(speech.provider, "openai");
    assert.equal(speech.contentType, "audio/mpeg");
    assert.equal(capturedBody.model, "gpt-4o-mini-tts");
    assert.equal(capturedBody.voice, "nova");
    assert.equal(capturedBody.input, "你好");
    console.log("OpenAI voice provider tests passed");
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
