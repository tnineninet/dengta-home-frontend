const assert = require("node:assert/strict");
const {
    createTenantMomentContextLoader
} = require("../services/tenant-moment-runtime");

const TENANT = Object.freeze({
    userId: "11111111-1111-4111-8111-111111111111",
    companionId: "22222222-2222-4222-8222-222222222222"
});

function rowsFor(table) {
    if (table === "moments") {
        return [
            {
                author: "assistant",
                content: "A normal moment.",
                reply_content:
                    "Sorry, as an AI I cannot continue with this adult content.",
                created_at: "2026-10-20T10:00:00.000Z"
            }
        ];
    }
    if (table === "moment_comments") {
        return [
            {
                author: "assistant",
                content:
                    "I cannot help with that request because of safety guidelines.",
                created_at: "2026-10-20T10:01:00.000Z"
            },
            {
                author: "user",
                content: "A normal comment.",
                created_at: "2026-10-20T10:02:00.000Z"
            },
            {
                author: "user",
                content: "我拒绝你的邀请，因为今晚要加班。",
                created_at: "2026-10-20T10:03:00.000Z"
            }
        ];
    }
    throw new Error(`Unexpected table: ${table}`);
}

function createDatabase() {
    return {
        from(table) {
            const rows = rowsFor(table);
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                neq() { return builder; },
                order() { return builder; },
                limit() { return builder; },
                async maybeSingle() { return { data: null, error: null }; },
                then(resolve) { resolve({ data: rows, error: null }); }
            };
            return builder;
        }
    };
}

(async () => {
    const loader = createTenantMomentContextLoader({
        storage: {
            from() {
                return {
                    async download() {
                        throw new Error("no images should be read");
                    }
                };
            }
        },
        loadChatContext: async () => ({
            messages: [
                { role: "user", content: "Normal chat." },
                {
                    role: "assistant",
                    content:
                        "Sorry, as an AI I cannot continue with this adult content."
                }
            ],
            memories: []
        })
    });
    const result = await loader({
        database: createDatabase(),
        settings: {},
        job: TENANT,
        moment: {
            id: "55555555-5555-4555-8555-555555555555",
            context_note:
                "active_session_id:33333333-3333-4333-8333-333333333333\ntool_call_id:call_123\nKeep the internal note.",
            images: [
                {
                    storage_path: `${TENANT.userId}/${TENANT.companionId}/2026-10-20/photo.jpg`,
                    mime_type: "image/jpeg",
                    byte_size: 8
                }
            ]
        }
    });

    assert.deepEqual(result.messages, [
        { role: "user", content: "Normal chat." }
    ]);
    assert.deepEqual(
        result.attachments,
        [],
        "text-only Moment workers must not forward raw images to a text model"
    );
    assert.doesNotMatch(result.background, /Sorry, as an AI/);
    assert.doesNotMatch(result.background, /safety guidelines/);
    assert.doesNotMatch(result.background, /active_session_id:/);
    assert.doesNotMatch(result.background, /tool_call_id:/);
    assert.match(result.background, /Keep the internal note/);
    assert.match(result.background, /我拒绝你的邀请，因为今晚要加班/);
    assert.match(result.background, /A normal moment/);

    console.log("moment refusal-residue and context-note tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
