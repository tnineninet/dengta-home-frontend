const {
    handleTenantMomentInteraction
} = require("./tenant-moment-interaction");
const {
    createImageDescriptionStore,
    imageSha256
} = require("./image-descriptions");
const {
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue
} = require("./persistent-memory-filter");

const MOMENT_BUCKET = "moments";
const MAX_MOMENT_IMAGES = 4;
const MAX_MOMENT_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = Object.freeze({
    "image/jpeg": (buffer) =>
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff,
    "image/png": (buffer) =>
        buffer.length >= 8 &&
        buffer
            .subarray(0, 8)
            .equals(
                Buffer.from([
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
                ])
            ),
    "image/webp": (buffer) =>
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP",
    "image/gif": (buffer) =>
        buffer.length >= 6 &&
        ["GIF87a", "GIF89a"].includes(
            buffer.subarray(0, 6).toString("ascii")
        )
});

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function cleanStoragePath(value) {
    const storagePath = String(value || "").trim();
    if (
        !storagePath ||
        storagePath.includes("\\") ||
        storagePath.startsWith("/") ||
        storagePath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
        return "";
    }
    return storagePath;
}

function ownedMomentImageDescriptor(value, job) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const storagePath = cleanStoragePath(value.storage_path);
    const mimeType = String(value.mime_type || "")
        .trim()
        .toLowerCase();
    const byteSize = Math.max(0, Number(value.byte_size) || 0);
    const expectedPrefix = `${job.user_id}/${job.companion_id}/`;
    if (
        !storagePath.startsWith(expectedPrefix) ||
        typeof IMAGE_TYPES[mimeType] !== "function" ||
        byteSize > MAX_MOMENT_IMAGE_BYTES
    ) {
        return null;
    }
    return {
        storagePath,
        mimeType,
        sha256: /^[0-9a-f]{64}$/.test(String(value.sha256 || ""))
            ? String(value.sha256)
            : ""
    };
}

async function blobBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value.arrayBuffer === "function") {
        return Buffer.from(await value.arrayBuffer());
    }
    return null;
}

async function loadMomentImageAttachments({ storage, job, moment }) {
    const descriptors = (Array.isArray(moment?.images) ? moment.images : [])
        .slice(0, MAX_MOMENT_IMAGES)
        .map((value) => ownedMomentImageDescriptor(value, job))
        .filter(Boolean);
    const attachments = [];

    for (const descriptor of descriptors) {
        const { data, error } = await storage
            .from(MOMENT_BUCKET)
            .download(descriptor.storagePath);
        if (error) throw error;
        if (
            Number(data?.size) > MAX_MOMENT_IMAGE_BYTES ||
            (data?.type &&
                String(data.type).toLowerCase() !== descriptor.mimeType)
        ) {
            continue;
        }
        const bytes = await blobBuffer(data);
        if (
            !bytes ||
            !bytes.length ||
            bytes.length > MAX_MOMENT_IMAGE_BYTES ||
            !IMAGE_TYPES[descriptor.mimeType](bytes)
        ) {
            continue;
        }
        attachments.push({
            mimeType: descriptor.mimeType,
            data: bytes.toString("base64")
        });
    }

    return attachments;
}

async function loadMomentImageContext({
    storage,
    job,
    moment,
    imageDescriptionStore
}) {
    const descriptors = (Array.isArray(moment?.images) ? moment.images : [])
        .slice(0, MAX_MOMENT_IMAGES)
        .map((value) => ownedMomentImageDescriptor(value, job))
        .filter(Boolean);
    const attachments = [];
    const imageDescriptions = [];

    for (const descriptor of descriptors) {
        let cached = null;
        if (descriptor.sha256 && imageDescriptionStore?.readBySha) {
            cached = await imageDescriptionStore.readBySha(descriptor.sha256);
        }
        if (cached?.description) {
            imageDescriptions.push({
                sha256: descriptor.sha256,
                description: String(cached.description)
            });
            continue;
        }

        const { data, error } = await storage
            .from(MOMENT_BUCKET)
            .download(descriptor.storagePath);
        if (error) throw error;
        if (
            Number(data?.size) > MAX_MOMENT_IMAGE_BYTES ||
            (data?.type &&
                String(data.type).toLowerCase() !== descriptor.mimeType)
        ) {
            continue;
        }
        const bytes = await blobBuffer(data);
        if (
            !bytes ||
            !bytes.length ||
            bytes.length > MAX_MOMENT_IMAGE_BYTES ||
            !IMAGE_TYPES[descriptor.mimeType](bytes)
        ) {
            continue;
        }
        const sha256 = descriptor.sha256 || imageSha256(bytes);
        let described = null;
        if (imageDescriptionStore) {
            described = await imageDescriptionStore.getOrCreate({
                buffer: bytes,
                mimeType: descriptor.mimeType
            });
        }
        if (described?.description) {
            imageDescriptions.push({
                sha256,
                description: String(described.description)
            });
            continue;
        }
        attachments.push({
            mimeType: descriptor.mimeType,
            data: bytes.toString("base64")
        });
    }

    if (!imageDescriptions.length && moment?.image_description) {
        imageDescriptions.push({
            sha256: "",
            description: String(moment.image_description)
        });
        attachments.length = 0;
    }

    return { attachments, imageDescriptions };
}

