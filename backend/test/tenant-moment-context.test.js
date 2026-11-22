const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
    createTenantMomentContextLoader
} = require("../services/tenant-moment-runtime");

const TENANT = Object.freeze({
    userId: "11111111-1111-4111-8111-111111111111",
    companionId: "22222222-2222-4222-8222-222222222222"
});
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function rowsFor(table) {
    if (table === "moments") {
        return [
            {
                id: "44444444-4444-4444-8444-444444444444",
                author: "assistant",
                content: "昨天晚霞很好看。",
                reply_content: null,
                created_at: "2026-10-20T10:00:00.000Z"
            }
        ];
    }
    if (table === "moment_comments") {
        return [
            {
                author: "user",
                content: "今天呢？",
                created_at: "2026-10-20T10:01:00.000Z"
            }
        ];
    }
    if (table === "image_descriptions") {
        return [
            {
                sha256: "a".repeat(64),
                description: "一张窗边猫咪的图片。",
                source: "vision",
                model: "vision-test"
            }
        ];
    }
    throw new Error(`Unexpected table: ${table}`);
}

function createDatabase() {
    return {
        from(table) {
            const rows = rowsFor(table);
            let filters = {};
            const builder = {
                select() { return builder; },
                eq(column, value) { filters[column] = value; return builder; },
                neq() { return builder; },
                order() { return builder; },
                limit() { return builder; },
                async maybeSingle() {
                    return {
                        data:
                            rows.find((row) =>
                                Object.entries(filters).every(
                                    ([key, value]) => row[key] === value
                                )
                            ) || null,
                        error: null
                    };
                },
                then(resolve) {
                    resolve({ data: rows, error: null });
                }
            };
            return builder;
        }
    };
}

(async () => {
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    const sha256 = createHash("sha256").update(imageBytes).digest("hex");
    // Use a cached row with the actual hash so no vision/network call is needed.
    const database = createDatabase();
    const originalFrom = database.from.bind(database);
    database.from = (table) => {
        if (table === "image_descriptions") {
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                async maybeSingle() {
                    return {
                        data: {
                            sha256,
                            description: "一张窗边猫咪的图片。",
                            source: "vision",
                            model: "vision-test"
                        },
                        error: null
                    };
                }
            };
            return builder;
        }
        return originalFrom(table);
    };
    let downloads = 0;
    const storage = {
        from() {
            return {
                async download() {
                    downloads += 1;
                    throw new Error("cached description should avoid image download");
                }
            };
        }
    };
    let contextCalls = 0;
    const loader = createTenantMomentContextLoader({
        storage,
        loadChatContext: async (conversationId, settings, scopedDatabase) => {
            contextCalls += 1;
            assert.equal(conversationId, SESSION_ID);
            assert.equal(scopedDatabase, database);
            return {
                messages: [{ role: "user", content: "最近聊天" }],
                memories: [{ summary: "长期记忆" }]
            };
        },
        vision: {
            apiKey: "test",
            baseUrl: "https://example.invalid",
            model: "vision-test"
        }
    });

    const result = await loader({
        database,
        settings: {},
        job: {
            user_id: TENANT.userId,
            companion_id: TENANT.companionId
        },
        moment: {
            id: "55555555-5555-4555-8555-555555555555",
            context_note: `active_session_id:${SESSION_ID}\n今天心情很轻。`,
            image_description: null,
            images: [
                {
                    storage_path: `${TENANT.userId}/${TENANT.companionId}/2026-10-20/cat.jpg`,
                    mime_type: "image/jpeg",
                    byte_size: imageBytes.length,
                    sha256
                }
            ]
        }
    });

    assert.equal(contextCalls, 1);
    assert.equal(downloads, 0);
    assert.deepEqual(result.messages, [{ role: "user", content: "最近聊天" }]);
    assert.deepEqual(result.memories, [{ summary: "长期记忆" }]);
    assert.deepEqual(result.attachments, []);
    assert.deepEqual(result.imageDescriptions, [
        { sha256, description: "一张窗边猫咪的图片。" }
    ]);
    assert.match(result.background, /最近朋友圈/);
    assert.match(result.background, /当前动态的评论链/);
    assert.match(result.background, /今天心情很轻/);
    assert.match(result.background, /昨天晚霞很好看/);
    assert.match(result.background, /今天呢/);

    console.log("tenant moment four-layer context tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
