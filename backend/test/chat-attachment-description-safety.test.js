const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prepareAttachments } = require("../services/chat-attachments");

const VISION = {
    apiKey: "test",
    baseUrl: "https://example.invalid",
    model: "vision-test"
};
const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4
]);
function imageFile() {
    return {
        originalname: "photo.png",
        mimetype: "image/png",
        buffer: PNG,
        size: PNG.length
    };
}
function fakeVision(text, counter) {
    return async () => {
        counter.count += 1;
        return {
            ok: true,
            status: 200,
            async json() {
                return { choices: [{ message: { content: text } }] };
            }
        };
    };
}

(async () => {
    let fetchCount = 0;
    const refused = await prepareAttachments([imageFile()], {
        vision: VISION,
        imageDescriptionStore: {
            async getOrCreate() {
                return { description: "", refused: true };
            }
        },
        visionFetchImpl: async () => {
            throw new Error("refused store result must not call vision again");
        }
    });
    assert.equal(refused[0].imageDescription, undefined);

    fetchCount = 0;
    const storeFailure = await prepareAttachments([imageFile()], {
        vision: VISION,
        imageDescriptionStore: {
            async getOrCreate() {
                throw new Error("cache unavailable");
            }
        },
        visionFetchImpl: fakeVision(
            "Sorry, as an AI I cannot continue with this adult content.",
            { get count() { return fetchCount; }, set count(v) { fetchCount = v; } }
        )
    });
    assert.equal(storeFailure[0].imageDescription, "", "fallback refusal must be filtered");

    const fallbackNormal = await prepareAttachments([imageFile()], {
        vision: VISION,
        imageDescriptionStore: {
            async getOrCreate() {
                throw new Error("cache unavailable");
            }
        },
        visionFetchImpl: fakeVision("A normal fallback description.", {
            count: 0
        })
    });
    assert.equal(
        fallbackNormal[0].imageDescription,
        "A normal fallback description.",
        "store failure must fail open to a normal vision description"
    );

    let legacyCount = 0;
    const legacy = await prepareAttachments([imageFile()], {
        vision: VISION,
        imageDescriptionStore: null,
        visionFetchImpl: fakeVision(
            "Sorry, as an AI I cannot continue with this adult content.",
            { get count() { return legacyCount; }, set count(v) { legacyCount = v; } }
        )
    });
    assert.equal(legacy[0].imageDescription, "", "legacy refusal must be filtered");

    const normal = await prepareAttachments([imageFile()], {
        vision: VISION,
        imageDescriptionStore: {
            async getOrCreate() {
                return { description: "A cat by the window." };
            }
        },
        visionFetchImpl: async () => {
            throw new Error("cached description should not call vision");
        }
    });
    assert.equal(normal[0].imageDescription, "A cat by the window.");

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(
        serverSource,
        /persistImageDescriptions:\s*input\.attachmentStorageMode !== "ephemeral"/
    );

    console.log("chat attachment description safety tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
