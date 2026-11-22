const assert = require("node:assert/strict");
const test = require("node:test");
const { hasImageFiles } = require("../services/attachment-helpers");

test("image attachment detection only enables vision for actual images", () => {
    assert.equal(hasImageFiles([]), false);
    assert.equal(hasImageFiles([{ mimetype: "application/pdf" }]), false);
    assert.equal(hasImageFiles([{ mimetype: "video/mp4" }]), false);
    assert.equal(hasImageFiles([{ mimetype: "image/png" }]), true);
    assert.equal(hasImageFiles([{ mimeType: "image/jpeg" }]), true);
    assert.equal(hasImageFiles([{ mimetype: "text/plain" }, { mimetype: "image/webp" }]), true);
});