function hintedConversationId(moment) {
    const match = String(moment?.context_note || "").match(
        /active_session_id:([0-9a-f-]{36})/i
    );
    return match && UUID_PATTERN.test(match[1]) ? match[1] : "";
}

async function latestConversationId(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return UUID_PATTERN.test(String(data?.id || "")) ? data.id : "";
}

async function loadInteractionBackground({ database, moment }) {
    const momentId = String(moment?.id || "");
    const [timelineResult, commentsResult] = await Promise.all([
        database
            .from("moments")
            .select("author, content, reply_content, created_at")
            .neq("id", momentId)
            .order("created_at", { ascending: false })
            .limit(5),
        database
            .from("moment_comments")
            .select("author, content, created_at")
            .eq("moment_id", momentId)
            .order("created_at", { ascending: true })
            .limit(20)
    ]);
    if (timelineResult.error) throw timelineResult.error;
    if (commentsResult.error) throw commentsResult.error;

    const timeline = (timelineResult.data || [])
        .slice()
        .reverse()
        .map((item) => {
            const author = item.author === "assistant" ? "AI" : "用户";
            const reaction =
                item.reply_content &&
                !isProviderBoundaryResidue(item.reply_content) &&
                !/^\[image_desc\]/i.test(item.reply_content)
                    ? `；AI 回应：${cleanText(item.reply_content, 160)}`
                    : "";
            return `${author}动态：${cleanText(item.content, 180)}${reaction}`;
        })
        .join("\n");
    const comments = (commentsResult.data || [])
        .filter((item) => !isProviderBoundaryResidue(item.content))
        .map(
            (item) =>
                `${item.author === "assistant" ? "AI" : "用户"}：${cleanText(
                    item.content,
                    200
                )}`
        )
        .join("\n");
    const internalNote = cleanText(moment?.context_note, 1000)
        .replace(/active_session_id:[^\s]+/gi, "")
        .replace(/tool_call_id:[^\s]+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return [
        timeline ? `【最近朋友圈】\n${timeline}` : "",
        comments ? `【当前动态的评论链】\n${comments}` : "",
        internalNote ? `【当前动态内部备注】\n${internalNote}` : ""
    ]
        .filter(Boolean)
        .join("\n\n");
}

function createTenantMomentContextLoader({
    storage,
    loadCompanionInteractionContext,
    loadChatContext,
    vision = null
} = {}) {
    if (!storage || typeof storage.from !== "function") {
        throw new TypeError("Moment context storage is required.");
    }
    const useMainChatContext = typeof loadChatContext === "function";
    if (!useMainChatContext && typeof loadCompanionInteractionContext !== "function") {
        throw new TypeError(
            "loadChatContext or loadCompanionInteractionContext must be a function."
        );
    }

    return async function loadTenantMomentContext({
        database,
        settings,
        job,
        moment
    }) {
        const conversationId =
            hintedConversationId(moment) ||
            (await latestConversationId(database));
        const contextPromise = conversationId
            ? useMainChatContext
                ? loadChatContext(conversationId, settings, database)
                : loadCompanionInteractionContext(
                      conversationId,
                      settings,
                      database
                  )
            : Promise.resolve({ messages: [], memories: [] });
        const backgroundPromise = useMainChatContext
            ? loadInteractionBackground({ database, moment })
            : Promise.resolve("");
        const imagePromise = vision
            ? loadMomentImageContext({
                  storage,
                  job,
                  moment,
                  imageDescriptionStore: createImageDescriptionStore({
                      database,
                      vision
                  })
              })
            : Promise.resolve({
                  attachments: [],
                  imageDescriptions: moment?.image_description
                      ? [
                            {
                                sha256: "",
                                description: String(moment.image_description)
                            }
                        ]
                      : []
              });

        const [context, background, imageContext] = await Promise.all([
            contextPromise,
            backgroundPromise,
            imagePromise
        ]);
        const result = {
            messages: filterProviderBoundaryMessages(
                Array.isArray(context?.messages) ? context.messages : []
            ),
            memories: Array.isArray(context?.memories)
                ? context.memories
                : [],
            attachments: imageContext.attachments
        };
        if (useMainChatContext || vision) {
            result.background = background;
            result.imageDescriptions = imageContext.imageDescriptions;
        }
        return result;
    };
}

function createTenantMomentInteractionHandler({
    storage,
    generateReply,
    getSettings,
    loadCompanionInteractionContext,
    loadChatContext,
    vision = null,
    handleInteraction = handleTenantMomentInteraction,
    now = Date.now
} = {}) {
    if (typeof handleInteraction !== "function") {
        throw new TypeError("handleInteraction must be a function.");
    }
    const loadContext = createTenantMomentContextLoader({
        storage,
        loadCompanionInteractionContext,
        loadChatContext,
        vision
    });
    return ({ job, database, lease }) =>
        handleInteraction({
            job,
            database,
            lease,
            generateReply,
            getSettings,
            loadContext,
            now
        });
}

module.exports = {
    MAX_MOMENT_IMAGE_BYTES,
    MAX_MOMENT_IMAGES,
    createTenantMomentContextLoader,
    createTenantMomentInteractionHandler,
    loadMomentImageAttachments
};
