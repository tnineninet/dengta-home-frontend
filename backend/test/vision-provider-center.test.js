const assert = require("node:assert/strict");
const test = require("node:test");
const {
    VisionProviderError,
    publicProfile,
    resolveVisionConfig,
    saveProfile,
    testProfile
} = require("../services/vision-provider-center");

function emptyDb() {
    const chain = {
        select() { return chain; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        insert() { throw new Error("insert must not run for rejected profile"); },
        update() { throw new Error("update must not run for rejected profile"); }
    };
    return { from() { return chain; } };
}

test("public profile never exposes the encrypted secret", () => {
    const profile = publicProfile({
        id: "profile-a",
        enabled: true,
        name: "custom",
        base_url: "https://vision.example.com/v1",
        model: "vision-model",
        auth_type: "bearer",
        secret_ciphertext: "encrypted-secret",
        last_status: "connected",
        last_error_code: null,
        last_checked_at: "2026-10-23T00:00:00.000Z"
    });
    assert.equal(profile.has_secret, true);
    assert.equal(Object.prototype.hasOwnProperty.call(profile, "secret_ciphertext"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(profile, "api_key"), false);
});

test("private or loopback vision endpoints are rejected before persistence", async () => {
    await assert.rejects(
        () => saveProfile(emptyDb(), {
            base_url: "http://127.0.0.1:9999/v1",
            model: "vision-model",
            auth_type: "none",
            enabled: false
        }),
        (error) => error instanceof VisionProviderError && error.code === "VISION_ENDPOINT_INVALID"
    );
});

test("disabled or missing profiles resolve to no vision provider", async () => {
    assert.equal(await resolveVisionConfig(emptyDb()), null);
    await assert.rejects(
        () => testProfile(emptyDb()),
        (error) => error instanceof VisionProviderError && error.code === "VISION_NOT_CONFIGURED"
    );
});
