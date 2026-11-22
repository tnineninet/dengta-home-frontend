const assert = require("node:assert/strict");
const {
    createImageDescriptionStore,
    imageSha256
} = require("../services/image-descriptions");

function fakeDatabase(initialRows = []) {
    const rows = initialRows.map((row) => ({ ...row }));
    return {
        rows,
        from(table) {
            assert.equal(table, "image_descriptions");
            let filters = {};
            let operation = "select";
            let values = null;
            const builder = {
                select() { return builder; },
                insert(next) { operation = "insert"; values = next; return builder; },
                eq(column, value) { filters[column] = value; return builder; },
                maybeSingle: async () => {
                    if (operation === "insert") {
                        const duplicate = rows.find(
                            (row) =>
                                row.user_id === values.user_id &&
                                row.companion_id === values.companion_id &&
                                row.sha256 === values.sha256
                        );
                        if (duplicate) return { data: null, error: { code: "23505" } };
                        rows.push({ ...values });
                        return { data: { ...values }, error: null };
                    }
                    return {
                        data: rows.find((row) =>
                            Object.entries(filters).every(([key, value]) => row[key] === value)
                        ) || null,
                        error: null
                    };
                }
            };
            return builder;
        }
    };
}

(async () => {
    const buffer = Buffer.from("same-image-bytes");
    const sha = imageSha256(buffer);
    assert.equal(sha.length, 64);
    assert.equal(sha, imageSha256(Buffer.from("same-image-bytes")));
    assert.notEqual(sha, imageSha256(Buffer.from("different-image-bytes")));

    let calls = 0;
    const database = fakeDatabase();
    const store = createImageDescriptionStore({
        database,
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () => {
            calls += 1;
            return "一张测试图片。";
        }
    });
    const first = await store.getOrCreate({ buffer, mimeType: "image/jpeg" });
    const second = await store.getOrCreate({ buffer, mimeType: "image/jpeg" });
    assert.equal(first.description, "一张测试图片。");
    assert.equal(second.description, "一张测试图片。");
    assert.equal(second.cached, true);
    assert.equal(calls, 1, "identical bytes must only be described once");
    assert.equal(database.rows.length, 1);

    const permissionDatabase = {
        from() {
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                insert() { return builder; },
                maybeSingle: async () => {
                    throw Object.assign(new Error("permission denied"), {
                        code: "42501"
                    });
                }
            };
            return builder;
        }
    };
    const permissionStore = createImageDescriptionStore({
        database: permissionDatabase,
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () => "A cat by the window."
    });
    const permissionResult = await permissionStore.getOrCreate({
        buffer,
        mimeType: "image/jpeg"
    });
    assert.equal(
        permissionResult.description,
        "A cat by the window.",
        "cache permission errors must fail open and keep the direct description"
    );

    const refusalDatabase = fakeDatabase();
    const refusalStore = createImageDescriptionStore({
        database: refusalDatabase,
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () =>
            "Sorry, as an AI I cannot continue with this adult content."
    });
    const refusalResult = await refusalStore.getOrCreate({
        buffer: Buffer.from("refusal-image"),
        mimeType: "image/jpeg"
    });
    assert.equal(refusalResult.description, "");
    assert.equal(refusalDatabase.rows.length, 0);

    const missingTableDatabase = {
        from() {
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                insert() { return builder; },
                async maybeSingle() {
                    return {
                        data: null,
                        error: { code: "PGRST205", message: "missing table" }
                    };
                }
            };
            return builder;
        }
    };
    let missingDescribeCalls = 0;
    const missingStore = createImageDescriptionStore({
        database: missingTableDatabase,
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () => {
            missingDescribeCalls += 1;
            return "A cached description is optional.";
        }
    });
    const missingResult = await missingStore.getOrCreate({ buffer, mimeType: "image/jpeg" });
    assert.equal(missingResult.description, "A cached description is optional.");
    assert.equal(missingDescribeCalls, 1);
    assert.equal(missingResult.cached, false);

    const throwingStore = createImageDescriptionStore({
        database: fakeDatabase(),
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () => {
            throw new Error("vision unavailable");
        }
    });
    const throwingResult = await throwingStore.getOrCreate({ buffer, mimeType: "image/jpeg" });
    assert.equal(throwingResult.description, "");
    assert.equal(throwingResult.failed, true);

    const cachedRefusalDatabase = fakeDatabase([
        {
            sha256: sha,
            description: "Sorry, as an AI I cannot continue with this adult content.",
            source: "vision",
            model: "vision-test"
        }
    ]);
    const cachedRefusalStore = createImageDescriptionStore({
        database: cachedRefusalDatabase,
        vision: { apiKey: "x", baseUrl: "https://example.invalid", model: "vision-test" },
        describe: async () => "A normal image description."
    });
    const cachedRefusalResult = await cachedRefusalStore.getOrCreate({
        buffer,
        mimeType: "image/jpeg"
    });
    assert.equal(cachedRefusalResult.description, "A normal image description.");

    console.log("image description cache tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
