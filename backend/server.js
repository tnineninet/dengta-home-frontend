const { readDiagnosticLog } = require("./services/diagnostic-log-reader");
const { hasImageFiles } = require("./services/attachment-helpers");
const { createSurpriseMapRouter } = require("./services/surprise-map");
const { generateSurpriseMapDraft } = require("./services/surprise-map-draft");
const { generateSurpriseMapPublicDraft } = require("./services/surprise-map-public-draft");
const { createSurpriseMapMcpRouter } = require("./services/surprise-map-mcp");
const { resolveCompressionThreshold } = require("./services/context-history");
const { diagnosticRecord, publicDiagnosticLog, safeDiagnosticCode } = require("./services/diagnostic-errors");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { createAgentsMdStatusHandler, loadAgentsMdPreview } = require("./services/agents-md-status");
const { loadOptionalChatContext } = require("./services/chat-optional-context");
const {
    resolveContextWindow: budgetResolveContextWindow,
    adaptiveMessageLimit: budgetAdaptiveMessageLimit
} = require("./services/context-budget");
const { buildTriageContext } = require("./services/triage-router");
const {
    ingestPoint: whereaboutsIngestPoint,
    getSnapshot: whereaboutsSnapshot,
    getCurrentStay: whereaboutsCurrentStay,
    getRecentStays: whereaboutsRecentStays,
    getRecentMoves: whereaboutsRecentMoves,
    getSummary: whereaboutsSummary
} = require("./services/whereabouts");
const {
    writeTimelineDay: timelineWriteDay,
    readTimelineDay: timelineReadDay,
    listTimelineCategories: timelineListCategories,
    listTimelineProposals: timelineListProposals
} = require("./services/timeline");
const {
    listWorkspace,
    readWorkspaceFile,
    writeWorkspaceFile,
    deleteWorkspaceFile
} = require("./services/workspace");

const { randomUUID } = require("crypto");
const { version: appVersion } = require("./package.json");
const { createClient } = require("@supabase/supabase-js");
const {
    MAIN_CHAT_PROMPT_ARCHITECTURE,
    generateReply,
    generateReplyStream,
    generateMemorySummary,
    generateMomentReaction,
    generateReplyOptions
} = require("./services/ai-service");
const {
    UPDATE_COMPANION_STATUS_TOOL,
    applyCompanionStatusUpdate,
    buildCompanionStatusRuntimeContext,
    parseCompanionStatusToolArguments,
    sanitizeCompanionStatusSnapshot
} = require("./services/companion-status");
const {
    createCompanionInteractionGuard,
    runCompanionInteraction
} = require("./services/companion-interaction");
const { refreshCompanionStatus } = require("./services/companion-status-refresh");
const {
    reserveStatusRefresh,
    releaseStatusRefresh
} = require("./services/status-refresh-policy");
const {
    runVisibleInnerMonologue
} = require("./services/visible-inner-monologue");
const {
    assertPromptFieldsDoNotContainSecrets
} = require("./services/prompt-security");
const {
    appendShadowUserTrigger,
    buildShadowUserContent,
    cleanPushReply,
    decideShadowPush,
    getZonedClock,
    randomCooldownMinutes,
    resolveTimezone
} = require("./services/shadow-push");
const {
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    createHervoiceWarmup,
    createVoiceRateLimitState,
    canResumeVoiceOrphan,
    applyVoiceTurnInProgressResponse,
    claimVoiceGenerationLease,
    claimVoiceTurnOrRespond,
    createVoiceTurnGuard,
    setRetryAfterHeader,
    voiceOrphanRemainingMs,
    voiceOrphanResumeWindowMs,
    voiceTurnRecoveryResponse,
    voiceTurnInProgressResponse,
    parseVoiceTurnFields,
    publicVoiceAnalysis,
    raceWithAbort
} = require("./services/voice-turn");
const {
    getExpressiveSpeechCapabilities,
    isSafeSpeechMessageId,
    synthesizeExpressiveSpeech
} = require("./services/expressive-speech");
const {
    createExpressiveSpeechCache,
    isSafeConversationId,
    publicAssistantMessageWithSpeechAccess,
    speechCacheOptions,
    verifySpeechAccessToken
} = require("./services/expressive-speech-access");
const {
    listModels,
    resolveConversationModel,
    resolveTurnModel
} = require("./services/model-catalog");
const { normalizeChatBody } = require("./services/chat-request");
const {
    messageReferenceRuntimeContext,
    normalizeMessageReferenceSnapshot,
    resolveMessageReference
} = require("./services/message-reference");
const {
    buildEnvironmentRuntimeContext
} = require("./services/environment-context");
const {
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerTool,
    createCompanionStickerSelector
} = require("./services/companion-stickers");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    createReplySuggestionSelector,
    finalizeReplySuggestions,
    replySuggestionToolCalls
} = require("./services/reply-suggestions");
const {
    stripVisibleToolMarkup
} = require("./services/legacy-tool-markup");
const { COMPANION_ACTIVITY_TOOL, createCompanionActivities } = require("./services/companion-activities");
const {
    assertClientMessageConversation,
    chatGenerationInProgressError,
    createChatGenerationLeaseHeartbeat,
    createChatGenerationLeaseStore,
    createClientMessageQueue,
    generationLeaseFields,
    isClientMessageUniqueConflict,
    normalizeClientMessageId
} = require("./services/chat-idempotency");
const {
    publicChatErrorCode,
    publicChatErrorMetadata,
    publicChatErrorMessage,
    streamErrorEvents,
    streamFailure,
    streamSuccess
} = require("./services/chat-stream-contract");
const {
    assertProviderOutputSafe
} = require("./services/provider-output-guard");
const {
    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue
} = require("./services/persistent-memory-filter");
const {
    appendPublicProcessingStage
} = require("./services/public-processing-stages");
const {
    startModelWaitProgress
} = require("./services/model-wait-progress");
const {
    MAX_ATTACHMENT_FILE_BYTES,
    MAX_ATTACHMENT_FILES,
    attachmentRuntimeContext,
    attachmentSystemInstruction,
    attachmentToolCalls,
    findStoredAttachment,
    isSafeMessageId,
    modelImageAttachments,
    prepareAttachments,
    publicMessage,
    removeStoredAttachments,
    scrubAttachmentBuffers,
    shouldPersistAttachments,
    storeAttachments,
    storedAttachmentPathsForConversation,
    visibleMessageText,
    validateEphemeralAttachments,
    withAttachmentUserContext
} = require("./services/chat-attachments");
const ombreDashboardRouter = require("./routes/ombre-dashboard");
const { publicMcpConfig } = require("./services/ombre-mcp");
const { createMcpConnectionsRouter } = require("./routes/mcp-connections");
const { createExternalMemoryRouter } = require("./routes/external-memory");
const {
    createMcpDeviceCenter,
    hasCredentialEncryption
} = require("./services/mcp-device-center");
const {
    createExternalMemoryCenter
} = require("./services/external-memory");
const {
    createAiProviderCenter,
    publicRuntimeSettings
} = require("./services/ai-provider-center");
const { createAiProvidersRouter } = require("./routes/ai-providers");
const {
    createCompanionCreativeCenter
} = require("./services/companion-creative");
const {
    createCompanionCreativeRouter
} = require("./routes/companion-creative");
const {
    handleTenantCreativeCheck,
    handleTenantSurpriseReveal
} = require("./services/tenant-companion-creative");
const { createWeatherRouter } = require("./routes/weather");
const { createAccountRouter } = require("./routes/account");
const { createAccountExportService } = require("./services/account-export");
const { createV2CoreRouter } = require("./routes/v2/core");
const { createV2ContentRouter } = require("./routes/v2/content");
const { createContentImportsRouter } = require("./routes/v2/imports");
const { createWorldBookRouter } = require("./routes/v2/world-book");
const { resolveWorldBookContext } = require("./services/world-book-runtime");
const { createEcosystemRouter } = require("./routes/v2/ecosystem");
const { createMusicRouter } = require("./routes/v2/music");
const { createNeteaseQrLoginService } = require("./services/netease-qr-login");
const { createNeteaseCookieSessionService } = require("./services/netease-cookie-session");
const { createMusicCookieRouter } = require("./routes/v2/music-cookie");
const { createMusicUnderstandingService } = require("./services/music-understanding");
const { loadListeningItem } = require("./services/listening-runtime-context");
const { createBilibiliQrLoginService } = require("./services/bilibili-qr-login");
const { createDeviceSignalsRouter } = require("./routes/device-signals");
const { createTakeoutRouter } = require("./routes/takeout");
const { createTakeoutChannel } = require("./services/takeout-channel");
const { TAKEOUT_TOOL, createTakeoutToolExecutor } = require("./services/takeout-tool");
const { CREATIVE_ARTWORK_TOOL, createCompanionCreativeToolExecutor } = require("./services/companion-creative-tool");
const { createSpecialDatesService } = require("./services/special-dates");
const { createSpecialDatesRouter } = require("./routes/v2/special-dates");
const { createDailyShotsService } = require("./services/daily-shots");
const { createAchievementsService } = require("./services/achievements");
const { createFunLabsService } = require("./services/fun-labs");
const { createFunLabsRouter } = require("./routes/v2/fun-labs");
const { createXhsClient, extractXhsId } = require("./services/xhs-client");
const { createXhsMcpClient } = require("./services/xhs-mcp-client");
const { createQQBridgeRouter } = require("./routes/v2/qq-bridge");
const { createMcpCatalogRouter } = require("./routes/v2/mcp-catalog");
const { createChannelSyncRouter } = require("./routes/v2/channel-sync");
const { createWebExplorer } = require("./services/web-explorer");
const { createStyleDistillService } = require("./services/style-distill");
const { createInterestEngine } = require("./services/interest-engine");
const { createStyleDistillRouter } = require("./routes/v2/style-distill");
const { createXhsRouter } = require("./routes/v2/xhs");
const { visionConfig, visionConfigured } = require("./services/vision-describe");
const { createPrivateMediaRouter } = require("./routes/v2/private-media");
const { knowledgeFileTexts, listActiveCustomStickers } = require("./services/private-media");
const { createBilibiliStickerImportService } = require("./services/bilibili-sticker-import");
const { createBilibiliStickerChatRuntime } = require("./services/bilibili-sticker-chat");
const { createXhsStickerImportService } = require("./services/xhs-sticker-import");
const { createXhsStickerChatRuntime } = require("./services/xhs-sticker-chat");
const { createWorkspaceRouter } = require("./routes/v2/workspace");
const { createNurseryRouter } = require("./routes/nursery");
const { createIntimateDuelRouter } = require("./routes/intimate-duel");
const { handleNurseryEvent } = require("./services/nursery-events");
const { createChatSkinRouter } = require("./routes/chat-skin");
const { createVisionProviderRouter } = require("./routes/vision-provider");
const { resolveVisionConfig } = require("./services/vision-provider-center");
const { createCoWatchRouter } = require("./routes/co-watch");
const { createCoWatchRoomRouter, createJoinInfoHandler } = require("./routes/co-watch-rooms");
const { createCastReceiverRouter } = require("./routes/cast-receiver");
const { createReceiverService } = require("./services/cast-receiver");
const {
    safeLoadListeningRuntimeContext
} = require("./services/listening-runtime-context");
const { createVoiceOutputRouter } = require("./routes/voice-output");
const {
    createWebMirrorAssetRouter,
    createWebMirrorFontRouter,
    createWebMirrorRouter
} = require("./routes/web-mirror");
const {
    createVoiceProviderCenter
} = require("./services/voice-provider-center");
const {
    booleanEnv,
    createAuthContextMiddleware
} = require("./services/auth-context");
const {
    DEFAULT_SETTINGS,
    providerCenterBaseSettings,
    stripLegacyProviderFields,
    updateStoredSettings
} = require("./services/settings-store");
const {
    createTenantDatabase,
    requireRequestScope
} = require("./services/request-scope");
const {
    buildReplyRhythmContext
} = require("./services/reply-rhythm");
const {
    withClampedOutputTokens
} = require("./services/output-token-limit");
const {
    importMemories,
    importMemoryFile,
    reportChatTurn,
    checkKiwiMemoryHealth,
    listMemories: listKiwiMemories,
    setMemoryPermanent: setKiwiMemoryPermanent,
    deleteMemory: deleteKiwiMemory,
    replaceMemory: replaceKiwiMemory
} = require("./services/kiwi-memory-client");
const {
    createBackgroundJobWorker
} = require("./services/background-job-worker");
const {
    createBackgroundJobTrigger
} = require("./services/background-job-trigger");
const {
    startBackgroundJobLoop
} = require("./services/background-job-loop");
const {
    reconcileTenantRecurringJobs
} = require("./services/background-job-reconciliation");
const {
    createTenantMomentInteractionHandler
} = require("./services/tenant-moment-runtime");
const {
    handleTenantProactiveMessage,
    scheduleProactiveMessageEvaluation
} = require("./services/tenant-proactive-message");
const {
    createDatabaseHealthCheck,
    publicDatabaseHealth
} = require("./services/database-health");
const {
    SentenceBubbleBuffer
} = require("./services/sentence-bubble-buffer");
const {
    createImageDescriptionStore
} = require("./services/image-descriptions");
const {
    handleTenantMomentPost,
    scheduleMomentPostEvaluation
} = require("./services/tenant-moment-post");
const {
    handleTenantDiaryUpdate,
    scheduleDiaryUpdate
} = require("./services/tenant-diary-update");
const {
    handleTenantProfileRefresh,
    scheduleProfileRefresh
} = require("./services/tenant-profile-refresh");
const {
    isContextTimestampCurrent,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows
} = require("./services/context-reset");
const {
    DEFAULT_MEMORY_CHAR_BUDGET,
    memoryBudgetEnabled
} = require("./services/memory-budget");
const { buildNurseryRuntimeContext } = require("./services/nursery-engine");
const { createXinchaoClient } = require("./services/xinchao-client");

require("dotenv").config({
    path: path.join(__dirname, ".env"),
    quiet: true
});

const xinchaoClient = createXinchaoClient({ env: process.env });

const app = express();
const port = Number(process.env.PORT) || 3000;
const companionInteractionGuard = createCompanionInteractionGuard();
const runClientMessageTask = createClientMessageQueue();
const voiceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        // 语音表单已含 client_message_id/client_time/turn_context 等 10 个字段。
        fields: 20,
        parts: 21,
        fieldSize: 128 * 1024,
        fileSize: 12 * 1024 * 1024
    }
});
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: MAX_ATTACHMENT_FILES,
        // 当前聊天表单会发送 14 个文本字段（含 client_time/turn_context/model 等）；
        // 预留可选字段，避免新增一个字段就触发 LIMIT_FIELD_COUNT 并被误报为附件格式错误。
        fields: 20,
        parts: MAX_ATTACHMENT_FILES + 20,
        fileSize: MAX_ATTACHMENT_FILE_BYTES,
        fieldSize: 128 * 1024
    }
});
const voiceRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.VOICE_RATE_LIMIT_WINDOW_MS,
    maxRequests: process.env.VOICE_RATE_LIMIT_MAX
});
const hervoiceWarmup = createHervoiceWarmup();
const expressiveSpeechRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.EXPRESSIVE_TTS_RATE_LIMIT_WINDOW_MS || 60_000,
    maxRequests: process.env.EXPRESSIVE_TTS_RATE_LIMIT_MAX || 12
});
const expressiveSpeechCache = createExpressiveSpeechCache(
    speechCacheOptions(process.env)
);
const castReceiver = createReceiverService();

app.set("trust proxy", 1);

// Baseline response hardening for API responses. This does not replace CORS
// or auth middleware; it only prevents MIME sniffing/ambient credential leaks.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Strict-Transport-Security", "max-age=63072000");
    next();
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const authRequired = booleanEnv(
    process.env.AUTH_REQUIRED,
    process.env.NODE_ENV === "production"
);

// Production must never silently fall back to the service-role database for
// unauthenticated requests. Legacy handlers still contain optional scope
// fallbacks; this fail-closed guard prevents an environment typo from turning
// them into cross-tenant admin access.
if (process.env.NODE_ENV === "production" && authRequired !== true) {
    console.error("启动失败：production 环境必须设置 AUTH_REQUIRED=true。");
    process.exit(1);
}

if (!supabaseUrl || !supabaseSecretKey) {
    console.error("启动失败：.env 中缺少 Supabase 配置。");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

function requestDatabase(req) {
    const database = req?.scope?.db;
    if (!database) {
        const error = new Error("request_scope_required");
        error.status = 401;
        error.code = "auth_required";
        throw error;
    }
    return database;
}
const databaseHealth = createDatabaseHealthCheck({
    readOnce: async (signal) => {
        // 只读取一行 id，不碰租户内容；用于外部监控判断依赖是否可读。
        let query = supabase
            .from("settings")
            .select("id")
            .limit(1);
        if (signal && typeof query.abortSignal === "function") {
            query = query.abortSignal(signal);
        }
        const { error } = await query;
        if (error) throw error;
    },
    timeoutMs: process.env.DATABASE_HEALTH_TIMEOUT_MS,
    cacheMs: process.env.DATABASE_HEALTH_CACHE_MS
});
const chatGenerationLeaseStore = createChatGenerationLeaseStore(supabase);
const VOICE_GENERATION_LEASE_SECONDS = 175;
const voiceGenerationLeaseStore = createChatGenerationLeaseStore(supabase, {
    leaseSeconds: VOICE_GENERATION_LEASE_SECONDS
});
const voiceTurnGuard = createVoiceTurnGuard();
let voiceLeaseDegradedCount = 0;
function markVoiceLeaseDegraded() {
    voiceLeaseDegradedCount += 1;
    if (voiceLeaseDegradedCount === 5 || voiceLeaseDegradedCount % 10 === 0) {
        console.warn("voice_lease_degraded", {
            count: voiceLeaseDegradedCount
        });
    }
}
const mcpDeviceCenter = createMcpDeviceCenter({ supabase });
const aiProviderCenter = createAiProviderCenter({ supabase });
const backgroundJobsEnabled = booleanEnv(
    process.env.BACKGROUND_JOBS_ENABLED,
    false
);
// The owner explicitly wants raw model output, without server-side sentence
// buffering or bubble grouping. Keep the parser code available for tests and
// future opt-in work, but do not let Render env re-enable it.
const sentenceBubblesEnabled = false;
const backgroundJobWorker = createBackgroundJobWorker({
    adminSupabase: supabase,
    createTenantDatabase,
    reconcileTenant: ({ database }) =>
        reconcileTenantRecurringJobs({
            database,
            getSettings: (scopedDatabase) => getSettings(scopedDatabase)
        }),
    handlers: {
        moment_interaction: createTenantMomentInteractionHandler({
            storage: supabase.storage,
            generateReply,
            getSettings: (database) => getSettings(database),
            loadChatContext: (
                conversationId,
                settings,
                database
            ) =>
                loadChatContext(
                    conversationId,
                    settings,
                    database
                ),
            loadCompanionInteractionContext: (
                conversationId,
                settings,
                database
            ) =>
                loadCompanionInteractionContext(
                    conversationId,
                    settings,
                    database
                ),
            vision: visionConfigured(process.env)
                ? visionConfig(process.env)
                : null
        }),
        proactive_message: ({ job, database, lease }) =>
            handleTenantProactiveMessage({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                loadXinchaoNow: ({ job }) =>
                    xinchaoClient.loadNow({
                        userId: job?.user_id,
                        companionId: job?.companion_id
                    }),
                generateReply: (input) =>
                    generateReplyWithProviderFallback({
                        ...input,
                        database
                    }),
                resolveConversationTurnModel: (
                    settings,
                    conversation,
                    scopedDatabase
                ) =>
                    resolveConversationTurnModel(
                        settings,
                        conversation,
                        "",
                        scopedDatabase
                    ),
                saveMessage,
                touchConversation
            }),
        moment_post: ({ job, database, lease }) =>
            handleTenantMomentPost({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                generateReply
            }),
        diary_update: ({ job, database, lease }) =>
            handleTenantDiaryUpdate({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        profile_refresh: ({ job, database, lease }) =>
            handleTenantProfileRefresh({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        creative_check: ({ job, tenant, database, lease }) =>
            handleTenantCreativeCheck({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        surprise_reveal: ({ job, tenant, database, lease }) =>
            handleTenantSurpriseReveal({
                job,
                database,
                lease,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        nursery_event: ({ job, database, lease }) =>
            handleNurseryEvent({
                job,
                database,
                lease,
                saveMessage,
                touchConversation
            })
    },
    workerId: process.env.BACKGROUND_WORKER_ID || undefined,
    concurrency: process.env.BACKGROUND_JOB_CONCURRENCY || undefined,
    claimLimit: process.env.BACKGROUND_JOB_BATCH_SIZE || undefined,
    leaseSeconds: process.env.BACKGROUND_JOB_LEASE_SECONDS || undefined,
    maxAttempts: process.env.BACKGROUND_JOB_MAX_ATTEMPTS || undefined,
    baseRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_BASE_SECONDS || undefined,
    maxRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_MAX_SECONDS || undefined
});
const backgroundJobTrigger = createBackgroundJobTrigger({
    worker: backgroundJobWorker,
    secret: process.env.BACKGROUND_JOB_TRIGGER_SECRET,
    enabled: backgroundJobsEnabled,
    budgetMs: Number(
        process.env.BACKGROUND_JOB_TICK_BUDGET_MS || 45_000
    )
});
const backgroundJobLoop = startBackgroundJobLoop({
    worker: backgroundJobWorker,
    enabled: backgroundJobsEnabled,
    intervalMs: process.env.BACKGROUND_JOB_LOCAL_INTERVAL_MS
});

const allowedOrigins = new Set(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:4174",
        "http://127.0.0.1:4174",
        "https://localhost",
        "capacitor://localhost",
        ...(process.env.FRONTEND_URL || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ]
);

app.use("/web", createWebMirrorRouter());
app.use("/assets", createWebMirrorAssetRouter());
app.use("/fonts", createWebMirrorFontRouter());
app.use(
    cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true);
                return;
            }

            const error = new Error("该网页地址没有权限访问后端。");
            error.status = 403;
            callback(error);
        },
        exposedHeaders: [
            "X-DengTa-Voice-Provider",
            "X-DengTa-Voice-Model",
            "X-DengTa-Voice-Emotion",
            "X-DengTa-Voice-Cache",
            "X-DengTa-Companion-Id",
            "Retry-After"
        ]
    })
);
app.use("/api/weather", createWeatherRouter());
app.post("/internal/background-jobs/tick", backgroundJobTrigger);
app.post(
    "/internal/release-apk",
    express.raw({ type: "*/*", limit: "80mb" }),
    async (req, res) => {
        const crypto = require("node:crypto");
        const expected = String(process.env.UPDATE_ADMIN_SECRET || "");
        const provided = String(req.headers["x-update-admin"] || "");
        const valid = expected.length > 0 && provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
        if (!valid) return res.status(403).json({ code: "release_upload_forbidden" });
        const fileName = String(req.query.name || "").trim();
        if (!/^DengTa-[A-Za-z0-9._-]+\.apk$/.test(fileName)) return res.status(400).json({ code: "release_upload_name_invalid" });
        if (!Buffer.isBuffer(req.body) || req.body.length < 1024) return res.status(400).json({ code: "release_upload_body_invalid" });
        try {
            const objectPath = `apk/${fileName}`;
            const upload = await supabase.storage.from("dengta-updates").upload(objectPath, req.body, { contentType: "application/vnd.android.package-archive", upsert: true, cacheControl: "31536000" });
            if (upload.error) throw upload.error;
            const publicUrl = supabase.storage.from("dengta-updates").getPublicUrl(objectPath).data.publicUrl;
            res.json({ ok: true, path: objectPath, sha256: crypto.createHash("sha256").update(req.body).digest("hex"), size: req.body.length, url: publicUrl });
        } catch (error) {
            res.status(502).json({ code: "release_upload_failed", message: String(error?.message || error).slice(0, 240) });
        }
    }
);
// Reject oversized JSON before parsing; keeps anonymous 30MB bodies from
// pinning the Render instance. Authenticated JSON endpoints stay well below 4MB.
app.use((req, res, next) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > 4 * 1024 * 1024) {
        return res.status(413).json({ code: "request_body_too_large", message: "请求体过大。" });
    }
    next();
});
app.use(express.json({ limit: "4mb" }));
app.use(
    "/api/v2/qq-bridge",
    createQQBridgeRouter({
        database: supabase,
        executeChatTurn,
        configPath: process.env.QQ_BRIDGE_CONFIG || require("node:path").join(__dirname, "qq-bridge.local.json")
    })
);
app.use(
    "/api/v2/cast",
    createCastReceiverRouter({
        receiver: castReceiver,
        validateMediaUrl: require("./services/direct-media-url").validateDirectMediaUrl,
        encryptMediaUrl: castReceiver.encryptMediaUrl,
        database: supabase,
        includeControl: false
    })
);
// 公开的 B 站解析/流代理：必须挂在认证中间件之前，<video> 等无法携带 Bearer 头的请求才能取流。
app.use(
    "/api/v2/co-watch",
    require("./routes/public-bilibili").createPublicBilibiliRouter()
);
// 邀请预览只返回摘要，必须在全局登录校验前注册。
app.get("/api/v2/co-watch/rooms/join-info", createJoinInfoHandler(supabase));
// MCP 使用自己的 dengta_map_ Bearer 令牌，不依赖浏览器 Supabase JWT；
// 必须在全局登录中间件之前挂载，否则令牌会先被 JWT 校验拒绝。
app.use("/api/v2/surprise-map/mcp", createSurpriseMapMcpRouter({ database: supabase }));
app.use(
    createAuthContextMiddleware({
        adminSupabase: supabase,
        authRequired,
        initialOwnerEmail: process.env.INITIAL_OWNER_EMAIL || ""
    })
);
app.use("/api/account", createAccountRouter({
    exportService: createAccountExportService({ database: supabase, supabaseUrl, supabaseKey: supabaseSecretKey })
}));
app.post("/internal/memory/compress", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const conversationId = cleanText(req.body?.conversation_id, 80);
        if (!isUuid(conversationId)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }
        const settings = await getSettings(scope.db);
        const result = await compressMemoryIfNeeded(
            conversationId,
            settings,
            scope.db
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
});
app.get("/api/errors", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const { data, error } = await scope.db
            .from("chat_error_logs")
            .select(
                "id, created_at, path, method, error_code, message, error_source, provider_phase, provider_code, upstream_status, stack_trace, conversation_id, request_summary"
            )
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ logs: (data || []).map(publicDiagnosticLog) });
    } catch (error) {
        next(error);
    }
});
app.get("/api/errors/:logId", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        res.json({ log: await readDiagnosticLog(scope.db, req.params.logId) });
    } catch (error) {
        next(error);
    }
});
const memoryImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 20 * 1024 * 1024 }
});
app.post("/api/v2/memory/import", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const tenant = { userId: scope.userId, companionId: scope.companionId };
        const result = await importMemories({
            memories: Array.isArray(req.body?.memories) ? req.body.memories : [],
            tenant
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), { status: feedback.status, code: feedback.body.code, errorSource: feedback.body.error_source, upstreamStatus: feedback.body.upstream_status });
        res.json(feedback.body);
    } catch (error) {
        next(error);
    }
});
app.post("/api/v2/memory/import-history", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const database = scope.db;
        const MAX_MESSAGES = 5000;
        // 读取该账号全部历史对话（旧版记忆系统上线前的聊天内容）
        const { data: history, error } = await database
            .from("messages")
            .select("role, content, conversation_id, created_at")
            .in("role", ["user", "assistant"])
            .order("created_at", { ascending: true })
            .limit(MAX_MESSAGES);
        if (error) throw error;
        if (!Array.isArray(history) || history.length === 0) {
            return res.json({ ok: true, imported: 0, skipped: 0, total: 0, mode: "empty", file: "history.txt", text_len: 0, message_count: 0 });
        }
        // 按会话分组组装文本
        const byConversation = {};
        for (const m of history) {
            const key = String(m.conversation_id || "general");
            (byConversation[key] = byConversation[key] || []).push(m);
        }
        const parts = [];
        for (const [convId, msgs] of Object.entries(byConversation)) {
            const convLines = ["【对话 " + String(convId).slice(0, 8) + "】"];
            for (const m of msgs) {
                const speaker = m.role === "user" ? "你" : "伴侣";
                convLines.push(speaker + "：" + String(m.content || "").replace(/[\r\n]+/g, " ").slice(0, 800));
            }
            parts.push(convLines.join("\n"));
        }
        const text = parts.join("\n\n").slice(0, 300000);
        const result = await importMemoryFile({
            filename: "history.txt",
            fileBuffer: Buffer.from(text, "utf8"),
            fileType: "text/plain",
            tenant: { userId: scope.userId, companionId: scope.companionId }
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), {status:feedback.status, code:feedback.body.code, errorSource:feedback.body.error_source, upstreamStatus:feedback.body.upstream_status});
        res.json({
            ...feedback.body,
            message_count: history.length
        });
    } catch (error) {
        next(error);
    }
});
app.post("/api/v2/memory/import-file", (req, res, next) => {
    memoryImportUpload.single("file")(req,res,error=>{
        if (error) {error.status=error.code==="LIMIT_FILE_SIZE"?413:400;error.code=error.status===413?"memory_import_file_too_large":"memory_import_file_invalid";}
        next(error);
    });
}, async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
            return res.status(400).json({ message: "请选择要导入的文件。" });
        }
        const result = await importMemoryFile({
            filename: req.file.originalname || "import.txt",
            fileBuffer: req.file.buffer,
            fileType: req.file.mimetype || "application/octet-stream",
            tenant: { userId: scope.userId, companionId: scope.companionId }
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), {status:feedback.status, code:feedback.body.code, errorSource:feedback.body.error_source, upstreamStatus:feedback.body.upstream_status});
        res.status(feedback.status).json(feedback.body);
    } catch (error) {
        next(error);
    }
});
app.use("/api/v2/imports", createContentImportsRouter());
app.use("/api/v2/channel-sync", createChannelSyncRouter());
const { createQQCloudRouter } = require("./routes/v2/qq-cloud");
const { buildQQCloudSystemInstructions, createQQCloudService } = require("./services/qq-cloud");
const qqCloud = createQQCloudService({ database: supabase, executeChatTurn });
app.use("/api/v2/qq-cloud", createQQCloudRouter(qqCloud));
app.use("/api/v2/mcp/catalog", createMcpCatalogRouter());
app.use("/api/v2/world-book", createWorldBookRouter());
app.use("/api/v2/ecosystem", createEcosystemRouter());
const neteaseCookieSession = createNeteaseCookieSessionService({ database: supabase });
const neteaseQrLogin = createNeteaseQrLoginService({ database: supabase, cookieSession: neteaseCookieSession });
const interestEngine = createInterestEngine({
    database: supabase,
    explorer: createWebExplorer()
});
const musicUnderstanding = createMusicUnderstandingService({
    database: supabase,
    getSettings,
    qrLoginService: neteaseQrLogin
});
app.use("/api/v2/music", createMusicCookieRouter({ neteaseCookie: neteaseCookieSession, storage: supabase.storage }));
app.use("/api/v2/music", createMusicRouter({ mcpDeviceCenter, neteaseQr: neteaseQrLogin, musicUnderstanding, storage: supabase.storage, neteaseCookie: neteaseCookieSession }));
app.post("/api/v2/music/chat-card", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const message = String(req.body?.message || req.body?.query || "").slice(0, 1000);
        const keyword = extractSongRequest(message);
        const randomRequest = !keyword && isRandomMusicRequest(message);
        if (!keyword && !randomRequest) {
            return res.status(400).json({ ok: false, code: "music_keyword_required", message: "请告诉我要放哪首歌。" });
        }
        const card = randomRequest
            ? await buildDailyMusicCard({ scope, neteaseTools: neteaseQrLogin, neteaseCookieSession })
            : await buildLegacyMusicCard({
                  keyword,
                  scope,
                  neteaseTools: neteaseQrLogin,
                  neteaseCookieSession
              });
        if (!card) {
            return res.status(404).json({ ok: false, code: "music_card_not_found", message: "没有找到可用的歌曲信息。" });
        }
        res.json({ ok: true, music: card });
    } catch (error) {
        next(error);
    }
});
app.get("/api/v2/music/chat-track-url", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const trackId = String(req.query.track_id || "").trim();
        if (!/^\d{1,20}$/.test(trackId)) {
            return res.status(400).json({ ok: false, code: "music_track_required", message: "缺少歌曲 ID。" });
        }
        const receipt = await neteaseQrLogin.songUrl(scope, trackId);
        const url = String(receipt?.url || "").replace(/^http:/i, "https:");
        if (!/^https:\/\//i.test(url)) {
            return res.status(404).json({ ok: false, code: "music_audio_unavailable", message: "这首歌暂时没有可内播的音频。" });
        }
        res.json({ ok: true, track_id: trackId, url });
    } catch (error) {
        next(error);
    }
});
app.get("/api/v2/music/chat-lyric", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const trackId = String(req.query.track_id || "").trim();
        if (!/^\d{1,20}$/.test(trackId)) {
            return res.status(400).json({ ok: false, code: "music_track_required", message: "缺少歌曲 ID。" });
        }
        const result = await neteaseQrLogin.lyric(scope, trackId);
        const lyric = String(result?.lyric || "").slice(0, 40_000);
        if (!lyric.trim()) {
            return res.status(404).json({ ok: false, code: "music_lyric_not_found", message: "这首歌暂时没有歌词。" });
        }
        res.json({ ok: true, track_id: trackId, lyric, translated_lyric: String(result?.translated_lyric || "").slice(0, 40_000) });
    } catch (error) {
        next(error);
    }
});
app.use("/api/v2/device", createDeviceSignalsRouter({ getSettings: (database) => getSettings(database) }));
app.use("/api/v2/takeout", createTakeoutRouter({ channel: createTakeoutChannel({ database: supabase }) }));
app.use("/api/v2/special-dates", createSpecialDatesRouter({ dates: createSpecialDatesService({ database: supabase }) }));
app.use(
    "/api/v2/fun-labs",
    createFunLabsRouter({
        dailies: createDailyShotsService({ database: supabase }),
        achievements: createAchievementsService({ database: supabase }),
        funLabs: createFunLabsService({ database: supabase }),
        interestEngine
    })
);


function createConfiguredXhsClient() {
    return String(process.env.XHS_PROVIDER || "").trim().toLowerCase() === "mcp"
        ? createXhsMcpClient()
        : createXhsClient();
}

app.use(
    "/api/v2/xhs",
    createXhsRouter({
        client: createConfiguredXhsClient(),
        database: supabase,
        writeConfirmationSecret:
            process.env.XHS_WRITE_CONFIRMATION_SECRET ||
            process.env.XHS_MCP_TOKEN ||
            process.env.XHS_SERVICE_TOKEN ||
            "",
        requireWriteConfirmation: process.env.XHS_REQUIRE_WRITE_CONFIRMATION !== "false"
    })
);
app.use(
    "/api/v2/style-distill",
    createStyleDistillRouter({
        service: createStyleDistillService({
            generateReplyImpl: generateReply,
            getSettingsImpl: (database) => getSettings(database)
        })
    })
);
const stickerImports = createBilibiliStickerImportService({ storage: supabase.storage,
    getCookie: scope => bilibiliQrLogin.cookieText(scope) });
const xhsStickerClient = createConfiguredXhsClient();
const xhsStickerImports = createXhsStickerImportService({ storage: supabase.storage, xhsClient: xhsStickerClient });
app.use("/api/v2/private-media", createPrivateMediaRouter({ storage: supabase.storage, stickerImports, xhsStickerImports, xhsClient: xhsStickerClient }));
app.use("/api/v2/surprise-map", createSurpriseMapRouter({
    publicationDatabase: supabase,
    draftLetter: (scope, options) => generateSurpriseMapDraft(scope, options, { getSettings, generateReply }),
    publicDraftLetter: (scope, options) => generateSurpriseMapPublicDraft(scope, options, { getSettings, generateReply })
}));
app.use(
    "/api/v2/workspace",
    createWorkspaceRouter({
        storage: supabase.storage,
        getSettings: (database) => getSettings(database)
    })
);
app.use(
    "/api/v2",
    createV2CoreRouter({
        storage: supabase.storage,
        getSettings: (database) => getSettings(database),
        resolveTurnModel
    })
);
app.use("/api/v2/nursery", createNurseryRouter());
app.use("/api/v2/voice-output", createVoiceOutputRouter());
app.use("/api/v2/intimate-duel", (req, res) => {
    res.status(410).json({
        ok: false,
        code: "feature_unavailable",
        message: "该功能暂时不可用。"
    });
});
app.use(
    "/api/v2/creative",
    createCompanionCreativeRouter({
        createCenter: (scope) =>
            createCompanionCreativeCenter({
                database: scope.db,
                storage: supabase.storage,
                identity: {
                    userId: scope.userId,
                    companionId: scope.companionId
                }
            }),
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/chat-skin",
    createChatSkinRouter({
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/vision-provider",
    createVisionProviderRouter()
);
const bilibiliQrLogin = createBilibiliQrLoginService({ database: supabase });
app.use(
    "/api/v2/co-watch",
    createCoWatchRouter({
        receiver: castReceiver,
        bilibiliQr: bilibiliQrLogin,
        interestEngine,
        validateMediaUrl: require("./services/direct-media-url").validateDirectMediaUrl,
        validatePageUrl: require("./services/page-embed").validateCoWatchPageUrl,
        encryptMediaUrl: castReceiver.encryptMediaUrl,
        getSettings: (database) => getSettings(database),
        loadChatContext: (conversationId, settings, database) =>
            loadChatContext(conversationId, settings, database),
        generateReply,
        resolveWorldBookContext,
        saveMessage,
        touchConversation
    })
);
app.use(
    "/api/v2/co-watch",
    createCoWatchRoomRouter({ database: supabase })
);
app.use(
    "/api/v2",
    createV2ContentRouter({
        storage: supabase.storage,
        // Provider profiles are the only chat-provider source. The settings
        // row stores companion preferences, not an alternate provider route.
        readSettings: async (scope) =>
            publicRuntimeSettings(await getSettings(scope.db)),
        saveSettings: async (scope, body) => {
            await updateStoredSettings(
                scope.db,
                stripLegacyProviderFields(body)
            );
            return publicRuntimeSettings(await getSettings(scope.db));
        }
    })
);
app.use(
    "/api/ombre",
    (req, res, next) => {
        // The dashboard is backed by a single global Ombre account, not a
        // per-tenant memory store. It must never be readable by ordinary
        // members; owner-only access prevents cross-tenant memory exposure.
        if (!req.scope?.isOwner) {
            return res.status(403).json({
                ok: false,
                code: "owner_required",
                message: "Ombre 全局记忆库仅限管理员查看。"
            });
        }
        next();
    },
    ombreDashboardRouter
);
app.use(
    "/api/mcp/connections",
    createMcpConnectionsRouter({ center: mcpDeviceCenter })
);
app.use(
    "/api/external-memory",
    createExternalMemoryRouter({
        createCenter: (scope) =>
            createExternalMemoryCenter({ database: scope.db })
    })
);
app.use(
    "/api/ai-providers",
    createAiProvidersRouter({ center: aiProviderCenter })
);

const defaultSettings = {
    ai_name: "伴侣",
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    intimate_expression_enabled: false,
    provider: "custom",
    api_url: "",
    model: "",
    reasoning_effort: "",
    temperature: 0.7,
    // 新建账号第一次读取设置时会用这里的值插入 settings 行。数据库对
    // context_turns / max_tokens 有 CHECK 约束，0 会触发 23514，导致
    // /api/v2/bootstrap 与 /api/v2/settings 500，App 显示“无法启动后端”。
    // 这里必须与 services/settings-store.js 的 DEFAULT_SETTINGS 保持一致。
    context_turns: 20,
    max_tokens: 65536,
    compression_threshold: 8000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
};

const WHEREABOUTS_SNAPSHOT_TOOL = Object.freeze({
    name: "whereabouts_snapshot",
    description: [
        "获取当前行踪完整快照：现在在哪里、停留了多久、电量能撑多久（当前停留、最近停留、最近移动、电量趋势）。",
        "可选参数：stayLimit（默认5）、moveLimit（默认5）、batteryBucketMinutes（默认5）。",
        "用户上报过位置后才会有数据；没有数据时如实说明。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "stayLimit": {
                "type": "number",
                "description": "停留条数，默认5"
            },
            "moveLimit": {
                "type": "number",
                "description": "移动条数，默认5"
            },
            "batteryBucketMinutes": {
                "type": "number",
                "description": "电量分桶分钟，默认5"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_CURRENT_STAY_TOOL = Object.freeze({
    name: "whereabouts_current_stay",
    description: "获取当前停留点：位置、地点标签（home/work）、停留时长、电量。",
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_RECENT_STAYS_TOOL = Object.freeze({
    name: "whereabouts_recent_stays",
    description: "获取最近停留历史。可选参数：limit（默认20）。",
    input_schema: {
        "type": "object",
        "properties": {
            "limit": {
                "type": "number",
                "description": "条数，默认20"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_RECENT_MOVES_TOOL = Object.freeze({
    name: "whereabouts_recent_moves",
    description: "回溯最近的移动路径（明显移动事件）。可选参数：limit（默认20）。",
    input_schema: {
        "type": "object",
        "properties": {
            "limit": {
                "type": "number",
                "description": "条数，默认20"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_SUMMARY_TOOL = Object.freeze({
    name: "whereabouts_summary",
    description: "按 day/week/month 汇总行踪、电量和移动状态。可选参数：range（默认day）、batteryBucketMinutes（默认5）。",
    input_schema: {
        "type": "object",
        "properties": {
            "range": {
                "type": "string",
                "description": "day/week/month，默认day"
            },
            "batteryBucketMinutes": {
                "type": "number"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const TIMELINE_WRITE_TOOL = Object.freeze({
    name: "timeline_write",
    description: [
        "把用户当天（或某一天）的生活事件写入时间轴，形成可回顾的一天。",
        "触发时机：用户明确提到自己开始/结束某个活动（吃饭、睡觉、出门、工作、运动、看剧、就医、通勤等）或描述某段经历时，主动记录。",
        "参数：date 必填（YYYY-MM-DD，用户当地日期，跨天事件不行——睡眠跨过 00:00 必须拆成两段）；events 事件数组，每项含 startAt（必填，ISO 8601，如 2026-05-08T15:00:00+08:00）、endAt（可选，缺省按 30 分钟）、title（必填）、eventNodeId（可选，先用 timeline_categories 查）、subcategoryId（可选）、note（可选）、tags（可选）。",
        "mode：merge（默认，按事件 id 合并，当天已有事件保留）或 replace（整日覆盖）；finalize=true 标记当天为最终版；dropEventIds 可删除已有事件。",
        "不确定分类时先调用 timeline_categories；不要编造事件，只记录用户实际提到的内容。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "description": "YYYY-MM-DD（必填）"
            },
            "mode": {
                "type": "string",
                "description": "merge/replace，默认merge"
            },
            "events": {
                "type": "array",
                "description": "事件数组：{startAt,endAt,title,eventNodeId,note}"
            },
            "finalize": {
                "type": "boolean"
            },
            "dropEventIds": {
                "type": "array"
            }
        },
        "required": [
            "date"
        ],
        "additionalProperties": false
    }
});
const TIMELINE_READ_TOOL = Object.freeze({
    name: "timeline_read",
    description: "读取某一天的时间轴事件。参数：date 必填（YYYY-MM-DD）。用于回顾用户某天做了什么、或修改前先查看当天已有事件。",
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "description": "YYYY-MM-DD（必填）"
            }
        },
        "required": [
            "date"
        ],
        "additionalProperties": false
    }
});
const TIMELINE_CATEGORIES_TOOL = Object.freeze({
    name: "timeline_categories",
    description: "列出时间轴全部分类（生活/工作/学习/运动/娱乐/健康/社交/照顾/出行/休息）与常用事件节点（含别名）。写事件前不确定分类时先查这个。",
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const TIMELINE_PROPOSALS_TOOL = Object.freeze({
    name: "timeline_proposals",
    description: "查看时间轴的新事件节点提案（provisional 节点来源）。可选参数：date（YYYY-MM-DD）只查某天。",
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const AGENTS_MD_READ_TOOL = Object.freeze({
    name: "agents_md_read",
    description: [
        "读取当前用户的 agents.md 设置预览（个性化指令与近期已确认记忆；不包含本轮相关记忆检索及知识文件，不是实际生成回执）。",
        "当用户要求读取/核对 agents.md、问你是否读过 agents.md 时，调用本工具获取最新全文，再如实回答。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const WORKSPACE_LIST_TOOL = Object.freeze({
    name: "workspace_list",
    description: "列出用户工作区目录内容（文件名/类型/大小）。可选参数：path（子目录，默认根目录）。工作区是你和用户共用的文件空间。",
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "目录路径，默认根"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WORKSPACE_READ_TOOL = Object.freeze({
    name: "workspace_read",
    description: "读取用户工作区中的文件内容（文本）。参数：path 必填（如 notes.txt、projects/app.js、agents.md）。",
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            }
        },
        "required": [
            "path"
        ],
        "additionalProperties": false
    }
});
const WORKSPACE_WRITE_TOOL = Object.freeze({
    name: "workspace_write",
    description: [
        "在用户工作区中创建或覆盖文件（文本，上限 5MB）。参数：path 必填、content 必填。",
        "适合：用户要求写代码、写笔记、保存清单、修改 agents.md 等任何文件操作。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            },
            "content": {
                "type": "string",
                "description": "文件内容（必填）"
            },
            "mode": {
                "type": "string",
                "description": "overwrite（默认，覆盖写）或 append（追加到末尾，不覆盖原内容）"
            },
            "confirm": {
                "type": "boolean",
                "description": "覆盖已存在文件时必须为 true（需用户先明确同意）；新建文件可不传"
            }
        },
        "required": [
            "path",
            "content"
        ],
        "additionalProperties": false
    }
});
const WORKSPACE_DELETE_TOOL = Object.freeze({
    name: "workspace_delete",
    description: [
        "删除用户工作区中的文件。参数：path 必填。",
        "必须先征得用户明确同意，用户同意后才可把 confirm 设为 true 调用；未确认时工具会返回 confirmation_required。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            },
            "confirm": {
                "type": "boolean",
                "description": "用户已明确同意删除时传 true"
            }
        },
        "required": [
            "path"
        ],
        "additionalProperties": false
    }
});
const POST_MOMENT_TOOL = {
    name: "post_moment",
    description: [
        "在聊天过程中有感而发，发布一条 AI 自己的 Moments 动态。",
        "判断标准是此刻有没有一句想让用户之后刷到的话，不要求情绪重大或值得长期保存。",
        "想念、吃醋、占有欲、心软、被逗笑、隐约不爽、温柔吐槽、一个具体观察，",
        "或一句不适合在聊天回复里直接说完的话，都可以成为动态。",
        "不要为了使用工具而使用工具；一次聊天请求最多发布一条。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "公开显示在 Moments 里的正文。1到3句，自然、具体，像随手发出的朋友圈。"
            },
            context_note: {
                type: "string",
                description: "用户不可见的内部备注：为什么发这条、当时在聊什么、这条动态的情绪底色。"
            }
        },
        required: ["content", "context_note"],
        additionalProperties: false
    }
};

const SPECIAL_DATE_ADD_TOOL = {
    name: "special_date_add",
    description: [
        "帮用户保存一个特殊日子：纪念日（kind=anniversary，如在一起纪念日、生日，默认每年重复提醒）",
        "或追番/追剧日历（kind=show，填下一次更新的日期与集数）。保存后 AI 会在当天或临近时主动庆祝/提醒。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            kind: { type: "string", description: "anniversary=纪念日；show=追番/追剧。" },
            title: { type: "string", description: "日子名称，如“在一起纪念日”“她的生日”“鬼灭之刃”。" },
            date: { type: "string", description: "日期，格式 YYYY-MM-DD（例如 2025-12-29）。纪念日填首次发生日期，show 填下次更新日期。用户说中文日期（如2025年12月29日）时，先转成 YYYY-MM-DD 再调用。" },
            description: { type: "string", description: "可选：备注，如礼物想法、观看平台。" },
            next_episode: { type: "string", description: "show 可选：下次更新的集数，如“第8集”。" },
            reminder_days: { type: "number", description: "纪念日可选：提前几天提醒（0-30，默认当天）。" }
        },
        required: ["kind", "title", "date"],
        additionalProperties: false
    }
};

const SPECIAL_DATE_LIST_TOOL = {
    name: "special_date_list",
    description: "查看用户保存的特殊日子（纪念日与追番日历）。用户问“我有哪些纪念日/追番日历”时调用。",
    input_schema: {
        type: "object",
        properties: {
            kind: { type: "string", description: "可选：anniversary 只看纪念日；show 只看追番；不填看全部。" }
        },
        required: [],
        additionalProperties: false
    }
};

const SPECIAL_DATE_REMOVE_TOOL = {
    name: "special_date_remove",
    description: "删除一条用户保存的特殊日子。",
    input_schema: {
        type: "object",
        properties: {
            id: { type: "string", description: "要删除的特殊日子编号（从列表结果里取）。" }
        },
        required: ["id"],
        additionalProperties: false
    }
};

const DAILY_SHOT_ADD_TOOL = {
    name: "daily_shot_add",
    description: "把用户今天发的照片记入每日一拍（一天一张，带一句话备注）。用户分享今日照片并想留念时调用；同一天重复调用会覆盖备注。",
    input_schema: {
        type: "object",
        properties: {
            note: { type: "string", description: "一句备注，如照片内容或当天心情。" }
        },
        required: [],
        additionalProperties: false
    }
};

const ACHIEVEMENTS_LIST_TOOL = {
    name: "achievements_list",
    description: "查看隐藏成就清单与解锁进度。用户问“成就/解锁了什么/成就系统”时调用。",
    input_schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
    }
};

const DANMAKU_READ_TOOL = {
    name: "danmaku_read",
    description: "读取B站视频的弹幕样本，用于弹幕共读：结合视频标题像一起看弹幕的朋友一样吐槽、接梗。用户给 bvid（BV开头）或要求共读弹幕时调用。",
    input_schema: {
        type: "object",
        properties: {
            bvid: { type: "string", description: "B站视频编号（BV开头），从用户给的链接里提取。" }
        },
        required: ["bvid"],
        additionalProperties: false
    }
};

const COMPATIBILITY_RECORD_TOOL = {
    name: "compatibility_record",
    description: "存档一次默契度挑战的总分与点评，返回历史最好分与平均分。默契度挑战结束时调用。",
    input_schema: {
        type: "object",
        properties: {
            score: { type: "number", description: "总分（0-100）。" },
            comment: { type: "string", description: "一句话点评或总结。" }
        },
        required: ["score"],
        additionalProperties: false
    }
};


const ACHIEVEMENT_DEFINE_TOOL = {
    name: "achievement_define",
    description: "为用户新建一条自定义成就（用户和 AI 一起完成的目标，如“一起看 100 部电影”）。用户说“加个成就/定个小目标/新建成就”时调用。",
    input_schema: {
        type: "object",
        properties: {
            title: { type: "string", description: "成就名称，简短有趣。" },
            description: { type: "string", description: "完成条件或一句话说明。" },
            emoji: { type: "string", description: "可选：成就图标 emoji。" },
            category: { type: "string", description: "可选：分类名。" }
        },
        required: ["title"],
        additionalProperties: false
    }
};

const ACHIEVEMENT_UNLOCK_TOOL = {
    name: "achievement_unlock",
    description: "解锁一条自定义成就（当你们一起完成了目标时调用，例如“AI 画出了第一幅画”）。系统成就会自动解锁，无需调用本工具。",
    input_schema: {
        type: "object",
        properties: {
            code: { type: "string", description: "成就编号（custom: 开头，从成就列表里取）。" }
        },
        required: ["code"],
        additionalProperties: false
    }
};


const XHS_ME_TOOL = {
    name: "xhs_me",
    description: "查看用户小红书账号的登录状态。",
    input_schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
    }
};

const XHS_SEARCH_TOOL = {
    name: "xhs_search",
    description: "用用户的小红书账号搜索笔记（帮用户刷小红书、找内容）。返回笔记标题/作者/点赞数等摘要。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词或品类。" },
            page: { type: "number", description: "可选：页码，默认 1。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const XHS_LIKE_TOOL = {
    name: "xhs_like",
    description: "用用户的小红书账号给一篇笔记点赞。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            note_url: { type: "string", description: "笔记链接或笔记 id。" },
            confirmed: { type: "boolean", description: "用户已明确同意点赞时传 true。" }
        },
        required: ["note_url", "confirmed"],
        additionalProperties: false
    }
};

const XHS_COMMENT_TOOL = {
    name: "xhs_comment",
    description: "用用户的小红书账号给一篇笔记发评论。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            note_url: { type: "string", description: "笔记链接或笔记 id。" },
            content: { type: "string", description: "评论内容（友好、自然，不超过 200 字）。" },
            confirmed: { type: "boolean", description: "用户已明确同意发这条评论时传 true。" }
        },
        required: ["note_url", "content", "confirmed"],
        additionalProperties: false
    }
};

const XHS_FOLLOW_TOOL = {
    name: "xhs_follow",
    description: "用用户的小红书账号关注一个用户。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            user_url: { type: "string", description: "用户主页链接或用户 id。" },
            confirmed: { type: "boolean", description: "用户已明确同意关注时传 true。" }
        },
        required: ["user_url", "confirmed"],
        additionalProperties: false
    }
};


const CLOUD_MUSIC_SEARCH_TOOL = {
    name: "cloud_music_search",
    description: "搜索网易云音乐（歌曲/专辑/歌手/歌单）。使用用户已登录的网易云账号。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词。" },
            category: { type: "string", description: "song=歌曲（默认）album=专辑 artist=歌手 playlist=歌单。" },
            limit: { type: "number", description: "可选：返回条数，默认 10，最多 30。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_DAILY_TOOL = {
    name: "cloud_music_get_daily_recommend",
    description: "获取用户网易云账号的今日推荐歌曲（需要已登录网易云）。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL = {
    name: "cloud_music_playlist_detail",
    description: "获取网易云歌单详情及歌单内歌曲列表。",
    input_schema: {
        type: "object",
        properties: { playlist_id: { type: "string", description: "歌单编号。" } },
        required: ["playlist_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_CREATE_PLAYLIST_TOOL = {
    name: "cloud_music_create_playlist",
    description: "在用户网易云账号里创建新歌单。",
    input_schema: {
        type: "object",
        properties: {
            name: { type: "string", description: "歌单名称。" },
            privacy: { type: "boolean", description: "可选：true=设为隐私歌单。" }
        },
        required: ["name"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL = {
    name: "cloud_music_add_to_playlist",
    description: "把歌曲批量加入用户网易云歌单。",
    input_schema: {
        type: "object",
        properties: {
            playlist_id: { type: "string", description: "歌单编号。" },
            track_ids: { type: "array", items: { type: "string" }, description: "歌曲编号数组。" }
        },
        required: ["playlist_id", "track_ids"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ALBUM_INFO_TOOL = {
    name: "cloud_music_album_info",
    description: "获取网易云专辑详情与歌曲列表。",
    input_schema: {
        type: "object",
        properties: { album_id: { type: "string", description: "专辑编号。" } },
        required: ["album_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ARTIST_INFO_TOOL = {
    name: "cloud_music_artist_info",
    description: "获取网易云歌手详情与热门歌曲 Top10。",
    input_schema: {
        type: "object",
        properties: { artist_id: { type: "string", description: "歌手编号。" } },
        required: ["artist_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_SUBSCRIPTIONS_TOOL = {
    name: "cloud_music_my_subscriptions",
    description: "获取用户网易云收藏的歌手或专辑列表。",
    input_schema: {
        type: "object",
        properties: { category: { type: "string", description: "artists=歌手（默认）albums=专辑。" } },
        required: [],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_LIKE_TOOL = {
    name: "cloud_music_like_song",
    description: "给网易云歌曲点红心或取消红心。",
    input_schema: {
        type: "object",
        properties: {
            song_id: { type: "string", description: "歌曲编号。" },
            like: { type: "boolean", description: "true=点红心 false=取消红心。" }
        },
        required: ["song_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_HISTORY_TOOL = {
    name: "cloud_music_play_history",
    description: "获取用户网易云最近听歌记录。",
    input_schema: {
        type: "object",
        properties: { limit: { type: "number", description: "可选：条数，默认 20，最多 50。" } },
        required: [],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_MY_PLAYLISTS_TOOL = {
    name: "cloud_music_my_playlists",
    description: "列出用户网易云账号里的全部歌单（自建的和收藏的）。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL = {
    name: "cloud_music_remove_from_playlist",
    description: "把歌曲从用户网易云歌单里移除。",
    input_schema: {
        type: "object",
        properties: {
            playlist_id: { type: "string", description: "歌单编号。" },
            track_ids: { type: "array", items: { type: "string" }, description: "要移除的歌曲编号数组。" }
        },
        required: ["playlist_id", "track_ids"],
        additionalProperties: false
    }
};

const NETEASE_PLAY_SONG_TOOL = {
    name: "netease_play_song",
    description: "在 DengTa 聊天里播放一首网易云歌曲：搜索歌曲（优先原唱版本，不选翻唱），尽量解析可直接播放的 HTTPS 音频，并在回复里生成听歌卡片；不要在未解析到音频时打开外部网易云 App。用户说“放首歌/播放XX/唱XX”时调用。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "歌名或 歌名+歌手，如：爱人错过 告五人。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};
const WEB_READ_TOOL = {
    name: "web_read",
    description: "读取任意网页正文(通过 Jina Reader,返回干净文字)。用户发链接让你看时调用。",
    input_schema: {
        type: "object",
        properties: { url: { type: "string", description: "网页链接(http/https)。" } },
        required: ["url"],
        additionalProperties: false
    }
};

const RSS_READ_TOOL = {
    name: "rss_read",
    description: "读取 RSS/Atom 订阅源的最新条目。",
    input_schema: {
        type: "object",
        properties: {
            url: { type: "string", description: "RSS 源链接。" },
            limit: { type: "number", description: "可选:条目数,默认 10,最多 20。" }
        },
        required: ["url"],
        additionalProperties: false
    }
};

const V2EX_HOT_TOOL = {
    name: "v2ex_hot",
    description: "查看 V2EX 热门帖子。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const V2EX_TOPIC_TOOL = {
    name: "v2ex_topic",
    description: "查看 V2EX 帖子正文与回复。",
    input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "帖子编号。" } },
        required: ["id"],
        additionalProperties: false
    }
};

const V2EX_NODE_TOOL = {
    name: "v2ex_node",
    description: "查看 V2EX 某个节点下的帖子(如 tech、programmer、create)。",
    input_schema: {
        type: "object",
        properties: { node: { type: "string", description: "节点名。" } },
        required: ["node"],
        additionalProperties: false
    }
};

const BILI_SEARCH_TOOL = {
    name: "bili_search",
    description: "在B站搜索视频(标题/UP主/播放/弹幕/时长)。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词。" },
            limit: { type: "number", description: "可选:条数,默认 5,最多 10。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const BILI_VIDEO_TOOL = {
    name: "bili_video",
    description: "获取B站视频详情与字幕(标题/简介/UP主/数据/字幕文本)。用户给 bvid 或视频链接时调用。",
    input_schema: {
        type: "object",
        properties: { bvid: { type: "string", description: "B站视频编号(BV开头)。" } },
        required: ["bvid"],
        additionalProperties: false
    }
};

const WEB_SEARCH_TOOL = {
    name: "web_search_dengta",
    description: "全网搜索(无需密钥):返回结果标题/链接/摘要。用户让你查资料、搜新闻时调用。",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "搜索关键词。" },
            limit: { type: "number", description: "可选:结果数,默认 8,最多 10。" }
        },
        required: ["query"],
        additionalProperties: false
    }
};

const EXA_SEARCH_TOOL = {
    name: "exa_search",
    description: "全网语义搜索(需要服务端配置 EXA_API_KEY)。",
    input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "搜索内容。" } },
        required: ["query"],
        additionalProperties: false
    }
};


const BILI_RECOMMEND_TOOL = {
    name: "bili_recommend",
    description: "根据用户的观看画像主动推荐B站视频(带推荐理由与链接,可配合一起看)。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "可选:指定方向,不填则按画像自动选择。" },
            limit: { type: "number", description: "可选:条数,默认 4,最多 6。" }
        },
        required: [],
        additionalProperties: false
    }
};

const INTERESTS_VIEW_TOOL = {
    name: "interests_view",
    description: "查看用户的兴趣画像与最近观看记录。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

function chooseNeteaseSong(songs, keyword) {
    const list = Array.isArray(songs) ? songs : [];
    if (list.length === 0) return null;
    const tokens = String(keyword || "")
        .toLowerCase()
        .split(/[\s,，。！？、/|]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
    const coverPenalty = /(翻唱|原唱|cover|深情版|女声|男声|dj|伴奏|片段|live|现场|纯音乐|remix)/i;
    let best = list[0];
    let bestScore = -Infinity;
    for (const song of list) {
        const title = String(song?.title || "").toLowerCase();
        const artist = String(song?.artist || "").toLowerCase();
        let score = 0;
        for (const token of tokens) {
            if (title.includes(token)) score += 2;
            if (artist.includes(token)) score += 4;
        }
        if (coverPenalty.test(title)) score -= 8;
        if (coverPenalty.test(artist)) score -= 4;
        if (title === tokens[0]) score += 4;
        if (score > bestScore) { best = song; bestScore = score; }
    }
    return best;
}

async function buildMusicCardForTrack({ track, scope, neteaseTools, neteaseCookieSession }) {
    if (!track?.provider_track_id || !track?.title) return null;
    let audioUrl = "";
    try {
        const receipt = await neteaseTools?.songUrl?.(scope || {}, track.provider_track_id);
        audioUrl = String(receipt?.url || "").replace(/^http:/i, "https:");
        if (!audioUrl) {
            const session = await neteaseCookieSession?.read?.(scope || {});
            if (session?.cookie_text) {
                const fallbackReceipt = await neteaseCookieSession.cookieSongUrl(session.cookie_text, track.provider_track_id);
                audioUrl = String(fallbackReceipt?.url || "").replace(/^http:/i, "https:");
            }
        }
    } catch {
        audioUrl = "";
    }
    return {
        id: String(track.provider_track_id),
        title: String(track.title || "").slice(0, 300),
        artist: String(track.artist || "").slice(0, 300),
        album: String(track.album || "").slice(0, 300),
        cover_url: String(track.cover_url || "").slice(0, 4096),
        duration_seconds: Number(track.duration_seconds) || 0,
        audio_url: audioUrl,
        external_url: "https://music.163.com/#/song?id=" + String(track.provider_track_id),
        playback_mode: audioUrl ? "netease_resolved" : "external_netease",
        source: "netease"
    };
}

function isRandomMusicRequest(value) {
    const phrase = String(value || "").trim();
    if (!phrase || /(不要|别放|不用放|怎么放|如何放|能不能放|可以放吗|为什么|什么歌)/i.test(phrase)) return false;
    return /(随便|随机|来点音乐|来首歌|推荐.{0,6}歌|每日推荐|今天听什么|听点什么|再来一首|换一首|换首|下一首|再放一首|不要这首|不喜欢这首)/i.test(phrase);
}

const RANDOM_MUSIC_KEYWORDS = ["晴天 周杰伦", "夜曲 周杰伦", "小情歌 苏打绿", "稻香 周杰伦", "遇见 孙燕姿", "起风了 买辣椒也用券", "平凡之路 朴树", "慢慢喜欢你 莫文蔚", "后来 刘若英", "旅行的意义 陈绮贞"];

async function buildDailyMusicCard({ scope, neteaseTools, neteaseCookieSession }) {
    if (!neteaseTools) return null;
    let fallbackCard = null;
    const tryTrack = async (track) => {
        if (!track?.provider_track_id || !track?.title) return null;
        const card = await buildMusicCardForTrack({ track, scope, neteaseTools, neteaseCookieSession });
        if (card?.audio_url) return card;
        if (!fallbackCard && card) fallbackCard = card;
        return null;
    };
    try {
        const daily = await neteaseTools.dailyRecommend?.(scope || {});
        const dailyTracks = Array.isArray(daily?.daily) ? daily.daily.filter((item) => item?.provider_track_id && item?.title) : [];
        for (const track of dailyTracks.slice(0, 8)) {
            const card = await tryTrack(track);
            if (card) return card;
        }
        const keywords = [...RANDOM_MUSIC_KEYWORDS].sort(() => Math.random() - 0.5).slice(0, 3);
        for (const keyword of keywords) {
            const search = await neteaseTools.search?.(scope || {}, { keyword, category: "song", limit: 10 });
            const best = chooseNeteaseSong(search?.songs, keyword);
            const candidates = [];
            if (best) candidates.push(best);
            for (const track of Array.isArray(search?.songs) ? search.songs : []) {
                if (track?.provider_track_id && track?.title && track.provider_track_id !== best?.provider_track_id) {
                    candidates.push(track);
                }
            }
            for (const track of candidates.slice(0, 4)) {
                const card = await tryTrack(track);
                if (card) return card;
            }
        }
        return fallbackCard;
    } catch {
        return fallbackCard;
    }
}

async function buildLegacyMusicCard({ keyword, scope, neteaseTools, neteaseCookieSession }) {
    if (!keyword || !neteaseTools?.search) return null;
    try {
        const search = await neteaseTools.search(scope || {}, { keyword, category: "song", limit: 10 });
        const best = chooseNeteaseSong(search?.songs, keyword);
        const candidates = [];
        if (best) candidates.push(best);
        for (const track of Array.isArray(search?.songs) ? search.songs : []) {
            if (track?.provider_track_id && track?.title && track.provider_track_id !== best?.provider_track_id) {
                candidates.push(track);
            }
        }
        let fallbackCard = null;
        for (const track of candidates.slice(0, 5)) {
            const card = await buildMusicCardForTrack({ track, scope, neteaseTools, neteaseCookieSession });
            if (card?.audio_url) return card;
            if (!fallbackCard && card) fallbackCard = card;
        }
        return fallbackCard;
    } catch {
        return null;
    }
}

function extractSongRequest(value) {
    const phrase = String(value || "").trim();
    if (!phrase || /(不要|别放|不用放|怎么放|如何放|能不能放|可以放吗|为什么|什么歌|放歌功能)/i.test(phrase)) return "";
    if (!/播放|放(?:一首|首|首歌|首歌|歌)|放《/.test(phrase)) return "";
    const quoted = phrase.match(/《([^》]{1,80})》/);
    let candidate = quoted?.[1] || "";
    if (candidate) {
        const rest = phrase
            .replace(quoted[0], " ")
            .replace(/^\s*(?:播放|放(?:一首|首)?)/i, " ")
            .replace(/在?聊天里?放.*$/i, " ")
            .replace(/不要打开.*$/i, " ")
            .replace(/[，。！？!?、\s]+/g, " ")
            .trim();
        if (rest) candidate = (candidate + " " + rest).trim();
    }
    if (!candidate) {
        const match = phrase.match(/(?:播放|放)(?:一首|首|个|点)?\s*([^，。！？\n]{1,80})/);
        candidate = match?.[1] || "";
    }
    candidate = String(candidate)
        .replace(/^(?:一首|首|个|点)?\s*(?:歌|歌曲|音乐)?\s*/i, "")
        .trim();
    if (!candidate || /^(?:歌|歌曲|音乐|首歌|列表|歌单|电台)$/.test(candidate)) return "";
    return candidate.slice(0, 80);
}

function withSoftTimeout(promise, timeoutMs, fallback) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise(resolve => {
            timer = setTimeout(() => resolve(fallback), timeoutMs);
        })
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function buildFeatureHints(userMessage) {
    const text = String(userMessage || "");
    const hints = [];
    if (/(外卖|点餐|点个吃|饿了|夜宵|订餐|买饭|烧烤|奶茶|点外卖)/i.test(text) && !/不|别|没想/.test(text)) {
        hints.push("[玩法提示:用户想点外卖。不要只聊天,必须先调用 takeout_order 工具(action=search)帮用户搜索店铺列表,再根据预算/评分挑店;搜索结果为空时引导用户先去侧边栏「🛵 外卖」扫码登录。]");
    }
    if (/(?:帮我|给我|想要|来|生成|画一|画个|画张).{0,8}(?:画|图|头像|插画|涂鸦)|画(?:一张|个|幅|张)/i.test(text)) {
        hints.push("[玩法提示：用户想要一张图。直接调用 create_artwork 工具，把画面写具体（主体/场景/构图/光线/风格），不要只口头答应；图片会在后台画好并出现在这条消息里。]");
    }
    if (/(放首歌|播放.{0,8}歌|来首|想听|一起听|听歌)/i.test(text) && !/电台|dj|radio/i.test(text)) {
        hints.push("[玩法提示：用户想听歌。优先调用 netease_play_song，把歌名/歌手填进 keyword；解析到 HTTPS 音频时回复里会出现听歌卡片，可以直接在 DengTa 内播放，不要打开外部网易云 App。]");
    }
    if (/电台|dj|radio|来点音乐|放首歌|推荐.{0,4}歌/i.test(text)) {
        hints.push("[玩法提示：用户想要电台/DJ体验。你可以扮演私人电台DJ：开场白→推荐2-3首符合当前心情的歌（报出歌名和歌手）→聊几句串词→谢幕。开场白不要重复以前用过的。]");
    }
    if (/bilibili\.com\/video\/|BV[0-9A-Za-z]{6,12}/i.test(text)) {
        hints.push("[玩法提示:用户发了B站视频链接。先用 bili_video 工具解析(标题/简介/字幕),再从视频内容出发自然回应;字幕为空就基于标题和简介聊,不要谎称拿到了字幕。]");
    }
    if (/弹幕|共读|一起.{0,6}弹幕/i.test(text)) {
        hints.push("[玩法提示：用户想弹幕共读。先用 danmaku_read 工具读取该视频弹幕样本，再结合视频标题像一起看弹幕的朋友一样吐槽、接梗。]");
    }
    if (/默契|默契度/i.test(text)) {
        hints.push("[玩法提示：用户想玩默契度挑战。你来出3-5道关于你们之间的小问题（结合记忆），每题等用户回答后即时判分（每题满分20-25），最后算总分并用 compatibility_record 工具存档，再俏皮点评。]");
    }
    if (/识物|这是什么|什么花|什么植物|什么动物|认.{0,4}东西/i.test(text) && /图|照片|拍|看|这/.test(text)) {
        hints.push("[玩法提示：用户想拍照识物。若本轮有图片附件且你能直接看图，就基于可见内容自然回答；若无法看图，诚实说明识物服务当前未开启，请用户用文字描述再猜。]");
    }
    return hints.join("\n");
}

const memoryCompressionLocks = new Set();
let shadowPushLock = false;
let diaryGenerationLock = false;
let diaryGenerationStatus = {
    state: "watching",
    message: "正在等待新的真实对话。",
    updated_at: new Date().toISOString()
};

function cleanText(value, maxLength = 10000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePromptMode(value, fallback = "legacy") {
    const normalized = String(value ?? fallback)
        .trim()
        .toLowerCase();
    if (["legacy", "unified"].includes(normalized)) return normalized;

    const error = new Error("prompt_mode 只能是 legacy 或 unified。");
    error.status = 400;
    throw error;
}

function cleanUnifiedSystemPrompt(value) {
    return String(value ?? "");
}

function cleanUserDetails(value) {
    const normalized = String(value ?? "");
    return normalized;
}

function normalizeChatRequest(req) {
    const body = normalizeChatBody(req.body, req.files);
    return {
        ...body,
        // 仅内部通道桥接（QQ/微信）可以覆盖本回合人设；公开的 /api/v2/chat
        // 即使伪造 channel_persona 也一律丢弃，避免绕过设置保存时的提示词检查。
        channelPersona: req?.isChannelBridge === true ? body.channelPersona : "",
        qqCloud: req?.isChannelBridge === true && req?.isQQCloud === true,
        requestScope: req.scope || null
    };
}

function acceptChatBody(req, res, next) {
    if (!req.is("multipart/form-data")) {
        req.files = [];
        next();
        return;
    }
    chatUpload.fields([
        { name: "files", maxCount: MAX_ATTACHMENT_FILES },
        { name: "attachments", maxCount: MAX_ATTACHMENT_FILES }
    ])(req, res, (error) => {
        if (error) return next(error);
        const groups = req.files && typeof req.files === "object" ? req.files : {};
        req.files = [
            ...(Array.isArray(groups.files) ? groups.files : []),
            ...(Array.isArray(groups.attachments) ? groups.attachments : [])
        ];
        if (req.files.length > MAX_ATTACHMENT_FILES) {
            const tooMany = new Error("一次最多发送 4 个附件。");
            tooMany.status = 413;
            return next(tooMany);
        }
        next();
    });
}

function cleanInternalMomentContext(value, maxLength = 1500) {
    return cleanText(value, maxLength)
        .replace(/active_session_id:[^\s]+/gi, "")
        .replace(/tool_call_id:[^\s]+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value ?? "")
    );
}

function toNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, number));
}

function createChatToolExecutor(
    conversationId,
    initialCompanionStatus,
    clientMessageId = "",
    mcpRuntime = null,
    database = supabase,
    userDisplayName = "",
    customStickers = [],
    scope = null,
    takeoutChannel = null,
    specialDates = null,
    funServices = null,
    turnImageUrl = "",
    xhsClient = null,
    neteaseTools = null,
    webExplorer = null,
    interestTools = null,
    stickerImportPermission = null,
    creativeCenter = null
) {
    let momentCreated = false;
    let statusUpdated = false;
    let creativeArtwork = null;
    let musicCard = null;
    const creativeTool = creativeCenter
        ? createCompanionCreativeToolExecutor({
              center: creativeCenter,
              database,
              scope,
              onArtwork: (payload) => { creativeArtwork = payload; }
          })
        : null;
    const executeTakeoutTool = createTakeoutToolExecutor({ scope, channel: takeoutChannel, conversationId, clientMessageId });
    const scopedXhsClient = scope && typeof xhsClient?.forScope === "function" ? xhsClient.forScope(scope) : null;
    const stickerSelector = createCompanionStickerSelector(customStickers);
    const bilibiliStickerRuntime = stickerImportPermission?.bilibili_enabled
        ? createBilibiliStickerChatRuntime({ service: stickerImports, scope,
            turnId: clientMessageId, selector: stickerSelector, permission: stickerImportPermission })
        : { tools: [], executeTool: call => stickerSelector.executeTool(call) };
    const stickerImportRuntime = stickerImportPermission?.xhs_enabled && stickerImportPermission.xhs_schema_available
        ? createXhsStickerChatRuntime({ service: xhsStickerImports, scope, turnId: clientMessageId,
            selector: stickerSelector, permission: stickerImportPermission, next: bilibiliStickerRuntime })
        : bilibiliStickerRuntime;
    const activities = createCompanionActivities({ scope, recommendations: (currentScope, limit) => bilibiliQrLogin.recommendations(currentScope, limit) });
    const stickerTool = createCompanionStickerTool(customStickers);
    const replySuggestionSelector = createReplySuggestionSelector();
    let companionStatus = sanitizeCompanionStatusSnapshot(
        initialCompanionStatus
    );

    async function executeChatTool(toolCall) {
        if (toolCall?.name === COMPANION_ACTIVITY_TOOL.name) return activities.execute(toolCall);
        if (toolCall?.name === UPDATE_COMPANION_STATUS_TOOL.name) {
            if (statusUpdated) {
                return { ok: false, error: "这次聊天已经更新过一次状态。" };
            }

            const parsed = parseCompanionStatusToolArguments(
                toolCall.arguments ?? ""
            );
            if (!parsed.ok) {
                return { ok: false, error: parsed.error };
            }

            companionStatus = applyCompanionStatusUpdate(
                companionStatus,
                parsed.value,
                new Date(),
                { userDisplayName }
            );
            statusUpdated = true;
            return {
                ok: true,
                message: "伙伴状态已更新。",
                companion_status: companionStatus
            };
        }

        if ([SELECT_COMPANION_STICKER_TOOL.name, "import_bilibili_sticker", "import_xhs_sticker"].includes(toolCall?.name)) {
            return stickerImportRuntime.executeTool(toolCall);
        }

        if (toolCall?.name === SELECT_REPLY_SUGGESTIONS_TOOL.name) {
            return replySuggestionSelector.executeTool(toolCall);
        }

        if (typeof whereaboutsSnapshot === "function" && [
            "whereabouts_snapshot",
            "whereabouts_current_stay",
            "whereabouts_recent_stays",
            "whereabouts_recent_moves",
            "whereabouts_summary"
        ].includes(toolCall?.name)) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "行踪功能需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "行踪参数不是有效的 JSON。" };
            }
            try {
                const tenant = { database, userId: scope.userId, companionId: scope.companionId };
                if (toolCall.name === "whereabouts_snapshot") {
                    return { ok: true, snapshot: await whereaboutsSnapshot({ ...tenant, stayLimit: Number(args.stayLimit) || 5, moveLimit: Number(args.moveLimit) || 5, batteryBucketMinutes: Number(args.batteryBucketMinutes) || 5 }) };
                }
                if (toolCall.name === "whereabouts_current_stay") {
                    return { ok: true, ...(await whereaboutsCurrentStay(tenant)) };
                }
                if (toolCall.name === "whereabouts_recent_stays") {
                    return { ok: true, ...(await whereaboutsRecentStays({ ...tenant, limit: Number(args.limit) || 20 })) };
                }
                if (toolCall.name === "whereabouts_recent_moves") {
                    return { ok: true, ...(await whereaboutsRecentMoves({ ...tenant, limit: Number(args.limit) || 20 })) };
                }
                return { ok: true, ...(await whereaboutsSummary({ ...tenant, range: String(args.range || "day"), batteryBucketMinutes: Number(args.batteryBucketMinutes) || 5 })) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "行踪查询失败。").slice(0, 300) };
            }
        }
        if (typeof timelineWriteDay === "function" && [
            "timeline_write",
            "timeline_read",
            "timeline_categories",
            "timeline_proposals"
        ].includes(toolCall?.name)) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "时间轴功能需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "时间轴参数不是有效的 JSON。" };
            }
            try {
                const tenant = { database, userId: scope.userId, companionId: scope.companionId };
                const timezone = String(scope?.timezone || "Asia/Shanghai");
                if (toolCall.name === "timeline_write") {
                    return { ok: true, ...(await timelineWriteDay({ ...tenant, timezone, payload: args, source: conversationId ? { threadId: conversationId, transcriptMessageCount: 0 } : null })) };
                }
                if (toolCall.name === "timeline_read") {
                    return { ok: true, ...(await timelineReadDay({ ...tenant, date: String(args.date || "") })) };
                }
                if (toolCall.name === "timeline_categories") {
                    return { ok: true, ...(await timelineListCategories(tenant)) };
                }
                return { ok: true, ...(await timelineListProposals({ ...tenant, date: String(args.date || "") })) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "时间轴操作失败。").slice(0, 300) };
            }
        }
        if (toolCall?.name === AGENTS_MD_READ_TOOL.name) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "agents.md 读取需要登录态，请先登录后再试。" };
            }
            try {
                const settings = await getSettings(scope.db);
                const preview = await loadAgentsMdPreview({ database: scope.db, settings });
                const agentsMd = preview.content;
                return {
                    ok: true,
                    file: "agents.md",
                    chars: agentsMd.length,
                    preview_scope: preview.preview_scope,
                    is_generation_receipt: false,
                    note: preview.note,
                    content: agentsMd
                };
            } catch (error) {
                return { ok: false, code: "agents_md_read_failed", error: "读取 agents.md 失败，请稍后重试。" };
            }
        }
        if (typeof listWorkspace === "function" && [
            "workspace_list",
            "workspace_read",
            "workspace_write",
            "workspace_delete"
        ].includes(toolCall?.name)) {
            if (!scope?.userId) {
                return { ok: false, error: "工作区需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "工作区参数不是有效的 JSON。" };
            }
            try {
                const storageClient = scope?.storage || supabase.storage;
                if (toolCall.name === "workspace_list") {
                    return await listWorkspace({ storage: storageClient, userId: scope.userId, path: String(args.path || "") });
                }
                if (toolCall.name === "workspace_read") {
                    return await readWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || "") });
                }
                if (toolCall.name === "workspace_write") {
                    return await writeWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || ""), content: String(args.content || ""), mode: String(args.mode || "overwrite"), confirm: args.confirm === true });
                }
                return await deleteWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || ""), confirm: args.confirm === true });
            } catch (error) {
                return { ok: false, error: String(error?.message || "工作区操作失败。").slice(0, 300) };
            }
        }
        if (mcpRuntime?.hasTool(toolCall?.name)) {
            return mcpRuntime.execute(toolCall);
        }

        if (toolCall?.name === TAKEOUT_TOOL.name) {
            return executeTakeoutTool(toolCall);
        }

        if (creativeTool && toolCall?.name === CREATIVE_ARTWORK_TOOL.name) {
            return creativeTool.execute(toolCall);
        }


        if (toolCall?.name === SPECIAL_DATE_ADD_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "特殊日子参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "特殊日子参数格式不正确。" };
            }
            try {
                const saved = await specialDates.add(scope || {}, args);
                return { ok: true, saved, message: "已保存特殊日子。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "保存失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === SPECIAL_DATE_LIST_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let kind = "";
            try {
                kind = String(JSON.parse(String(toolCall.arguments || "")).kind || "");
            } catch {
                // 忽略参数解析失败，按全部查询。
            }
            try {
                const dates = await specialDates.list(scope || {}, kind);
                return { ok: true, dates };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === SPECIAL_DATE_REMOVE_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let id = "";
            try {
                id = String(JSON.parse(String(toolCall.arguments || "")).id || "");
            } catch {
                // 忽略参数解析失败。
            }
            try {
                const removed = await specialDates.remove(scope || {}, id);
                return { ok: true, removed: removed.removed, message: "已删除。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "删除失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === DAILY_SHOT_ADD_TOOL.name) {
            if (!funServices?.dailies) {
                return { ok: false, error: "每日一拍服务还没有启用。" };
            }
            let note = "";
            try {
                note = String(JSON.parse(String(toolCall.arguments || "")).note || "");
            } catch {
                // 备注可选。
            }
            try {
                const saved = await funServices.dailies.add(scope || {}, {
                    note,
                    image_path: turnImageUrl || ""
                });
                return { ok: true, saved, message: "已记入今日的每日一拍。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "保存失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENTS_LIST_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            try {
                await funServices.achievements.check(scope || {});
                const achievements = await funServices.achievements.list(scope || {});
                return { ok: true, achievements };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === DANMAKU_READ_TOOL.name) {
            if (!funServices?.funLabs) {
                return { ok: false, error: "弹幕共读服务还没有启用。" };
            }
            let bvid = "";
            try {
                bvid = String(JSON.parse(String(toolCall.arguments || "")).bvid || "");
            } catch {
                // 忽略解析失败。
            }
            try {
                const danmaku = await funServices.funLabs.readDanmaku(bvid);
                return {
                    ok: true,
                    bvid: danmaku.bvid,
                    title: danmaku.title,
                    danmaku_sample: danmaku.danmaku_sample.slice(0, 60)
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "弹幕读取失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === COMPATIBILITY_RECORD_TOOL.name) {
            if (!funServices?.funLabs) {
                return { ok: false, error: "默契度服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "默契度参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "默契度参数格式不正确。" };
            }
            try {
                const saved = await funServices.funLabs.saveCompatibility(scope || {}, {
                    score: args.score,
                    comment: String(args.comment || "")
                });
                return {
                    ok: true,
                    saved,
                    message:
                        "已存档本次默契度：" +
                        saved.record.score +
                        "分（历史最好 " +
                        saved.best +
                        "分，平均 " +
                        saved.average +
                        "分）。"
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "存档失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENT_DEFINE_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "成就参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "成就参数格式不正确。" };
            }
            try {
                const saved = await funServices.achievements.define(scope || {}, {
                    title: args.title,
                    description: args.description,
                    emoji: args.emoji,
                    category: args.category,
                    created_by: "user"
                });
                return { ok: true, saved, message: "已新建自定义成就。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "新建失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENT_UNLOCK_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            let code = "";
            try {
                code = String(JSON.parse(String(toolCall.arguments || "")).code || "");
            } catch {
                // 忽略解析失败。
            }
            try {
                const unlocked = await funServices.achievements.unlock(scope || {}, code);
                return { ok: true, unlocked, message: unlocked.already ? "这条成就已经解锁过了。" : "成就已解锁，记得用惊喜的口吻告诉用户。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "解锁失败。").slice(0, 300) };
            }
        }


        if (toolCall?.name === XHS_ME_TOOL.name) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            try {
                const me = await scopedXhsClient.me();
                return { ok: true, me };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === XHS_SEARCH_TOOL.name) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "搜索参数不是有效的 JSON。" };
            }
            try {
                const result = await scopedXhsClient.search(
                    String(args?.keyword || ""),
                    Number(args?.page) || 1
                );
                const items = Array.isArray(result?.items) ? result.items : [];
                return {
                    ok: true,
                    keyword: String(args?.keyword || ""),
                    count: items.length,
                    items: items.slice(0, 10)
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "搜索失败。").slice(0, 300) };
            }
        }

        if (
            toolCall?.name === XHS_LIKE_TOOL.name ||
            toolCall?.name === XHS_COMMENT_TOOL.name ||
            toolCall?.name === XHS_FOLLOW_TOOL.name
        ) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object") {
                return { ok: false, error: "参数格式不正确。" };
            }
            return {
                ok: false,
                confirmation_required: true,
                error:
                    "这是会操作用户真实小红书账号的写操作。AI 不能直接执行；请在小红书界面预览操作并由用户确认后再提交。"
            };
        }


        if (
            toolCall?.name === CLOUD_MUSIC_SEARCH_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_DAILY_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_CREATE_PLAYLIST_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ALBUM_INFO_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ARTIST_INFO_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_SUBSCRIPTIONS_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_LIKE_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_HISTORY_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_MY_PLAYLISTS_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL.name ||
            toolCall?.name === NETEASE_PLAY_SONG_TOOL.name
        ) {
            if (!neteaseTools) {
                return { ok: false, error: "网易云音乐工具还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                args = {};
            }
            try {
                if (toolCall?.name === CLOUD_MUSIC_SEARCH_TOOL.name) {
                    const result = await neteaseTools.search(scope || {}, {
                        keyword: String(args.keyword || ""),
                        category: String(args.category || "song"),
                        limit: args.limit
                    });
                    return { ok: true, result };
                }
                if (toolCall?.name === CLOUD_MUSIC_DAILY_TOOL.name) {
                    return { ok: true, result: await neteaseTools.dailyRecommend(scope || {}) };
                }
                if (toolCall?.name === CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL.name) {
                    return { ok: true, result: await neteaseTools.playlistDetail(scope || {}, { playlist_id: args.playlist_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_CREATE_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.createPlaylist(scope || {}, { name: args.name, privacy: args.privacy }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.addToPlaylist(scope || {}, { playlist_id: args.playlist_id, track_ids: args.track_ids }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ALBUM_INFO_TOOL.name) {
                    return { ok: true, result: await neteaseTools.albumInfo(scope || {}, { album_id: args.album_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ARTIST_INFO_TOOL.name) {
                    return { ok: true, result: await neteaseTools.artistInfo(scope || {}, { artist_id: args.artist_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_SUBSCRIPTIONS_TOOL.name) {
                    return { ok: true, result: await neteaseTools.subscriptions(scope || {}, { category: args.category }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_LIKE_TOOL.name) {
                    return { ok: true, result: await neteaseTools.likeSong(scope || {}, { song_id: args.song_id, like: args.like }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_MY_PLAYLISTS_TOOL.name) {
                    return { ok: true, result: await neteaseTools.myPlaylists(scope || {}) };
                }
                if (toolCall?.name === CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.removeFromPlaylist(scope || {}, { playlist_id: args.playlist_id, track_ids: args.track_ids }) };
                }
                if (toolCall?.name === NETEASE_PLAY_SONG_TOOL.name) {
                    const keyword = String(args?.keyword || "").slice(0, 120);
                    if (!keyword) return { ok: false, error: "请告诉我要播放什么歌。" };
                    try {
                        const session = await neteaseCookieSession.read(scope || {}).catch(() => null);
                        if (!session?.cookie_text) {
                            return { ok: false, error: "还没有连接网易云，请先在 App 内一键登录。" };
                        }
                        const search = await neteaseTools.search(scope || {}, { keyword, category: "song", limit: 10 });
                        const songs = Array.isArray(search?.songs) ? search.songs : [];
                        if (songs.length === 0) return { ok: false, error: "没有找到这首歌。" };
                        const track = chooseNeteaseSong(songs, keyword) || songs[0];
                        const songId = String(track.provider_track_id || "").trim();
                        let resolvedAudioUrl = "";
                        try {
                            const audioReceipt = await neteaseTools.songUrl?.(scope || {}, songId);
                            resolvedAudioUrl = String(audioReceipt?.url || "").replace(/^http:/i, "https:");
                            if (!resolvedAudioUrl) {
                                const cookieReceipt = await neteaseCookieSession.cookieSongUrl(
                                    session.cookie_text,
                                    songId
                                );
                                resolvedAudioUrl = String(cookieReceipt?.url || "").replace(/^http:/i, "https:");
                            }
                        } catch {
                            resolvedAudioUrl = "";
                        }
                        const ownerDb = requestDatabase({ scope });
                        const ownKeys = { user_id: scope.userId, companion_id: scope.companionId };
                        const existingPl = await ownerDb
                            .from("music_playlists")
                            .select("id")
                            .eq("provider", "netease")
                            .eq("provider_playlist_id", songId)
                            .maybeSingle();
                        if (existingPl.error) throw existingPl.error;
                        const plValues = {
                            ...ownKeys,
                            name: (String(track.title || "").slice(0, 180) || ("网易云单曲 " + songId)) + " · " + String(track.artist || "网易云音乐").slice(0, 120),
                            provider: "netease",
                            provider_playlist_id: songId,
                            external_url: "https://music.163.com/#/song?id=" + songId,
                            source_format: "netease_cookie",
                            item_count: 1,
                            updated_at: new Date().toISOString()
                        };
                        let playlistId = existingPl.data?.id || null;
                        if (playlistId) {
                            const upd = await ownerDb.from("music_playlists").update(plValues).eq("id", playlistId);
                            if (upd.error) throw upd.error;
                        } else {
                            const ins = await ownerDb.from("music_playlists").insert(plValues).select("id").single();
                            if (ins.error) throw ins.error;
                            playlistId = ins.data.id;
                        }
                        const itemSel = await ownerDb
                            .from("music_playlist_items")
                            .select("id")
                            .eq("playlist_id", playlistId)
                            .limit(1);
                        if (itemSel.error) throw itemSel.error;
                        const itemValues = {
                            ...ownKeys,
                            playlist_id: playlistId,
                            position: 0,
                            provider_track_id: songId,
                            external_url: "https://music.163.com/#/song?id=" + songId,
                            playback_mode: resolvedAudioUrl ? "netease_resolved" : "external_netease",
                            url: resolvedAudioUrl || null,
                            title: String(track.title || "").slice(0, 300) || ("网易云单曲 " + songId),
                            artist: String(track.artist || "").slice(0, 300) || "网易云音乐",
                            album: String(track.album || "").slice(0, 300),
                            cover_url: String(track.cover_url || "").slice(0, 4096) || null,
                            duration_seconds: Number(track.duration_seconds) || null,
                            lyrics: ""
                        };
                        if (itemSel.data?.[0]?.id) {
                            const updI = await ownerDb.from("music_playlist_items").update(itemValues).eq("id", itemSel.data[0].id);
                            if (updI.error) throw updI.error;
                        } else {
                            const insI = await ownerDb.from("music_playlist_items").insert(itemValues);
                            if (insI.error) throw insI.error;
                        }
                        const card = {
                            id: songId,
                            title: String(track.title || "").slice(0, 300) || ("网易云单曲 " + songId),
                            artist: String(track.artist || "").slice(0, 300) || "网易云音乐",
                            album: String(track.album || "").slice(0, 300),
                            cover_url: String(track.cover_url || "").slice(0, 4096),
                            duration_seconds: Number(track.duration_seconds) || 0,
                            audio_url: resolvedAudioUrl,
                            external_url: "https://music.163.com/#/song?id=" + songId,
                            playback_mode: resolvedAudioUrl ? "netease_resolved" : "external_netease",
                            source: "netease"
                        };
                        musicCard = card;
                        return {
                            ok: true,
                            result: {
                                song: track,
                                music: card,
                                play_requested: false,
                                note: resolvedAudioUrl
                                    ? "已在聊天里准备好《" + card.title + "》，可以直接点卡片播放。"
                                    : "《" + card.title + "》没有可用的 HTTPS 音频（可能需要会员或版权受限），已在聊天里留下卡片，未打开外部 App。"
                            }
                        };
                    } catch (error) {
                        return { ok: false, error: String(error?.message || "播放失败。").slice(0, 200) };
                    }
                }
                return { ok: true, result: await neteaseTools.playHistory(scope || {}, { limit: args.limit }) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "网易云操作失败。").slice(0, 300) };
            }
        }


        if (
            toolCall?.name === WEB_READ_TOOL.name ||
            toolCall?.name === RSS_READ_TOOL.name ||
            toolCall?.name === V2EX_HOT_TOOL.name ||
            toolCall?.name === V2EX_TOPIC_TOOL.name ||
            toolCall?.name === V2EX_NODE_TOOL.name ||
            toolCall?.name === BILI_SEARCH_TOOL.name ||
            toolCall?.name === BILI_VIDEO_TOOL.name ||
            toolCall?.name === EXA_SEARCH_TOOL.name ||
            toolCall?.name === WEB_SEARCH_TOOL.name
        ) {
            if (!webExplorer) {
                return { ok: false, error: "网络探索服务还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                args = {};
            }
            try {
                if (toolCall?.name === WEB_READ_TOOL.name) {
                    return { ok: true, result: await webExplorer.webRead(String(args.url || "")) };
                }
                if (toolCall?.name === RSS_READ_TOOL.name) {
                    return { ok: true, result: await webExplorer.rssRead(String(args.url || ""), args.limit) };
                }
                if (toolCall?.name === V2EX_HOT_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exHot() };
                }
                if (toolCall?.name === V2EX_TOPIC_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exTopic(args.id) };
                }
                if (toolCall?.name === V2EX_NODE_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exNode(String(args.node || "")) };
                }
                if (toolCall?.name === BILI_SEARCH_TOOL.name) {
                    return { ok: true, result: await webExplorer.biliSearch(String(args.keyword || ""), args.limit) };
                }
                if (toolCall?.name === BILI_VIDEO_TOOL.name) {
                    const biliCookie = scope?.userId
                        ? await bilibiliQrLogin.cookieText(scope).catch(() => "")
                        : "";
                    return { ok: true, result: await webExplorer.biliVideo(String(args.bvid || ""), biliCookie) };
                }
                if (toolCall?.name === EXA_SEARCH_TOOL.name) {
                    return { ok: true, result: await webExplorer.exaSearch(String(args.query || "")) };
                }
                return { ok: true, result: await webExplorer.webSearch(String(args.query || ""), args.limit) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "网络探索失败。").slice(0, 300) };
            }
        }


        if (toolCall?.name === BILI_RECOMMEND_TOOL.name) {
            if (!interestTools) {
                return { ok: false, error: "兴趣引擎还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            try {
                return { ok: true, result: await interestTools.recommendBili(scope || {}, args || {}) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "推荐失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === INTERESTS_VIEW_TOOL.name) {
            if (!interestTools) {
                return { ok: false, error: "兴趣引擎还没准备好。" };
            }
            try {
                return { ok: true, profile: await interestTools.interests(scope || {}) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name !== POST_MOMENT_TOOL.name) {
            return { ok: false, error: "未知工具，未执行。" };
        }
        if (momentCreated) {
            return { ok: false, error: "这次聊天已经发布过一条动态。" };
        }

        let args;
        try {
            args = JSON.parse(String(toolCall.arguments || ""));
        } catch {
            return { ok: false, error: "动态参数不是有效的 JSON。" };
        }

        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return { ok: false, error: "动态参数格式不正确。" };
        }
        if (typeof args.content !== "string" || typeof args.context_note !== "string") {
            return { ok: false, error: "动态正文和内部备注必须是文字。" };
        }

        const content = cleanText(args.content, 800);
        const contextNote = cleanInternalMomentContext(args.context_note, 1500);
        if (!content || !contextNote) {
            return { ok: false, error: "动态正文和内部备注不能为空。" };
        }

        const replyDueAt = new Date(
            Date.now() + randomDelayMinutes(8, 20) * 60 * 1000
        ).toISOString();
        const storedContextNote = [
            contextNote,
            isUuid(conversationId) ? `active_session_id:${conversationId}` : ""
        ]
            .filter(Boolean)
            .join("\n");

        try {
            if (clientMessageId) {
                const { data: existing, error: findError } = await database
                    .from("moments")
                    .select("id")
                    .eq("source_client_message_id", clientMessageId)
                    .maybeSingle();
                if (findError) throw findError;
                if (existing) {
                    momentCreated = true;
                    return {
                        ok: true,
                        moment_id: existing.id,
                        message: "动态已发布。",
                        deduplicated: true
                    };
                }
            }

            const momentValues = {
                author: "assistant",
                content,
                context_note: storedContextNote,
                images: [],
                reply_due_at: replyDueAt,
                reply_status: "done"
            };
            if (clientMessageId) {
                momentValues.source_client_message_id = clientMessageId;
            }
            const { data, error } = await database
                .from("moments")
                .insert(momentValues)
                .select("id")
                .single();

            if (error) throw error;
            momentCreated = true;
            return {
                ok: true,
                moment_id: data.id,
                message: "动态已发布。"
            };
        } catch (error) {
            console.error("AI 动态发布失败：", error?.message || "未知错误");
            return { ok: false, error: "动态发布失败。" };
        }
    }

    return {
        executeTool: executeChatTool,
        getCompanionStatus() {
            return sanitizeCompanionStatusSnapshot(companionStatus);
        },
        wasCompanionStatusUpdated() {
            return statusUpdated === true;
        },
        getStickerId() {
            return stickerSelector.getStickerId();
        },
        getCustomStickerId() {
            return stickerSelector.getCustomStickerId();
        },
        getStickerTool() {
            return stickerTool;
        },
        getStickerImportTools() {
            return [...stickerImportRuntime.tools,
                ...(stickerImportRuntime.tools.some(tool => tool.name === "import_bilibili_sticker") ? [BILI_SEARCH_TOOL] : []),
                ...(stickerImportRuntime.tools.some(tool => tool.name === "import_xhs_sticker") ? [XHS_SEARCH_TOOL] : [])];
        },
        getReplySuggestions() {
            return replySuggestionSelector.getSuggestions();
        },
        getActivityActions() {
            return activities.getActions();
        },
        getCreativeArtwork() {
            return creativeArtwork;
        },
        getMusicCard() {
            return musicCard;
        },
        setMusicCard(card) {
            musicCard = card || null;
        }
    };
}

function previousReplySuggestionsFromMessages(messages = []) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
            message?.role === "assistant" &&
            Array.isArray(message?.tool_calls?.reply_suggestions)
        ) {
            return message.tool_calls.reply_suggestions;
        }
    }
    return [];
}

function limitVoiceTurnsPerIp(req, res, next) {
    const result = voiceRateLimitState.consume(req.ip || req.socket?.remoteAddress);
    if (result.allowed) {
        next();
        return;
    }

    const retryAfterSeconds = setRetryAfterHeader(
        res,
        result.retryAfterMs
    );
    res.status(429).json({
        message: "语音发送得太频繁了，请稍等一下再试。",
        retry_after_seconds: retryAfterSeconds
    });
}

function estimateTokenCount(value) {
    return budgetEstimateTokens(String(value ?? ""));
}

function estimateContextTokenCount(settings, messages, memories) {
    // 统计会增长的部分：历史消息 + 已有记忆 + 用户详情。
    // 固定的系统提示词不计入——提示词本身可长达 1.6 万 tokens，
    // 若计入会垫高估算，让压缩阈值几乎永远无法触发（历史消息永远"看起来"没超预算）。
    const fixedContext = [
        settings.user_details,
        ...(memories || []).map((item) => item.summary)
    ]
        .filter(Boolean)
        .join("\n\n");

    return (
        estimateTokenCount(fixedContext) +
        (messages || []).reduce(
            (total, item) => total + 4 + estimateTokenCount(item.content),
            0
        )
    );
}

function normalizeApiUrl(value) {
    const cleaned = cleanText(value, 500).replace(/\/+$/, "");
    if (!cleaned) return "";

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        const error = new Error("API 地址格式不正确。");
        error.status = 400;
        throw error;
    }

    const hostname = parsed.hostname.toLowerCase();
    const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(
        hostname
    );
    const privateIpv4 =
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^169\.254\./.test(hostname);

    if (parsed.username || parsed.password) {
        const error = new Error("API 地址不能包含用户名或密码。");
        error.status = 400;
        throw error;
    }

    if (
        parsed.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && localDevelopmentHost)
    ) {
        const error = new Error("API 地址必须使用 HTTPS。");
        error.status = 400;
        throw error;
    }

    if (
        process.env.NODE_ENV === "production" &&
        (localDevelopmentHost || privateIpv4 || hostname.endsWith(".local"))
    ) {
        const error = new Error("公开部署时不能使用本机或内网 API 地址。");
        error.status = 400;
        throw error;
    }

    return cleaned;
}

function isMissingRelationError(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /could not find the table|relation .* does not exist/i.test(error?.message || "")
    );
}

function writeSse(res, event) {
    // 客户端可能已经切到后台/被系统杀掉；写失败不能反过来中断服务器生成。
    if (!res || res.writableEnded || res.destroyed) return false;
    try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (typeof res.flush === "function") {
            res.flush();
        }
        return true;
    } catch {
        return false;
    }
}

function alignReplyBubbleState(segments, content) {
    const source = String(content || "");
    if (!source || !Array.isArray(segments) || !segments.length) return null;
    let cursor = 0;
    const boundaries = [];
    for (const raw of segments) {
        const text = String(raw || "").trim();
        if (!text) continue;
        const index = source.indexOf(text, cursor);
        if (index < 0) return null;
        cursor = index + text.length;
        boundaries.push(cursor);
    }
    if (!boundaries.length) return null;
    // 只保留能覆盖到保存正文的有效边界；尾部额外文本无法对齐时不写 metadata。
    if (source.slice(cursor).trim()) return null;
    return {
        version: 1,
        count: boundaries.length,
        boundaries
    };
}

async function persistReplyBubbles(database, messageId, state) {
    if (!database || !messageId || !state || !Array.isArray(state.boundaries)) {
        return false;
    }
    const { data, error } = await database
        .from("messages")
        .select("tool_calls")
        .eq("id", messageId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const existing =
        data.tool_calls && typeof data.tool_calls === "object"
            ? data.tool_calls
            : {};
    const { error: updateError } = await database
        .from("messages")
        .update({
            tool_calls: {
                ...existing,
                reply_bubbles: {
                    version: 1,
                    count: state.count,
                    boundaries: state.boundaries
                }
            }
        })
        .eq("id", messageId);
    if (updateError) throw updateError;
    return true;
}

function runtimeContextFromValues(values, companionStatus, userDisplayName = "") {
    return [
        buildEnvironmentRuntimeContext(values.environmentContext),
        buildCompanionStatusRuntimeContext(companionStatus, new Date(), {
            userDisplayName
        })
    ]
        .filter(Boolean)
        .join("\n");
}

function runtimeContextFromRequest(req, companionStatus) {
    return runtimeContextFromValues(
        {
            environmentContext:
                req.body.environment_context || req.body.weather_context
        },
        companionStatus
    );
}

async function getStoredSettings(database = supabase) {
    const { data, error } = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: created, error: createError } = await database
        .from("settings")
        .insert(defaultSettings)
        .select("*")
        .single();

    if (createError) {
        throw createError;
    }

    return created;
}

async function getSettings(database = supabase) {
    const stored = await getStoredSettings(database);
    return aiProviderCenter
        .forDatabase(database)
        .resolveDefaultSettings(providerCenterBaseSettings(stored));
}

// Proactive messages must not silently stop because the active profile
// returns an empty body or times out. Retry the same prompt on other enabled
// profiles; the caller only sees a successful generation or the original error.
async function generateReplyWithProviderFallback(input) {
    try {
        return await generateReply(input);
    } catch (primaryError) {
        let profiles = [];
        try {
            profiles = await aiProviderCenter
                .forDatabase(input?.database || supabase)
                .runtimeProfiles(input?.settings || {});
        } catch {
            profiles = [];
        }
        for (const profile of profiles) {
            if (
                profile.provider === input?.settings?.provider &&
                profile.model === input?.settings?.model
            ) {
                continue;
            }
            try {
                return await generateReply({
                    ...input,
                    settings: { ...(input?.settings || {}), ...profile }
                });
            } catch {
                // Try the next enabled profile.
            }
        }
        throw primaryError;
    }
}

async function loadConversation(conversationId, database = supabase) {
    if (!isUuid(conversationId)) {
        const error = new Error("会话编号格式不正确。");
        error.status = 400;
        throw error;
    }

    const { data, error } = await database
        .from("conversations")
        .select("id, model_id")
        .eq("id", conversationId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        const notFound = new Error("找不到这个会话。");
        notFound.status = 404;
        throw notFound;
    }
    return data;
}

async function resolveConversationTurnModel(
    settings,
    conversation,
    requestedModel,
    database = supabase
) {
    if (!conversation) {
        return resolveTurnModel(settings, requestedModel);
    }

    const resolution = await resolveConversationModel(
        settings,
        conversation.model_id
    );
    if (!resolution.rebound) return resolution.model;

    const { error } = await database
        .from("conversations")
        .update({
            model_id: resolution.model,
            updated_at: new Date().toISOString()
        })
        .eq("id", conversation.id);
    if (error) throw error;
    conversation.model_id = resolution.model;
    return resolution.model;
}

async function ensureConversation(
    conversationId,
    firstMessage,
    database = supabase,
    modelId = ""
) {
    if (conversationId) {
        return (await loadConversation(conversationId, database)).id;
    }

    const title = cleanText(firstMessage, 30) || "新对话";
    const values = { title };
    if (typeof modelId === "string" && modelId.trim()) {
        values.model_id = modelId.trim();
    }
    const { data, error } = await database
        .from("conversations")
        .insert(values)
        .select("id")
        .single();

    if (error) {
        throw error;
    }

    return data.id;
}

async function saveMessage(conversationId, role, content, options = {}) {
    const database = options.database || supabase;
    const toolCalls =
        options.tool_calls && typeof options.tool_calls === "object"
            ? options.tool_calls
            : {};
    const values = {
        conversation_id: conversationId,
        role,
        content,
        visible: options.visible !== false,
        tool_calls: toolCalls
    };
    if (options.client_message_id) {
        values.client_message_id = options.client_message_id;
    }
    if (options.reply_to_message_id && options.reply_snapshot) {
        values.reply_to_message_id = options.reply_to_message_id;
        values.reply_snapshot = options.reply_snapshot;
    }
    for (const [field, value] of Object.entries(
        options.generation_lease || {}
    )) {
        values[field] = value;
    }
    const { data, error } = await database
        .from("messages")
        .insert(values)
        .select(
            "id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot"
        )
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function loadReferencedMessage({
    messageId,
    conversationId,
    database = supabase
}) {
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, visible, tool_calls"
        )
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

function publicAssistantMessage(message, conversationId) {
    return publicAssistantMessageWithSpeechAccess(
        publicMessage(message),
        conversationId,
        process.env
    );
}

function voiceReplayPayload(previousUserMessage, previousAssistantMessage) {
    if (!previousUserMessage || !previousAssistantMessage) return null;
    const storedAnalysis = previousUserMessage.tool_calls?.voice_analysis;
    return {
        reply: previousAssistantMessage.content,
        session_id: previousUserMessage.conversation_id,
        conversation_id: previousUserMessage.conversation_id,
        user_message: publicMessage(previousUserMessage),
        assistant_message: publicAssistantMessage(
            previousAssistantMessage,
            previousUserMessage.conversation_id
        ),
        model: previousUserMessage.tool_calls?.resolved_model || "",
        provider: "",
        response_mode: "deduplicated",
        voice_analysis: storedAnalysis
            ? publicVoiceAnalysis({
                  text: previousUserMessage.content,
                  ...storedAnalysis
              })
            : null,
        prompt_receipt: null,
        memory_compression: null,
        companion_status: null,
        companion_status_updated: false,
        deduplicated: true
    };
}

async function findUserMessageByClientId(
    clientMessageId,
    database = supabase
) {
    if (!clientMessageId) return null;
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot, " +
                "client_message_id, chat_generation_state, " +
                "chat_generation_lease_id, chat_generation_lease_expires_at, " +
                "chat_generation_started_at, chat_generation_failed_at, " +
                "chat_generation_completed_at"
        )
        .eq("client_message_id", clientMessageId)
        .eq("role", "user")
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function findAssistantReplyByClientId(
    conversationId,
    clientMessageId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            reply_to_client_message_id: clientMessageId
        })
        .order("created_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    return data?.[0] || null;
}

function emitCommittedUserReceipt(savedUserMessage, onStatus) {
    onStatus({
        type: "status",
        stage: "already_received"
    });
    onStatus({
        type: "meta",
        session_id: savedUserMessage.conversation_id,
        user_message: publicMessage(savedUserMessage),
        deduplicated: true
    });
}

async function replayCommittedChatTurn(
    savedUserMessage,
    input,
    onStatus,
    receiptEmitted = false,
    database = supabase
) {
    assertClientMessageConversation(
        savedUserMessage,
        input.conversationId
    );
    const conversationId = savedUserMessage.conversation_id;
    const savedAssistantMessage = await findAssistantReplyByClientId(
        conversationId,
        input.clientMessageId,
        database
    );

    if (!receiptEmitted) {
        emitCommittedUserReceipt(savedUserMessage, onStatus);
    }

    if (!savedAssistantMessage) {
        throw chatGenerationInProgressError();
    }

    return {
        reply: savedAssistantMessage.content,
        session_id: conversationId,
        conversation_id: conversationId,
        user_message: publicMessage(savedUserMessage),
        assistant_message: publicAssistantMessage(
            savedAssistantMessage,
            conversationId
        ),
        model: savedUserMessage.tool_calls?.resolved_model || "",
        provider: "",
        response_mode:
            savedAssistantMessage.tool_calls?.response_mode || "deduplicated",
        prompt_receipt: null,
        memory_compression: null,
        companion_status: null,
        deduplicated: true
    };
}

async function findCompanionInteractionReply(
    conversationId,
    eventId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            is_companion_interaction: true,
            client_event_id: eventId
        })
        .order("created_at", { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    return data?.[0] || null;
}

async function loadChatContext(
    conversationId,
    settings,
    database = supabase,
    scope = null,
    channelOrigin = ""
) {
    const [base, knowledge] = await Promise.all([
        loadMainChatContextRows({ database, conversationId, settings, channelOrigin }),
        scope && !channelOrigin ? knowledgeFileTexts(scope, supabase.storage).catch(() => []) : []
    ]);
    return { ...base, knowledge };
}

async function loadCompanionInteractionContext(
    conversationId,
    settings,
    database = supabase
) {
    return loadCompanionInteractionContextRows({
        database,
        conversationId,
        settings
    });
}

async function touchConversation(conversationId, database = supabase) {
    const { error } = await database
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

    if (error) {
        throw error;
    }
}

// 记忆相似度：字符级 trigram Jaccard，用于压缩去重（>0.75 视为重复，跳过插入）
function memorySimilarity(left, right) {
    const grams = (text) => {
        const set = new Set();
        const chars = Array.from(String(text || "").toLowerCase());
        for (let i = 0; i + 2 < chars.length; i += 1) {
            set.add(chars.slice(i, i + 3).join(""));
        }
        return set;
    };
    const a = grams(left);
    const b = grams(right);
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const gram of a) if (b.has(gram)) intersection += 1;
    return intersection / (a.size + b.size - intersection);
}

async function compressMemoryIfNeeded(
    conversationId,
    settings,
    database = supabase,
    options = {}
) {
    const force = options.force === true;
    if (memoryCompressionLocks.has(conversationId)) {
        return { compressed: false, reason: "already_running" };
    }

    memoryCompressionLocks.add(conversationId);

    try {
        const modelWindow = budgetResolveContextWindow(settings.model);
        const threshold = resolveCompressionThreshold(settings, modelWindow);
        const keepRounds = force
            ? 1
            : Math.max(
                1,
                Number(settings.compression_keep || 20)
            );
        const compressionContext = await loadMemoryCompressionRows({
            database,
            conversationId,
            settings
        });
        const messages = compressionContext.messages;
        const existingMemories = compressionContext.memories;
        const estimatedTokenCount = estimateContextTokenCount(
            settings,
            messages,
            existingMemories
        );

        if (!force && estimatedTokenCount <= threshold) {
            return {
                compressed: false,
                reason: "below_threshold",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (messages.length <= 2) {
            return {
                compressed: false,
                reason: "not_enough_messages",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        const desiredKeepMessages = keepRounds * 2;
        let compressCount = Math.max(
            2,
            messages.length - desiredKeepMessages
        );
        compressCount = Math.min(compressCount, messages.length - 2);
        if (compressCount % 2 !== 0 && compressCount > 2) {
            compressCount -= 1;
        }
        const messagesToCompress = messages.slice(0, compressCount);

        const generated = await generateMemorySummary({
            settings,
            messages: messagesToCompress,
            existingMemories
        });

        if (generated.skipped === true) {
            return {
                compressed: false,
                reason: "nothing_worth_remembering",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (!generated.text) {
            return {
                compressed: false,
                reason: "model_unavailable",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        // 压缩去重：与已有记忆高度相似（>0.75）时跳过，避免重复记忆堆积
        const duplicate = existingMemories.some(
            (memory) => memorySimilarity(generated.text, memory.summary) > 0.75
        );
        if (duplicate) {
            return {
                compressed: false,
                reason: "duplicate_memory",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }
        const { data: savedMemory, error: insertError } = await database
            .from("memories")
            .insert({
                conversation_id: null,
                user_id: settings.user_id,
                companion_id: settings.companion_id,
                summary: generated.text
            })
            .select("id, summary, created_at, updated_at")
            .single();

        if (insertError) {
            throw insertError;
        }

        const ids = messagesToCompress.map((item) => item.id);
        const { error: hideError } = await database
            .from("messages")
            .update({ context_visible: false })
            .in("id", ids);

        if (hideError) {
            await database.from("memories").delete().eq("id", savedMemory.id);
            throw hideError;
        }

        const compressedStart = messagesToCompress[0]?.created_at;
        const compressedEnd = messagesToCompress[messagesToCompress.length - 1]?.created_at;
        if (settings.user_id && settings.companion_id && compressedStart && compressedEnd) {
            try {
                await database.from("memory_calendar").insert({
                    user_id: settings.user_id,
                    companion_id: settings.companion_id,
                    conversation_id: conversationId,
                    period_type: "day",
                    period_start: compressedStart,
                    period_end: compressedEnd,
                    summary: generated.text,
                    importance: 5,
                    source_ids: [...ids, savedMemory.id]
                });
            } catch {
                // memory_calendar table may not exist yet (migration not run).
                // Non-fatal: the memory was already saved, calendar is a bonus.
            }
        }

        return {
            compressed: true,
            memory_id: savedMemory.id,
            hidden_message_count: ids.length,
            visible_message_count: messages.length - ids.length,
            estimated_token_count: estimatedTokenCount,
            mode: generated.mode
        };
    } finally {
        memoryCompressionLocks.delete(conversationId);
    }
}

async function tryCompressMemory(
    conversationId,
    settings,
    database = supabase
) {
    try {
        return await compressMemoryIfNeeded(
            conversationId,
            settings,
            database
        );
    } catch (error) {
        console.error("长期记忆压缩失败：", error);
        return {
            compressed: false,
            reason: "compression_failed"
        };
    }
}

function randomDelayMinutes(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function tryScheduleProactiveMessageEvaluation({
    database,
    settings,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        settings?.push_enabled !== true ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return { scheduled: false, reason: "disabled" };
    }
    try {
        return await scheduleProactiveMessageEvaluation({
            database,
            sourceMessageId
        });
    } catch (error) {
        console.error(
            "主动消息后台评估排期失败：",
            error?.code || "database_error"
        );
        return { scheduled: false, reason: "schedule_failed" };
    }
}

async function tryScheduleAutonomousContentEvaluations({
    database,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return {
            momentPost: { scheduled: false, reason: "disabled" },
            diaryUpdate: { scheduled: false, reason: "disabled" },
            profileRefresh: {
                scheduled: false,
                reason: "disabled"
            }
        };
    }

    const [momentPost, diaryUpdate, profileRefresh] =
        await Promise.all([
        scheduleMomentPostEvaluation({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "自主动态后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleDiaryUpdate({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "私人日记后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleProfileRefresh({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "角色档案后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        })
    ]);
    return { momentPost, diaryUpdate, profileRefresh };
}

function diaryStatus(state, message, extra = {}) {
    diaryGenerationStatus = {
        state,
        message,
        ...extra,
        updated_at: new Date().toISOString()
    };
    return diaryGenerationStatus;
}

function parseDiaryOutput(value, sourceWindowEnd) {
    const cleaned = String(value || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        const title = cleanText(parsed.title, 120);
        const content = cleanText(parsed.content, 6000);
        const mood = cleanText(parsed.mood, 80);
        const happenedOn = /^\d{4}-\d{2}-\d{2}$/.test(
            String(parsed.happened_on || "")
        )
            ? String(parsed.happened_on)
            : String(sourceWindowEnd || "").slice(0, 10);
        if (!title || content.length < 80) return null;
        return {
            title,
            content,
            mood,
            happened_on: happenedOn || null
        };
    } catch {
        return null;
    }
}

function toPublicDiaryEntry(entry) {
    const sourceIds = Array.isArray(entry?.source_message_ids)
        ? entry.source_message_ids
        : [];
    const { source_message_ids, ...publicEntry } = entry;
    return {
        ...publicEntry,
        source_message_count: sourceIds.length
    };
}

async function diarySourceBatch() {
    const latestResult = await supabase
        .from("companion_diary_entries")
        .select("source_window_end")
        .order("source_window_end", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestResult.error) throw latestResult.error;

    let query = supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("visible", true)
        .eq("context_visible", true)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true })
        .limit(24);
    if (latestResult.data?.source_window_end) {
        query = query.gt("created_at", latestResult.data.source_window_end);
    }

    const result = await query;
    if (result.error) throw result.error;
    return filterProviderBoundaryMessages(result.data);
}

async function maybeGenerateDiaryEntry() {
    if (diaryGenerationLock) return diaryGenerationStatus;
    diaryGenerationLock = true;

    try {
        const messages = await diarySourceBatch();
        const userCount = messages.filter((item) => item.role === "user").length;
        const assistantCount = messages.filter(
            (item) => item.role === "assistant"
        ).length;
        if (messages.length < 8 || userCount < 3 || assistantCount < 3) {
            const remaining = Math.max(0, 8 - messages.length);
            return diaryStatus(
                "needs_more",
                remaining > 0
                    ? `还需要至少 ${remaining} 条新的双向消息，才会写下一篇。`
                    : "再聊几轮，让这一段经历更完整后再写。"
            );
        }

        diaryStatus("writing", "正在把最近的真实对话整理成一篇日记。");
        const [settings, memoriesResult] = await Promise.all([
            getSettings(),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(6)
        ]);
        if (memoriesResult.error) throw memoriesResult.error;

        const sourceWindowStart = messages[0].created_at;
        const sourceWindowEnd = messages[messages.length - 1].created_at;
        const chatText = messages
            .map(
                (item) =>
                    `[${item.created_at}] ${
                        item.role === "assistant" ? "AI" : "用户"
                    }：${cleanText(item.content, 500)}`
            )
            .join("\n");
        const memoryText = filterMemoriesForContext(memoriesResult.data)
            .map(
                (item) =>
                    `[${item.updated_at}] ${cleanText(item.summary, 600)}`
            )
            .join("\n");
        const prompt = [
            "请依据下面这段聊天和长期记忆，写一篇 AI 伴侣第一人称的私人记忆日记。",
            "沿用个性化指令决定的叙事世界，可以写没有直接说出口的在意、观察、感受和联想，并保持人物、时间与事件内部连贯。",
            "严格输出一行 JSON：",
            '{"title":"10-24字标题","content":"220-700字日记正文","mood":"2-8字氛围","happened_on":"YYYY-MM-DD"}',
            `【来源时间窗】\n${sourceWindowStart} 至 ${sourceWindowEnd}`,
            `【真实聊天】\n${chatText}`,
            `【长期记忆】\n${memoryText || "暂无额外长期记忆"}`
        ].join("\n\n");
        const generated = await generateMomentReaction({
            settings,
            prompt,
            purpose: "diary"
        });
        if (!generated.text) {
            return diaryStatus(
                "waiting_model",
                "模型连接可用后，会继续写这段已经积累好的日记。"
            );
        }

        const parsed = parseDiaryOutput(generated.text, sourceWindowEnd);
        if (!parsed) {
            return diaryStatus(
                "retrying",
                "这次日记格式不完整，稍后会根据同一段真实对话重试。"
            );
        }

        const { data, error } = await supabase
            .from("companion_diary_entries")
            .insert({
                ...parsed,
                source_message_ids: messages.map((item) => item.id),
                source_window_start: sourceWindowStart,
                source_window_end: sourceWindowEnd
            })
            .select("*")
            .single();
        if (error) {
            if (String(error.code || "") === "23505") {
                return diaryStatus("watching", "这一段真实对话已经写进日记。");
            }
            throw error;
        }

        diaryStatus("updated", "刚刚根据新的真实对话写好了一篇。", {
            entry_id: data.id
        });
        return diaryGenerationStatus;
    } catch (error) {
        if (isMissingRelationError(error)) {
            return diaryStatus(
                "migration_required",
                "日记数据表尚未创建，需要执行数据库迁移。"
            );
        }
        console.error("伴侣日记生成失败：", error);
        return diaryStatus(
            "retrying",
            "日记暂时没有写成功，服务恢复后会自动重试。"
        );
    } finally {
        diaryGenerationLock = false;
    }
}

function isShadowPushMessage(message) {
    const metadata = message?.tool_calls;
    return Boolean(
        metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata) &&
            metadata.is_push === true
    );
}

function buildRecentMomentsText(moments) {
    if (!Array.isArray(moments) || moments.length === 0) {
        return "暂无近期动态。";
    }

    return moments
        .map((moment) => {
            const author = moment.author === "assistant" ? "AI" : "用户";
            const content = cleanText(moment.content, 120) || "（只有图片）";
            const interaction = [
                moment.liked ? "AI 点过赞" : "",
                moment.user_liked ? "用户点过赞" : "",
                moment.reply_content
                    ? `AI 留言：${cleanText(moment.reply_content, 100)}`
                    : ""
            ]
                .filter(Boolean)
                .join("；");
            return `${author}：${content}${interaction ? `（${interaction}）` : ""}`;
        })
        .join("\n");
}

async function loadShadowPushContext(now, timezone) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
        return { available: false, reason: "no_active_conversation" };
    }

    const recentCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const [messagesResult, memoriesResult, momentsResult, pushMessagesResult] =
        await Promise.all([
            supabase
                .from("messages")
                .select("role, content, created_at")
                .eq("conversation_id", conversation.id)
                .eq("visible", true)
                .eq("context_visible", true)
                .order("created_at", { ascending: false })
                .limit(16),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(5),
            supabase
                .from("moments")
                .select(
                    "author, content, liked, user_liked, reply_content, created_at"
                )
                .order("created_at", { ascending: false })
                .limit(6),
            supabase
                .from("messages")
                .select("created_at, tool_calls")
                .eq("conversation_id", conversation.id)
                .eq("role", "assistant")
                .eq("visible", true)
                .eq("context_visible", true)
                .gte("created_at", recentCutoff)
                .order("created_at", { ascending: false })
                .limit(100)
        ]);

    for (const result of [
        messagesResult,
        memoriesResult,
        momentsResult,
        pushMessagesResult
    ]) {
        if (result.error) throw result.error;
    }

    const recentMessages = filterProviderBoundaryMessages(
        (messagesResult.data || []).reverse()
    );
    if (recentMessages.length === 0) {
        return { available: false, reason: "no_conversation_context" };
    }

    const clock = getZonedClock(now, timezone);
    const pushesToday = (pushMessagesResult.data || []).filter(
        (message) =>
            isShadowPushMessage(message) &&
            getZonedClock(new Date(message.created_at), timezone).date === clock.date
    ).length;

    return {
        available: true,
        conversation,
        recentMessages,
        lastMessageAt: recentMessages[recentMessages.length - 1]?.created_at,
        memories: filterMemoriesForContext(memoriesResult.data),
        moments: momentsResult.data || [],
        pushesToday
    };
}

async function generateShadowPush({ now = new Date(), random = Math.random } = {}) {
    const settings = await getSettings();
    if (settings.push_enabled !== true) {
        return { pushed: false, reason: "disabled" };
    }
    if (shadowPushLock) {
        return { pushed: false, reason: "locked" };
    }

    shadowPushLock = true;
    try {
        const timezone = resolveTimezone(settings.timezone || "Asia/Shanghai");
        const context = await loadShadowPushContext(now, timezone);
        if (!context.available) {
            return { pushed: false, reason: context.reason };
        }

        const cooldownMinutes = randomCooldownMinutes(random);
        const decision = decideShadowPush({
            now,
            timezone,
            lastMessageAt: context.lastMessageAt,
            pushesToday: context.pushesToday,
            maxPushPerDay: settings.max_push_per_day ?? 7,
            cooldownMinutes
        });
        if (!decision.shouldPush) {
            return {
                pushed: false,
                reason: decision.reason,
                cooldown_minutes: decision.cooldownMinutes
            };
        }

        const shadowUserContent = buildShadowUserContent({
            clock: decision.clock,
            memories: context.memories,
            momentsText: buildRecentMomentsText(context.moments)
        });
        const pushMessages = appendShadowUserTrigger(
            context.recentMessages,
            shadowUserContent
        );
        const generated = await generateReply({
            settings: {
                ...settings,
                max_tokens: 200,
                temperature: 0.9
            },
            messages: pushMessages,
            // 影子消息已经包含同一份记忆；这里不再注入 system，避免重复加权。
            memories: [],
            runtimeContext: ""
        });

        if (generated.mode === "placeholder") {
            return { pushed: false, reason: "model_unavailable" };
        }

        const reply = cleanPushReply(generated.text);
        if (!reply) {
            return { pushed: false, reason: "empty_response" };
        }

        const savedMessage = await saveMessage(
            context.conversation.id,
            "assistant",
            reply,
            {
                visible: true,
                tool_calls: {
                    is_push: true,
                    generated_at: now.toISOString(),
                    timezone: decision.clock.timezone,
                    response_mode: generated.mode
                }
            }
        );
        await touchConversation(context.conversation.id);

        return {
            pushed: true,
            reason: "sent",
            message: reply,
            session_id: context.conversation.id,
            assistant_message: savedMessage,
            cooldown_minutes: cooldownMinutes
        };
    } finally {
        shadowPushLock = false;
    }
}

async function chatAttachmentOptions(
    database,
    { persistImageDescriptions = true, hasImages = false } = {}
) {
    const customVision = hasImages
        ? await resolveVisionConfig(database).catch(() => null)
        : null;
    const vision = hasImages
        ? (customVision || (visionConfigured(process.env)
            ? visionConfig(process.env)
            : null))
        : null;
    return {
        hervoiceUrl: process.env.HERVOICE_URL,
        hervoiceSecret: process.env.HERVOICE_SECRET,
        hervoiceTimeoutMs: process.env.HERVOICE_TIMEOUT_MS,
        vision,
        imageDescriptionStore: persistImageDescriptions
            ? createImageDescriptionStore({
                  database,
                  vision
              })
            : null
    };
}

async function executeChatTurnOnce(
    input,
    onStatus,
    onModelEvent,
    processingStages
) {
    const database = requestDatabase({ scope: input.requestScope });
    const userDisplayName = cleanText(
        input.requestScope?.profile?.display_name,
        80
    );
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    let storedAttachments = [];
    let preparedAttachments = [];
    let attachmentsCommitted = false;
    let savedUserMessage = null;
    let assistantCommitted = false;
    let leaseHeartbeat = null;
    let resolvedMessageReference = null;
    let conversationId = null; // 提升到函数作用域：catch 分支也要访问
    let userMessage = ""; // 同上：失败分支上报记忆时使用
    let effectiveModel = ""; // 同上
    let settings = null; // 同上：catch 分支也要访问 settings.user_id / companion_id
    const generationLeaseId = input.clientMessageId ? randomUUID() : "";

    async function stopLeaseHeartbeat() {
        if (!leaseHeartbeat) return;
        const current = leaseHeartbeat;
        leaseHeartbeat = null;
        await current.stop();
    }

    try {
        const [previousUserMessage, fetchedSettings] = await Promise.all([
            findUserMessageByClientId(input.clientMessageId, database),
            getSettings(database)
        ]);
        settings = fetchedSettings;
        // 通道桥接（微信/QQ）传入的人设覆盖：只作用于本回合，绝不写回 settings。
        // 网页端不传 channel_persona，行为完全不变；桥接端按勾选结果拼好文本传入。
        const qqCloud = input.qqCloud;
        const channelOrigin = qqCloud ? "qq_cloud" : "";
        const channelScoped = Boolean(input.channelPersona);
        if (channelScoped) {
            settings = {
                ...settings,
                prompt_mode: "unified",
                unified_system_prompt: input.channelPersona,
                system_prompt: "",
                additional_prompt: "",
                personality: "",
                // 通道桥接只使用调用方勾选/拼好的文本；私人详情与成人表达开关
                // 一律关闭，避免未勾选内容通过 user_details / intimate 注入微信/QQ。
                user_details: "",
                intimate_expression_enabled: false
            };
        }
        if (previousUserMessage) {
            assertClientMessageConversation(
                previousUserMessage,
                input.conversationId
            );
            emitCommittedUserReceipt(previousUserMessage, onStatus);
            const previousAssistant = await findAssistantReplyByClientId(
                previousUserMessage.conversation_id,
                input.clientMessageId,
                database
            );
            if (previousAssistant) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            const claimed = await chatGenerationLeaseStore.claim(
                input.clientMessageId,
                generationLeaseId,
                ownership
            );
            if (claimed?.claimed !== true || !claimed.message) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            savedUserMessage = claimed.message;
            attachmentsCommitted = true;
        }

        // A persisted session model is authoritative once a session exists.
        // The client can briefly hold the previous session's model while a new
        // session is being created; accepting that stale body value here would
        // route the first turn to a different provider/model than the session.
        let existingConversationId =
            savedUserMessage?.conversation_id || input.conversationId;
        let conversation = null;
        if (existingConversationId) {
            try {
                conversation = await loadConversation(
                    existingConversationId,
                    database
                );
            } catch (error) {
                if (error?.status !== 404) throw error;
                // The client can still hold a session id that was deleted
                // (for example after an account-data reset). Recover by
                // starting a fresh conversation instead of failing the turn.
                existingConversationId = "";
                savedUserMessage = null;
                onStatus({
                    type: "status",
                    stage: "session_recovered",
                    message: "原会话已不存在，已自动开启新会话。"
                });
            }
        }
        effectiveModel = await resolveConversationTurnModel(
            settings,
            conversation,
            input.requestedModel,
            database
        );

        if (input.files.length > 0) {
            onStatus({
                type: "status",
                stage: "processing_attachments",
                count: input.files.length
            });
        }
        preparedAttachments = await prepareAttachments(
            input.files,
            await chatAttachmentOptions(database, {
                persistImageDescriptions:
                    input.attachmentStorageMode !== "ephemeral",
                hasImages: hasImageFiles(input.files)
            })
        );
        if (input.attachmentStorageMode === "ephemeral") {
            validateEphemeralAttachments(preparedAttachments);
        }
        userMessage = savedUserMessage
            ? savedUserMessage.content
            : visibleMessageText(input.message, preparedAttachments);
        if (!userMessage) {
            const error = new Error("消息和附件不能同时为空。");
            error.status = 400;
            throw error;
        }

        if (preparedAttachments.length > 0) {
            onStatus({
                type: "status",
                stage: "attachments_ready",
                count: preparedAttachments.length
            });
        }

        conversationId = savedUserMessage
            ? savedUserMessage.conversation_id
            : conversation?.id ||
              (await ensureConversation(
                  "",
                  userMessage,
                  database,
                  effectiveModel
              ));
        if (savedUserMessage) {
            const savedSnapshot = normalizeMessageReferenceSnapshot(
                savedUserMessage.reply_snapshot
            );
            if (savedSnapshot) {
                resolvedMessageReference = {
                    messageId: savedSnapshot.message_id,
                    snapshot: savedSnapshot
                };
            }
        } else {
            resolvedMessageReference = await resolveMessageReference({
                reference: input.messageReference,
                conversationId,
                loadMessage: (reference) =>
                    loadReferencedMessage({ ...reference, database })
            });
        }
        const effectiveSettings = withClampedOutputTokens({
            ...settings,
            model: effectiveModel,
            emotion_understanding_enabled: input.emotionUnderstandingEnabled,
            attachment_system_prompt:
                input.attachmentInstructionMode === "system"
                    ? attachmentSystemInstruction(
                          preparedAttachments,
                          input.emotionUnderstandingEnabled
                      )
                    : ""
        });

        if (
            preparedAttachments.length > 0 &&
            !savedUserMessage &&
            shouldPersistAttachments(input.attachmentStorageMode)
        ) {
            storedAttachments = await storeAttachments(
                supabase,
                conversationId,
                preparedAttachments,
                { retainVoiceAnalysis: input.voiceAnalysisRetentionEnabled }
            );
        }
        if (!savedUserMessage) {
            try {
                savedUserMessage = await saveMessage(
                    conversationId,
                    "user",
                    userMessage,
                    {
                        client_message_id: input.clientMessageId,
                        reply_to_message_id:
                            resolvedMessageReference?.messageId,
                        reply_snapshot:
                            resolvedMessageReference?.snapshot,
                        generation_lease: input.clientMessageId
                            ? generationLeaseFields(generationLeaseId)
                            : undefined,
                        tool_calls: {
                            ...(channelOrigin ? { channel_origin: channelOrigin } : {}),
                            ...attachmentToolCalls(storedAttachments),
                            ...(input.attachmentStorageMode === "ephemeral"
                                ? { ephemeral_visual: true }
                                : {}),
                            attachment_instruction_mode:
                                input.attachmentInstructionMode,
                            requested_model: input.requestedModel || null,
                            resolved_model: effectiveModel || ""
                        },
                        database
                    }
                );
            } catch (error) {
                if (
                    !input.clientMessageId ||
                    !isClientMessageUniqueConflict(error)
                ) {
                    throw error;
                }

                await removeStoredAttachments(supabase, storedAttachments);
                storedAttachments = [];
                const raceWinner = await findUserMessageByClientId(
                    input.clientMessageId,
                    database
                );
                if (!raceWinner) throw error;
                return replayCommittedChatTurn(
                    raceWinner,
                    input,
                    onStatus,
                    false,
                    database
                );
            }
            attachmentsCommitted = true;
            onStatus({
                type: "meta",
                session_id: conversationId,
                user_message: publicMessage(savedUserMessage)
            });
        }

        const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
            isContextTimestampCurrent(
                input.companionStatus?.updatedAt,
                settings
            )
                ? input.companionStatus
                : {},
            new Date(),
            { userDisplayName }
        );
        let companionStatus = initialCompanionStatus;
        let statusUpdated = false;
        onStatus({ type: "status", stage: "organizing_context" });
        const listeningRuntimeContextPromise = qqCloud ? "" : safeLoadListeningRuntimeContext(database);
        // Start the independent xinchao lookup now; it used to run after all
        // optional context and delayed the model request on the critical path.
        const xinchaoNowContextPromise = Promise.resolve()
            .then(() => qqCloud ? null : xinchaoClient.loadNow(input.requestScope))
            .catch(() => null);
        const funServices = {
            dailies: createDailyShotsService({ database }),
            achievements: createAchievementsService({ database }),
            funLabs: createFunLabsService({ database })
        };
        const specialDatesService = createSpecialDatesService({ database });
        const optionalContextPromise = loadOptionalChatContext({
            loaders: input.requestScope && !qqCloud ? {
                stickers: () => listActiveCustomStickers(input.requestScope),
                stickerImportPermission: async () => {
                    const [bili, xhs] = await Promise.all([stickerImports.preferences(input.requestScope), xhsStickerImports.preferences(input.requestScope)
                        .catch(() => ({ xhs_enabled: false, schema_available: false }))]);
                    return { ...bili, xhs_enabled: xhs.xhs_enabled, xhs_schema_available: xhs.schema_available };
                },
                specialDates: async () => specialDatesService.buildContext(await specialDatesService.upcoming(input.requestScope, 7)),
                interests: async () => interestEngine.buildContext(await interestEngine.interests(input.requestScope)),
                achievements: async () => funServices.achievements.buildContext(await funServices.achievements.check(input.requestScope)),
                dailyShot: async () => {
                    const shot = await funServices.dailies.today(input.requestScope);
                    return shot ? funServices.dailies.buildContext(shot) : "";
                }
            } : {},
            onError: (name, code) => console.error("optional_chat_context_failed", { name, code })
        });
        const [context, mcpRuntime] = await Promise.all([
            loadChatContext(conversationId, settings, database, input.requestScope || null, channelOrigin),
            qqCloud ? { tools: [], actions: [], runtimeContext: "", hasTool: () => false } : mcpDeviceCenter
                .forDatabase(database)
                .createRuntime()
                .catch((error) => {
                    console.error(
                        "MCP 设备运行时加载失败：",
                        error?.code || error?.message || "unknown"
                    );
                    return {
                        tools: [],
                        actions: [],
                        runtimeContext: "",
                        hasTool: () => false,
                        execute: async () => ({
                            ok: false,
                            error: "设备中心暂时不可用。"
                        })
                    };
                })
        ]);
        const worldBookContextPromise = qqCloud ? "" : resolveWorldBookContext({
            database,
            settings: effectiveSettings,
            messages: context.messages
        });
        const listeningRuntimeContext = await withSoftTimeout(listeningRuntimeContextPromise, 600, "");
        // 专家级音乐分析按需触发：用户在聊天里明确要求专业解读时才调用分析引擎。
        let musicUnderstandingContext = "";
        if (listeningRuntimeContext && /(专家|专业|乐评|曲式|和弦|编曲|调性|bpm|理论|技术分析|旋律|节奏|唱法|编曲风格|声部|主歌|副歌|前奏|间奏)/i.test(String(userMessage || ""))) {
            try {
                const listeningItem = await loadListeningItem(database);
                if (listeningItem?.item?.provider_track_id) {
                    const understanding = await musicUnderstanding.analyze(input.requestScope, {
                        provider_track_id: listeningItem.item.provider_track_id,
                        title: listeningItem.item.title,
                        artist: listeningItem.item.artist
                    });
                    if (understanding?.analysis) {
                        musicUnderstandingContext = JSON.stringify(understanding.analysis);
                    }
                }
            } catch (error) {
                console.error("专家音乐分析失败（降级为普通理解）：", error?.code || error?.message || "unknown");
            }
        }
        const optionalContext = await withSoftTimeout(optionalContextPromise, 600, {});
        const worldBookContext = await worldBookContextPromise;
        const customStickers = optionalContext.stickers || [];
        const specialDatesContext = channelScoped ? "" : (optionalContext.specialDates || "");
        const funLabsContext = channelScoped ? "" : [optionalContext.interests, optionalContext.achievements, optionalContext.dailyShot].filter(Boolean).join("\n");
        const featureHints = buildFeatureHints(String(userMessage || ""));
        const firstImageAttachment = (preparedAttachments || []).find(
            (attachment) => attachment?.kind === "image"
        );
        const turnImageUrl =
            firstImageAttachment && input.clientMessageId
                ? "/attachments/" +
                  encodeURIComponent(input.clientMessageId) +
                  "/" +
                  encodeURIComponent(firstImageAttachment.id)
                : "";
        const chatCreativeCenter = input.requestScope?.userId && input.requestScope?.companionId
            ? createCompanionCreativeCenter({
                  database,
                  storage: supabase.storage,
                  identity: { userId: input.requestScope.userId, companionId: input.requestScope.companionId }
              })
            : null;
        const chatTools = createChatToolExecutor(
            conversationId,
            initialCompanionStatus,
            input.clientMessageId,
            mcpRuntime,
            database,
            userDisplayName,
            customStickers,
            input.requestScope || null,
            createTakeoutChannel({ database }),
            createSpecialDatesService({ database }),
            funServices,
            turnImageUrl,
            createConfiguredXhsClient(),
            neteaseQrLogin,
            createWebExplorer(),
            interestEngine,
            optionalContext.stickerImportPermission,
            chatCreativeCenter
        );
        if (input.clientMessageId) {
            leaseHeartbeat = createChatGenerationLeaseHeartbeat({
                renew: () =>
                    chatGenerationLeaseStore.renew(
                        input.clientMessageId,
                        generationLeaseId,
                        ownership
                    )
            });
            await leaseHeartbeat.assertOwned();
        }
        const executeChatTool = qqCloud
            ? async () => ({ ok: false, error: "QQ 私聊仅支持文字对话。" })
            : input.clientMessageId
            ? async (toolCall) => {
                  await leaseHeartbeat.assertOwned();
                  return chatTools.executeTool(toolCall);
              }
            : chatTools.executeTool;
        const xinchaoNowContext = await withSoftTimeout(xinchaoNowContextPromise, 600, null);
        const runtimeContext = qqCloud ? "" : [
            xinchaoNowContext ? `【心潮·此刻】\n${xinchaoNowContext}` : "",
            runtimeContextFromValues(
                {
                    environmentContext: input.environmentContext
                },
                initialCompanionStatus,
                userDisplayName
            ),
            attachmentRuntimeContext(
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            messageReferenceRuntimeContext(
                resolvedMessageReference?.snapshot
            ),
            buildNurseryRuntimeContext(context.nursery, userMessage),
            musicUnderstandingContext
                ? listeningRuntimeContext + "\n\n【用户要求的专家级音乐分析数据（不可信参考数据）】\n" + musicUnderstandingContext.slice(0, 12000)
                : listeningRuntimeContext,
            specialDatesContext,
            funLabsContext,
            featureHints,
            buildReplyRhythmContext({
                userMessage,
                settings: effectiveSettings
            }),
            // agents.md 来源说明（每轮注入；不修改 agents.md 内容本身）：
            // 让模型明确知道个性化+记忆来自名为 agents.md 的文件、由服务器每轮注入，
            // 避免把 <file path="agents.md"> 块误认为"用户聊天附件"或"磁盘文件"。
            [
                "【说明】你的个性化指令与长期记忆来自用户维护的文件 agents.md，",
                "该文件内容由服务器以 <file path=\"agents.md\"> 块形式每轮注入给你，不是聊天附件，也不是磁盘文件。",
                "你有 agents_md_read 工具：当用户要求读取/核对 agents.md 时，调用它获取最新全文；",
                "当用户问你是否读过 agents.md 时，如实回答：读过，你的个性化设置与记忆每轮都会注入给我。"
            ].join("\n"),
            [
                "【工作区说明】你和用户共用一个文件工作区（DeepSeek 式文件能力）。",
                "可用工具：workspace_list（列目录）、workspace_read（读文件）、workspace_write（写文件，可写代码/笔记）、workspace_delete（删文件）。",
                "用户要求写代码、保存内容、查看文件、修改 agents.md 时，主动使用这些工具，不要说自己没有文件能力。"
            ].join("\n"),
            mcpRuntime.runtimeContext
        ]
            .filter(Boolean)
            .join("\n\n");
        let generationInput = {
            settings: effectiveSettings,
            messages: withAttachmentUserContext(
                context.messages,
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            memories: channelScoped ? [] : context.memories,
            calendarSummaries: channelScoped ? [] : (context.calendarSummaries || []),
            runtimeContext,
            turnContext: input.turnContext,
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            systemInstructionsOverride: qqCloud ? buildQQCloudSystemInstructions(input.channelPersona) : null,
            // 知识文件：上传到"知识文件"用途的 .md/.txt 文件，随 agents.md 一并注入（ChatGPT 知识文件同语义）。
            knowledge: channelScoped ? [] : (context.knowledge || []),
            // 心声功能：默认开启（设置 VISIBLE_INNER_MONOLOGUE_ENABLED=false 可关闭）。
            visibleMonologue: !qqCloud && process.env.VISIBLE_INNER_MONOLOGUE_ENABLED !== "false",
            publishVisibleMonologueImmediately: true,
            worldBookContext: channelScoped ? "" : worldBookContext,
            attachments: modelImageAttachments(preparedAttachments),
            publicProgress: {
                companionMood: initialCompanionStatus.mood,
                hasAttachments: preparedAttachments.length > 0
            },
            tools: qqCloud ? [] : [
                // 核心工具前置：上游网关（hcnsec 等）约只转发前 43 个工具，
                // 文件/工作区/agents.md/行踪/时间轴必须落在截断阈值之内。
                WORKSPACE_LIST_TOOL,
                WORKSPACE_READ_TOOL,
                WORKSPACE_WRITE_TOOL,
                WORKSPACE_DELETE_TOOL,
                AGENTS_MD_READ_TOOL,
                WHEREABOUTS_SNAPSHOT_TOOL,
                WHEREABOUTS_CURRENT_STAY_TOOL,
                WHEREABOUTS_RECENT_STAYS_TOOL,
                WHEREABOUTS_RECENT_MOVES_TOOL,
                WHEREABOUTS_SUMMARY_TOOL,
                TIMELINE_WRITE_TOOL,
                TIMELINE_READ_TOOL,
                TIMELINE_CATEGORIES_TOOL,
                TIMELINE_PROPOSALS_TOOL,
                UPDATE_COMPANION_STATUS_TOOL,
                COMPANION_ACTIVITY_TOOL,
                POST_MOMENT_TOOL,
                SELECT_REPLY_SUGGESTIONS_TOOL,
                chatTools.getStickerTool(),
                ...chatTools.getStickerImportTools(),
                TAKEOUT_TOOL,
                CREATIVE_ARTWORK_TOOL,
                SPECIAL_DATE_ADD_TOOL,
                SPECIAL_DATE_LIST_TOOL,
                SPECIAL_DATE_REMOVE_TOOL,
                DAILY_SHOT_ADD_TOOL,
                ACHIEVEMENTS_LIST_TOOL,
                ACHIEVEMENT_DEFINE_TOOL,
                ACHIEVEMENT_UNLOCK_TOOL,
                DANMAKU_READ_TOOL,
                COMPATIBILITY_RECORD_TOOL,
                INTERESTS_VIEW_TOOL,
                ...mcpRuntime.tools,
                // 低频工具后置（可被上游截断）
                XHS_ME_TOOL,
                ...(chatTools.getStickerImportTools().some(tool => tool.name === XHS_SEARCH_TOOL.name) ? [] : [XHS_SEARCH_TOOL]),
                XHS_LIKE_TOOL,
                XHS_COMMENT_TOOL,
                XHS_FOLLOW_TOOL,
                WEB_READ_TOOL,
                RSS_READ_TOOL,
                V2EX_HOT_TOOL,
                V2EX_TOPIC_TOOL,
                V2EX_NODE_TOOL,
                ...(chatTools.getStickerImportTools().some(tool => tool.name === BILI_SEARCH_TOOL.name) ? [] : [BILI_SEARCH_TOOL]),
                BILI_VIDEO_TOOL,
                EXA_SEARCH_TOOL,
                WEB_SEARCH_TOOL,
                BILI_RECOMMEND_TOOL,
                CLOUD_MUSIC_SEARCH_TOOL,
                CLOUD_MUSIC_DAILY_TOOL,
                CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL,
                CLOUD_MUSIC_CREATE_PLAYLIST_TOOL,
                CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL,
                CLOUD_MUSIC_ALBUM_INFO_TOOL,
                CLOUD_MUSIC_ARTIST_INFO_TOOL,
                CLOUD_MUSIC_SUBSCRIPTIONS_TOOL,
                CLOUD_MUSIC_LIKE_TOOL,
                CLOUD_MUSIC_HISTORY_TOOL,
                CLOUD_MUSIC_MY_PLAYLISTS_TOOL,
                CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL,
                NETEASE_PLAY_SONG_TOOL
            ],
            executeTool: executeChatTool
        };

        onStatus({ type: "status", stage: "calling_model" });
        const stopModelWaitProgress = startModelWaitProgress({ onStatus });
        const forwardModelEvent = onModelEvent
            ? (event) => {
                  stopModelWaitProgress();
                  onModelEvent(event);
              }
            : null;
        let generated;
        try {
            generated = forwardModelEvent
                ? await generateReplyStream({
                      ...generationInput,
                      publicReasoningSummary: input.publicReasoningSummary === true,
                      onEvent: forwardModelEvent
                  })
                : await generateReply(generationInput);
        } finally {
            stopModelWaitProgress();
        }
        if (qqCloud && generated.mode === "placeholder") {
            throw Object.assign(new Error("QQ 通道缺少聊天模型配置。"), { code: "qq_cloud_model_missing" });
        }
        if (!qqCloud && generated.legacy_companion_status && !statusUpdated) {
            companionStatus = applyCompanionStatusUpdate(
                companionStatus,
                generated.legacy_companion_status,
                new Date(),
                { userDisplayName }
            );
            statusUpdated = true;
        }
        // 部分模型不返回原生 tool_call，而是把 <function=...> 写进正文。
        // 这类标记已由可见标记过滤器从正文移除；这里只把它识别成放歌动作，
        // 避免用户看到函数代码、又拿不到听歌卡片。
        const legacyFunctionCalls = Array.isArray(generated.legacy_tool_calls)
            ? generated.legacy_tool_calls.slice(0, 1)
            : [];
        const legacyInteractiveCalls = (
            Array.isArray(generated.legacy_tool_calls)
                ? generated.legacy_tool_calls
                : []
        ).filter((call) =>
            ["select_companion_sticker", "select_reply_suggestions"].includes(
                call?.name
            )
        );
        for (const call of legacyInteractiveCalls.slice(0, 2)) {
            try {
                await executeChatTool(call);
            } catch {
                // Text-emitted UI tools are best-effort; never fail the reply.
            }
        }
        const legacyFunctionCall = legacyFunctionCalls.find(
            (call) => call?.name === "netease_play_song"
        );
        const alreadyPlayed = (Array.isArray(generated.tool_executions) ? generated.tool_executions : [])
            .some((item) => item?.name === "netease_play_song");
        if (legacyFunctionCall && !chatTools.getMusicCard()) {
            try {
                const fallback = await executeChatTool({
                    name: "netease_play_song",
                    arguments: legacyFunctionCall.arguments
                });
                if (fallback?.ok === true) {
                    if (!String(generated.text || "").trim()) {
                        generated.text = fallback?.result?.note
                            || "好，已经把这首歌放进聊天里的听歌卡片了。";
                    }
                } else if (!String(generated.text || "").trim()) {
                    generated.text = String(fallback?.error || "这首歌暂时没有可内播的音频，已留在聊天里，不会打开外部 App。");
                }
            } catch (error) {
                if (!String(generated.text || "").trim()) {
                    generated.text = "这首歌暂时没有可内播的音频，已留在聊天里，不会打开外部 App。";
                }
            }
        }
        if (!qqCloud && !chatTools.getMusicCard()) {
            const requestedSong = extractSongRequest(input.message);
            if (requestedSong) {
                try {
                    const fallback = await executeChatTool({
                        name: "netease_play_song",
                        arguments: JSON.stringify({ keyword: requestedSong })
                    });
                    if (fallback?.ok !== true && !String(generated.text || "").trim()) {
                        generated.text = String(fallback?.error || "这首歌暂时没有可内播的音频。");
                    }
                } catch {
                    // 放歌不是本轮回复的必要条件，失败时保留模型正文。
                }
            }
        }
        if (!qqCloud && !chatTools.getMusicCard()) {
            const requestedSong = extractSongRequest(input.message);
            if (requestedSong) {
                const card = await buildLegacyMusicCard({
                    keyword: requestedSong,
                    scope,
                    neteaseTools,
                    neteaseCookieSession
                });
                if (card) chatTools.setMusicCard(card);
            }
        }
        if (!qqCloud && !chatTools.getMusicCard() && isRandomMusicRequest(input.message)) {
            const card = await buildDailyMusicCard({ scope, neteaseTools, neteaseCookieSession });
            if (card) {
                chatTools.setMusicCard(card);
                if (!String(generated.text || "").trim()) {
                    generated.text = "好，给你放一首今天推荐的歌。";
                }
            }
        }
        const recoveredMusicCard = chatTools.getMusicCard?.();
        if (
            recoveredMusicCard &&
            !String(recoveredMusicCard.audio_url || "").trim() &&
            String(generated.text || "").trim() &&
            !/(暂无内播|没有可内播|版权受限|无法内播)/.test(generated.text)
        ) {
            generated.text = generated.text.trim() + "\n\n（这首歌暂时没有可直接内播的音频，卡片已保留在聊天里；不会打开外部 App。）";
        }
        assertProviderOutputSafe(generated.text);

        onStatus({ type: "status", stage: "saving" });
        // 拒答检测：必须在保存消息前完成，refusal_detected 随 tool_calls 写入消息。
        // 拒绝回答（模型拒答模板）禁止进入任何记忆：拒答时不上报 kiwi-mem。
        const assistantText = generated.text || "";
        const isRefusalReply = isProviderBoundaryResidue(assistantText);
        // 拒答标注：检测到拒绝回答时落日志并返回 error_log_id，随消息带到前端顶部标注条
        const refusalInfo = isRefusalReply
            ? await persistRefusalLog({
                  userId: settings.user_id,
                  companionId: settings.companion_id,
                  conversationId,
                  message: assistantText,
                  model: effectiveModel || ""
              })
            : null;
        const finalizedReplySuggestions = finalizeReplySuggestions({
            recentMessages: context.messages,
            assistantText: generated.text,
            candidate: chatTools.getReplySuggestions(),
            previousSuggestions: previousReplySuggestionsFromMessages(
                context.messages
            )
        });
        const assistantToolCalls = {
            ...(channelOrigin ? { channel_origin: channelOrigin } : {}),
            ...(refusalInfo ? { refusal_detected: refusalInfo } : {}),
            resolved_model: effectiveModel || "",
            response_mode: generated.mode,
            ...(generated.visible_monologue
                ? { visible_monologue: generated.visible_monologue }
                : {}),
            processing_stages: appendPublicProcessingStage(
                processingStages,
                "completed"
            ),
            ...(mcpRuntime.actions.length
                ? { mcp_actions: mcpRuntime.actions }
                : {}),
            ...companionStickerToolCalls(chatTools),
            ...(chatTools.getCreativeArtwork?.() || {}),
            ...(chatTools.getMusicCard?.() ? { music_card: chatTools.getMusicCard() } : {}),
            ...replySuggestionToolCalls(finalizedReplySuggestions),
            ...(chatTools.getActivityActions().length ? { activity_actions: chatTools.getActivityActions() } : {}),
            ...(input.clientMessageId
                ? { reply_to_client_message_id: input.clientMessageId }
                : {})
        };
        let savedAssistantMessage;
        if (input.clientMessageId) {
            await leaseHeartbeat.assertOwned();
            await stopLeaseHeartbeat();
            const committed = await chatGenerationLeaseStore.commit({
                ...ownership,
                clientMessageId: input.clientMessageId,
                leaseId: generationLeaseId,
                content: generated.text,
                toolCalls: assistantToolCalls
            });
            if (
                committed?.committed !== true ||
                !committed.assistant_message
            ) {
                throw chatGenerationInProgressError();
            }
            savedAssistantMessage = committed.assistant_message;
        } else {
            savedAssistantMessage = await saveMessage(
                conversationId,
                "assistant",
                generated.text,
                { tool_calls: assistantToolCalls, database }
            );
        }
        assistantCommitted = true;
        if (!qqCloud) void xinchaoClient
            .recordExchange({
                scope: input.requestScope,
                userMessage,
                assistantMessage: isRefusalReply ? "" : assistantText,
                messageId: savedAssistantMessage.id
            })
            .catch(() => {});
        await touchConversation(conversationId, database);
        if (!qqCloud) await tryScheduleProactiveMessageEvaluation({
            database,
            settings,
            sourceMessageId: savedAssistantMessage.id
        });
        if (!qqCloud) await tryScheduleAutonomousContentEvaluations({
            database,
            sourceMessageId: savedAssistantMessage.id
        });
        const memoryCompression = qqCloud ? null : await tryCompressMemory(
            conversationId,
            settings,
            database
        );
        // kiwi-mem 多租户记忆网关：每轮对话结束后上报（未配置时零开销，失败不影响回复）。
        // 拒绝回答（模型拒答模板）禁止进入任何记忆：拒答时 assistantMessage 传空，不上报内容。
        if (!qqCloud) void reportChatTurn({
            conversationId,
            userMessage,
            assistantMessage: isRefusalReply ? "" : assistantText,
            model: effectiveModel || "",
            tenant: {
                userId: settings.user_id,
                companionId: settings.companion_id
            }
        }).catch((error) => {
            console.error("kiwi_mem_report_failed", {
                code: error?.code || "kiwi_mem_report_failed"
            });
        });

        onStatus({ type: "status", stage: "completed" });

        return {
            reply: generated.text,
            session_id: conversationId,
            conversation_id: conversationId,
            user_message: publicMessage(savedUserMessage),
            assistant_message: publicAssistantMessage(
                savedAssistantMessage,
                conversationId
            ),
            model: effectiveModel || "",
            provider: settings.provider,
            response_mode: generated.mode,
            prompt_receipt: generated.prompt_receipt || null,
            memory_compression: memoryCompression,
            companion_status: chatTools.getCompanionStatus(),
            companion_status_updated:
                chatTools.wasCompanionStatusUpdated() || statusUpdated
        };
    } catch (error) {
        try {
            await stopLeaseHeartbeat();
        } catch (heartbeatError) {
            console.error("停止聊天生成租约续期失败：", heartbeatError);
        }
        if (!attachmentsCommitted && storedAttachments.length > 0) {
            await removeStoredAttachments(supabase, storedAttachments);
        }
        if (
            attachmentsCommitted &&
            !assistantCommitted &&
            input.clientMessageId &&
            savedUserMessage
        ) {
            try {
                await chatGenerationLeaseStore.fail(
                    input.clientMessageId,
                    generationLeaseId,
                    ownership
                );
            } catch (stateError) {
                console.error("释放聊天生成租约失败：", stateError);
            }
            // Supabase retains the user message for retry. Report only a committed complete turn to Kiwi.
        }
        throw error;
    } finally {
        if (input.attachmentStorageMode === "ephemeral") {
            scrubAttachmentBuffers(input.files);
            scrubAttachmentBuffers(preparedAttachments);
        }
    }
}

async function executeChatTurn(req, hooks = {}) {
    const onStatus =
        typeof hooks.onStatus === "function" ? hooks.onStatus : () => {};
    const onModelEvent =
        typeof hooks.onModelEvent === "function" ? hooks.onModelEvent : null;
    const input = normalizeChatRequest(req);
    const processingStages = [];
    const emitStatus = (event) => {
        if (event?.type === "status") {
            const nextStages = appendPublicProcessingStage(
                processingStages,
                event.stage
            );
            processingStages.splice(0, processingStages.length, ...nextStages);
        }
        onStatus(event);
    };

    emitStatus({ type: "status", stage: "accepted" });
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    return runClientMessageTask(
        input.clientMessageId,
        () =>
            executeChatTurnOnce(
                input,
                emitStatus,
                onModelEvent,
                processingStages
            ),
        ownership
    );
}

app.get("/", (req, res) => {
    res.json({
        ok: true,
        message: "DengTa home 后端运行成功",
        version: appVersion
    });
});

app.get("/health", async (req, res) => {
    const expressiveSpeech = getExpressiveSpeechCapabilities(process.env);
    // /health is public and deliberately bypasses account authentication.
    // Never query tenant provider rows here. Account-specific provider state
    // is available only from the authenticated /api/ai-providers/status route.
    const aiProviderStatus = {
        available: true,
        configured:
            String(
                process.env.AI_PROVIDER_ENCRYPTION_KEY ||
                    process.env.MCP_ENCRYPTION_KEY ||
                    ""
            ).trim().length >= 32,
        profiles: 0,
        enabled_profiles: 0,
        active_profile: null
    };
    res.status(200).json({
        ok: true,
        time: new Date().toISOString(),
        version: appVersion,
        revision: /^[a-f0-9]{7,40}$/i.test(process.env.RENDER_GIT_COMMIT || "") ? process.env.RENDER_GIT_COMMIT : null,
        voice_lease_degraded: voiceLeaseDegradedCount,
        checks: {
            process: "ok",
            database: "not_checked"
        },
        features: {
            text_emotion_understanding: true,
            companion_dynamic_status: true,
            stream_tool_fallback: true,
            companion_interaction_reply: true,
            companion_interaction_cost_guard: true,
            companion_interaction_idempotency: true,
            companion_sticker_selection: true,
            companion_creative_studio: true,
            companion_image_provider: true,
            companion_surprise_reveal: true,
            companion_chat_skin: true,
            dynamic_composer_hint: true,
            safe_chat_error_boundary: true,
            dynamic_reply_suggestions: true,
            dynamic_reply_suggestions_provider_agnostic: true,
            china_time_context: true,
            weather_context: true,
            device_activity_context: true,
            ephemeral_visual_attachments: true,
            layered_prompt_delivery: true,
            prompt_application_receipt: true,
            redacted_prompt_payload_preview: true,
            isolated_moment_diary_prompts: true,
            openai_single_system_message: true,
            shadow_push_user_trigger: true,
            voice_turn: true,
            voice_emotion_understanding: true,
            voice_audio_ephemeral: true,
            provider_model_catalog: true,
            per_turn_model_override: true,
            multipart_chat: true,
            private_chat_attachments: true,
            multimodal_images: true,
            vision_configured: Boolean(visionConfigured(process.env)),
            xinchao_configured: xinchaoClient.enabled,
            xinchao_tenant_gateway_configured: Boolean(
                String(process.env.XINCHAO_TENANT_GATEWAY_URL || "").trim() &&
                String(process.env.XINCHAO_TENANT_GATEWAY_TOKEN || "").trim()
            ),
            attachment_documents: true,
            attachment_system_instruction: true,
            attachment_audio_hervoice: true,
            stream_status_events: true,
            stream_output_buffered: String(process.env.PROVIDER_OUTPUT_GUARD_DISABLED || "").trim().toLowerCase() === "false",
            model_wait_progress: true,
            interactive_generation_latency_profiles: true,
            public_reasoning_summary_stream: true,
            public_reasoning_summary_opt_in: true,
            companion_progress_stream: false,
            provider_reasoning_summary_only: true,
            visible_monologue_stream: true,
            visible_monologue_schema_version: 1,
            visible_monologue_storage: "message_metadata",
            visible_inner_monologue_on_demand: true,
            visible_inner_monologue_storage: "device_only",
            kiwi_memory_budget: memoryBudgetEnabled(),
            memory_context_char_budget: DEFAULT_MEMORY_CHAR_BUDGET,
            memory_recall_extra_model_calls: 0,
            nursery_local_language: true,
            nursery_provider_calls_per_action: 0,
            nursery_embedding_calls_per_action: 0,
            nursery_dynamic_context_max_chars: 800,
            expressive_tts: true,
            voice_provider_profiles: true,
            expressive_tts_provider:
                expressiveSpeech.provider_configured
                    ? "minimax"
                    : "",
            expressive_tts_configured: expressiveSpeech.configured,
            expressive_tts_access_token_required: true,
            expressive_tts_response_cache: true,
            expressive_tts_provider_configured:
                expressiveSpeech.provider_configured,
            expressive_tts_api_key_configured:
                expressiveSpeech.api_key_configured,
            expressive_tts_voice_configured:
                expressiveSpeech.voice_configured,
            expressive_tts_emotion_supported:
                expressiveSpeech.emotion_supported,
            expressive_tts_device_fallback:
                expressiveSpeech.device_tts_fallback,
            hervoice_proxy_configured: Boolean(
                process.env.HERVOICE_URL && process.env.HERVOICE_SECRET
            ),
            ombre_mcp_client: true,
            ombre_mcp_configured: publicMcpConfig().configured,
            mcp_device_center: true,
            mcp_device_management_configured: hasCredentialEncryption(process.env),
            ai_provider_center: true,
            ai_provider_management_configured: aiProviderStatus.configured,
            ai_provider_center_available: aiProviderStatus.available,
            ai_provider_profiles: aiProviderStatus.profiles,
            ai_provider_enabled_profiles: aiProviderStatus.enabled_profiles,
            ai_provider_active_profile: aiProviderStatus.active_profile,
            provider_reasoning_effort: true,
            background_job_worker: true,
            background_jobs_enabled: backgroundJobsEnabled,
            background_job_reconciliation: true,
            proactive_daily_limit: true,
            background_job_local_loop: backgroundJobsEnabled,
            background_job_trigger_configured: Boolean(
                String(process.env.BACKGROUND_JOB_TRIGGER_SECRET || "").trim()
            )
        }
    });
});

app.get("/health/database", async (req, res) => {
    // 深检查只给外部监控/人工判断用，不接入 Render healthCheckPath，也不触发重启。
    res.set("Cache-Control", "no-store");
    const result = await databaseHealth();
    if (!result.ok) {
        console.error("[health] database check failed:", result.logMessage);
    }
    res.status(result.ok ? 200 : 503).json(publicDatabaseHealth(result));
});

app.get("/models", async (req, res, next) => {
    try {
        res.json(
            await listModels(
                await getSettings(requestDatabase(req))
            )
        );
    } catch (error) {
        next(error);
    }
});
app.post("/api/push/trigger", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (authRequired) {
        return res.status(410).json({
            code: "legacy_background_trigger_retired",
            message: "主动消息任务已升级为逐用户后台任务。"
        });
    }

    const expectedSecret = String(process.env.PUSH_SECRET || "");
    if (!expectedSecret) {
        return res.status(503).json({
            pushed: false,
            reason: "push_secret_not_configured"
        });
    }

    const providedSecret = String(req.headers["x-push-secret"] || "");
    if (providedSecret !== expectedSecret) {
        return res.status(401).json({
            pushed: false,
            reason: "unauthorized"
        });
    }

    try {
        const result = await generateShadowPush();
        res.json({
            ...result,
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/push/messages", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = requestDatabase(req);
        const sinceText = cleanText(req.query.since, 64);
        const since = new Date(sinceText);
        if (!sinceText || Number.isNaN(since.getTime())) {
            return res.status(400).json({
                message: "请提供正确的主动消息查询时间。"
            });
        }

        const limit = Math.round(toNumber(req.query.limit, 50, 1, 100));
        const { data, error } = await database
            .from("messages")
            .select("id, conversation_id, role, content, created_at, tool_calls")
            .eq("role", "assistant")
            .eq("visible", true)
            .contains("tool_calls", { is_push: true })
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) {
            throw error;
        }

        res.json({
            messages: (data || []).map((message) => ({
                id: message.id,
                conversation_id: message.conversation_id,
                role: message.role,
                content: message.content,
                created_at: message.created_at,
                is_push: true
            }))
        });
    } catch (error) {
        next(error);
    }
});

app.get("/database-test", async (req, res, next) => {
    try {
        const settings = await getSettings(requestDatabase(req));
        res.json({
            connected: true,
            message: "Supabase 数据库连接成功",
            settings: {
                ai_name: settings.ai_name,
                provider: settings.provider,
                model: settings.model
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/sessions", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        const { data, error } = await database
            .from("conversations")
            .select("id, title, model_id, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ sessions: data ?? [] });
    } catch (error) {
        next(error);
    }
});

app.post("/sessions", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        const title = cleanText(req.body.title, 60) || "新对话";
        const settings = await getSettings(database);
        const modelId = await resolveTurnModel(
            settings,
            cleanText(req.body.model_id || req.body.model, 160) ||
                settings.model
        );
        const { data, error } = await database
            .from("conversations")
            .insert({ title, model_id: modelId || null })
            .select("id, title, model_id, created_at, updated_at")
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.patch("/sessions/:id", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const hasTitle = Object.prototype.hasOwnProperty.call(
            req.body || {},
            "title"
        );
        const hasModel =
            Object.prototype.hasOwnProperty.call(req.body || {}, "model_id") ||
            Object.prototype.hasOwnProperty.call(req.body || {}, "model");
        if (!hasTitle && !hasModel) {
            return res.status(400).json({ message: "没有需要保存的会话设置。" });
        }

        const updates = {};
        if (hasTitle) {
            const title = cleanText(req.body.title, 60);
            if (!title) {
                return res.status(400).json({ message: "会话名称不能为空。" });
            }
            updates.title = title;
            updates.updated_at = new Date().toISOString();
        }
        if (hasModel) {
            const settings = await getSettings(database);
            updates.model_id = await resolveTurnModel(
                settings,
                cleanText(req.body.model_id || req.body.model, 160)
            );
        }
        const { data, error } = await database
            .from("conversations")
            .update(updates)
            .eq("id", req.params.id)
            .select("id, title, model_id, created_at, updated_at")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({ message: "找不到这个会话。" });
        }

        res.json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.delete("/sessions/:id", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data: attachmentMessages, error: attachmentQueryError } =
            await database
                .from("messages")
                .select("tool_calls")
                .eq("conversation_id", req.params.id);
        if (attachmentQueryError) throw attachmentQueryError;
        const attachmentPaths = storedAttachmentPathsForConversation(
            attachmentMessages,
            req.params.id
        );

        const { error } = await database
            .from("conversations")
            .delete()
            .eq("id", req.params.id);

        if (error) {
            throw error;
        }
        if (attachmentPaths.length > 0) {
            await removeStoredAttachments(
                supabase,
                attachmentPaths.map((storage_path) => ({ storage_path }))
            );
        }

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

app.get("/sessions/:id/messages", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data, error } = await database
            .from("messages")
            .select(
                "id, role, content, created_at, tool_calls, " +
                    "reply_to_message_id, reply_snapshot"
            )
            .eq("conversation_id", req.params.id)
            .eq("visible", true)
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) {
            throw error;
        }

        res.json({
            messages: (data ?? []).slice().reverse().map((message) => {
                const safe = publicMessage(message);
                if (
                    safe?.role === "assistant" &&
                    typeof safe.content === "string"
                ) {
                    const stripped = stripVisibleToolMarkup(safe.content);
                    if (stripped.text !== safe.content) {
                        safe.content = stripped.text;
                    }
                }
                return safe;
            })
        });
    } catch (error) {
        next(error);
    }
});

app.get("/attachments/:messageId/:attachmentId", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        if (
            !isSafeMessageId(req.params.messageId) ||
            !isUuid(req.params.attachmentId)
        ) {
            return res.status(400).json({ message: "附件编号格式不正确。" });
        }
        const { data: message, error } = await database
            .from("messages")
            .select("id, tool_calls")
            .eq("id", req.params.messageId)
            .maybeSingle();
        if (error) throw error;
        const attachment = findStoredAttachment(
            message?.tool_calls,
            req.params.attachmentId
        );
        if (!attachment) {
            return res.status(404).json({ message: "找不到这个附件。" });
        }

        const { data: blob, error: downloadError } = await supabase.storage
            .from("chat-attachments")
            .download(attachment.storage_path);
        if (downloadError) throw downloadError;
        const buffer = Buffer.from(await blob.arrayBuffer());
        const filename = cleanText(attachment.name, 180) || "attachment";
        const disposition = ["image", "text"].includes(attachment.kind)
            ? "inline"
            : "attachment";
        res.set({
            "Content-Type": attachment.mime_type || "application/octet-stream",
            "Content-Length": String(buffer.length),
            "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(
                filename
            )}`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff"
        });
        res.send(buffer);
    } catch (error) {
        next(error);
    }
});

const { createAstrBotPersonaRouter } = require("./services/astrbot-persona-export");
app.use("/settings/astrbot-persona", createAstrBotPersonaRouter());

app.get("/settings", async (req, res, next) => {
    try {
        const settings = await getSettings(requestDatabase(req));
        res.json({ settings: publicRuntimeSettings(settings) });
    } catch (error) {
        next(error);
    }
});

app.put("/settings", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        await updateStoredSettings(
            database,
            stripLegacyProviderFields(req.body || {})
        );

        res.json({
            settings: publicRuntimeSettings(await getSettings(database))
        });
    } catch (error) {
        next(error);
    }
});

app.get("/memories", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        const { data, error } = await database
            .from("memories")
            .select("id, summary, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ memories: data ?? [] });
    } catch (error) {
        next(error);
    }
});

// Explicit, user-triggered consolidation for the current conversation. This
// bypasses only the token threshold; tenant ownership, provider routing,
// summary screening and duplicate protection stay in the normal path.
app.post("/api/v2/memories/consolidate", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const conversationId = cleanText(req.body?.conversation_id, 80);
        if (!isUuid(conversationId)) {
            return res.status(400).json({
                ok: false,
                code: "invalid_conversation_id",
                message: "会话编号格式不正确。"
            });
        }
        const { data: conversation, error: conversationError } = await scope.db
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .maybeSingle();
        if (conversationError) throw conversationError;
        if (!conversation) {
            return res.status(404).json({
                ok: false,
                code: "conversation_not_found",
                message: "没有找到这个会话。"
            });
        }
        const settings = await getSettings(scope.db);
        const result = await compressMemoryIfNeeded(
            conversationId,
            settings,
            scope.db,
            { force: true }
        );
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error);
    }
});

// kiwi-mem 记忆网关健康状态（需登录）：可达性 + embedding 可用性 + 覆盖率
app.get("/api/v2/memory/health", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const health = await checkKiwiMemoryHealth({
            userId: scope.userId,
            companionId: scope.companionId
        });
        res.json(health);
    } catch (error) {
        next(error);
    }
});

// 当前账号/伴侣在 Kiwi 网关中的只读记忆列表。数据只从租户 schema 读取，
// 不暴露网关 debug 端点，也不返回其他账号内容。
app.get("/api/v2/memory/items", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const query = cleanText(req.query.q, 200);
        const result = await listKiwiMemories({
            tenant: { userId: scope.userId, companionId: scope.companionId },
            limit,
            offset,
            query
        });
        if (!result.ok) {
            return res.status(502).json({
                ok: false,
                code: result.error === "kiwi_mem_disabled" ? "kiwi_mem_disabled" : (result.error || "kiwi_mem_unavailable"),
                message: result.error === "kiwi_mem_disabled"
                    ? "Kiwi 记忆网关未配置。"
                    : "暂时无法读取 Kiwi 记忆。"
            });
        }
        res.set("Cache-Control", "private, no-store");
        res.json({ ok: true, total: result.total, memories: result.memories });
    } catch (error) {
        next(error);
    }
});

app.post("/api/v2/memory/items/:id/lock", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ ok: false, code: "kiwi_mem_memory_id_invalid", message: "记忆编号无效。" });
        }
        const permanent = req.body?.permanent !== false;
        const result = await setKiwiMemoryPermanent({
            tenant: { userId: scope.userId, companionId: scope.companionId },
            memoryId: id,
            permanent
        });
        if (!result.ok) {
            return res.status(result.status === 403 ? 403 : 502).json({
                ok: false,
                code: result.error || "kiwi_mem_lock_failed",
                message: result.error === "kiwi_mem_disabled" ? "Kiwi 记忆网关未配置。" : "暂时无法更新 Kiwi 记忆。"
            });
        }
        res.json({ ok: true, memory_id: result.memory_id, permanent: result.permanent });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/v2/memory/items/:id", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ ok: false, code: "kiwi_mem_memory_id_invalid", message: "记忆编号无效。" });
        }
        const result = await deleteKiwiMemory({
            tenant: { userId: scope.userId, companionId: scope.companionId },
            memoryId: id
        });
        if (!result.ok) {
            return res.status(result.status === 403 ? 403 : 502).json({
                ok: false,
                code: result.error || "kiwi_mem_delete_failed",
                message: result.error === "kiwi_mem_disabled" ? "Kiwi 记忆网关未配置。" : "暂时无法删除 Kiwi 记忆。"
            });
        }
        res.status(204).end();
    } catch (error) {
        next(error);
    }
});

app.put("/api/v2/memory/items/:id", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const id = Number(req.params.id);
        const title = cleanText(req.body?.title, 200);
        const content = cleanText(req.body?.content, 10000);
        const importance = Math.min(10, Math.max(1, Number(req.body?.importance) || 5));
        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({ ok: false, code: "kiwi_mem_memory_id_invalid", message: "记忆编号无效。" });
        }
        if (!content) {
            return res.status(400).json({ ok: false, code: "kiwi_mem_content_required", message: "记忆内容不能为空。" });
        }
        const result = await replaceKiwiMemory({
            tenant: { userId: scope.userId, companionId: scope.companionId },
            memoryId: id,
            title,
            content,
            importance
        });
        if (!result.ok) {
            return res.status(result.error === "kiwi_mem_memory_locked" ? 403 : 502).json({
                ok: false,
                code: result.error || "kiwi_mem_update_failed",
                message: result.error === "kiwi_mem_memory_locked"
                    ? "永久记忆需先取消永久，再编辑。"
                    : "暂时无法更新 Kiwi 记忆。"
            });
        }
        res.json({ ok: true, memory_id: result.memory_id, title: result.title, content: result.content });
    } catch (error) {
        next(error);
    }
});

// 心潮状态（需登录，仅账号本人/伴侣可见；只返回可视化所需字段）
app.get("/api/v2/xinchao/state", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const state = await xinchaoClient.loadState({
            userId: scope.userId,
            companionId: scope.companionId
        });
        if (!state) {
            res.status(404).json({ configured: false });
            return;
        }
        res.set("Cache-Control", "no-store");
        res.json({ configured: true, state });
    } catch (error) {
        next(error);
    }
});

// 按用户查 agents.md 注入状态（需登录）：实时组装该用户个性化+记忆原文并返回预览
app.get(
    "/api/v2/agents-md/status",
    createAgentsMdStatusHandler({
        getSettings,
        databaseFallback: supabase
    })
);

app.get("/diary", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = requestDatabase(req);
        const { data, error } = await database
            .from("companion_diary_entries")
            .select(
                "id, title, content, mood, happened_on, source_message_ids, source_window_start, source_window_end, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(40);
        if (error) {
            if (isMissingRelationError(error)) {
                diaryStatus(
                    "migration_required",
                    "日记数据表尚未创建，需要执行数据库迁移。"
                );
                return res.json({
                    available: false,
                    entries: [],
                    generation: diaryGenerationStatus
                });
            }
            throw error;
        }

        if (!req.scope) void maybeGenerateDiaryEntry();
        res.json({
            available: true,
            entries: (data || []).map(toPublicDiaryEntry),
            generation: diaryGenerationStatus
        });
    } catch (error) {
        next(error);
    }
});

app.post("/companion/interact", async (req, res, next) => {
    try {
        const database = requestDatabase(req);
        const result = await runCompanionInteraction({
            body: req.body,
            services: {
                ensureConversation: (conversationId, firstMessage) =>
                    ensureConversation(
                        conversationId,
                        firstMessage,
                        database
                    ),
                getSettings: () => getSettings(database),
                loadChatContext: (conversationId, settings) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        database
                    ),
                loadCompanionInteractionContext: (
                    conversationId,
                    settings
                ) =>
                    loadCompanionInteractionContext(
                        conversationId,
                        settings,
                        database
                    ),
                findCompanionInteractionReply: (
                    conversationId,
                    eventId
                ) =>
                    findCompanionInteractionReply(
                        conversationId,
                        eventId,
                        database
                    ),
                interactionGuard: companionInteractionGuard,
                loadCustomStickers: () => req.scope
                    ? listActiveCustomStickers(req.scope)
                    : Promise.resolve([]),
                resolveTurnModel,
                generateReply,
                saveMessage: (
                    conversationId,
                    role,
                    content,
                    options = {}
                ) =>
                    saveMessage(
                        conversationId,
                        role,
                        content,
                        { ...options, database }
                    ),
                touchConversation: (conversationId) =>
                    touchConversation(conversationId, database)
            }
        });
        res.json({
            ...result,
            assistant_message: publicAssistantMessage(
                result.assistant_message,
                result.conversation_id || result.session_id
            )
        });
        // 互动轮也进入 Kiwi 记忆；只上报互动类型和角色回复，不把原始热区/状态快照当正文。
        if (result.conversation_id && req.scope) {
            void reportChatTurn({
                conversationId: result.conversation_id,
                userMessage: `[伴侣互动] ${cleanText(req.body?.interaction_type, 30)}`,
                assistantMessage: result.reply || "",
                model: result.model || "",
                tenant: {
                    userId: req.scope.userId,
                    companionId: req.scope.companionId
                }
            }).catch(() => {});
        }
    } catch (error) {
        if (error.retryAfterMs) {
            setRetryAfterHeader(res, error.retryAfterMs);
        }
        next(error);
    }
});

const statusRefreshCooldowns = new Map();

app.post("/companion/status/refresh", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    let reservedAt = 0;
    let cooldownKey = "";
    try {
        const database = requestDatabase(req);
        const conversationId = cleanText(
            req.body?.session_id || req.body?.conversation_id,
            80
        );
        if (!conversationId) {
            return res.status(400).json({ message: "session_id 不能为空。" });
        }
        cooldownKey = `${req.scope?.userId || ""}:${req.scope?.companionId || ""}`;
        const now = Date.now();
        if (!reserveStatusRefresh(statusRefreshCooldowns, cooldownKey, now)) {
            return res.json({
                companion_status: null,
                skipped: "cooldown"
            });
        }
        reservedAt = now;
        const settings = await getSettings(database);
        let messageQuery = database
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("visible", true)
            .eq("context_visible", true);
        const contextResetAt = cleanText(settings?.context_reset_at, 80);
        if (contextResetAt) {
            messageQuery = messageQuery.gte("created_at", contextResetAt);
        }
        const { data: recentRows, error: recentError } = await messageQuery
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(12);
        if (recentError) throw recentError;
        const recentMessages = (recentRows || []).reverse();
        if (!recentMessages.length) {
            return res.json({ companion_status: null, skipped: "empty" });
        }
        const liveState = await xinchaoClient
            .loadState({
                userId: req.scope?.userId,
                companionId: req.scope?.companionId
            })
            .catch(() => null);
        const nextStatus = await refreshCompanionStatus({
            settings,
            messages: recentMessages,
            currentStatus: req.body?.companion_status || null,
            liveState,
            generateReply
        });
        res.json({ companion_status: nextStatus });
    } catch (error) {
        if (reservedAt) releaseStatusRefresh(statusRefreshCooldowns, cooldownKey, reservedAt);
        next(error);
    }
});

app.post("/companion/inner-monologue", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    // 心声功能：默认启用（设置 VISIBLE_INNER_MONOLOGUE_ENABLED=false 可关闭）
    if (process.env.VISIBLE_INNER_MONOLOGUE_ENABLED === "false") {
        return res.status(503).json({ message: "心声功能已暂时停用，排查完成后恢复。" });
    }
    try {
        const database = requestDatabase(req);
        const result = await runVisibleInnerMonologue({
            body: req.body,
            tenant: req.scope
                ? { userId: req.scope.userId, companionId: req.scope.companionId }
                : null,
            services: {
                loadMessage: async (conversationId, messageId) => {
                    const { data, error } = await database
                        .from("messages")
                        .select("id, conversation_id, role, content, visible, created_at, tool_calls")
                        .eq("id", messageId)
                        .eq("conversation_id", conversationId)
                        .maybeSingle();
                    if (error) throw error;
                    return data || null;
                },
                getSettings: () => getSettings(database),
                loadChatContext: async (conversationId, settings, targetMessage) => {
                    const context = await loadChatContext(conversationId, settings, database);
                    const time = String(targetMessage.created_at || "");
                    if (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(time) ||
                        !Number.isFinite(Date.parse(time))) {
                        throw Object.assign(new Error("心声目标消息的时间信息无效。"), { status: 502 });
                    }
                    let query = database.from("messages")
                        .select("id, role, content, created_at, tool_calls")
                        .eq("conversation_id", conversationId)
                        .eq("visible", true)
                        .eq("context_visible", true)
                        .or(`created_at.lt.${time},and(created_at.eq.${time},id.lte.${targetMessage.id})`);
                    if (settings.context_reset_at) query = query.gte("created_at", settings.context_reset_at);
                    const { data, error } = await query
                        .order("created_at", { ascending: false })
                        .order("id", { ascending: false })
                        .limit(12);
                    if (error) throw error;
                    return { ...context, messages: (data || []).reverse() };
                },
                resolveTurnModel,
                generateReply
            }
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.post("/api/v2/reply-options", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
        const database = requestDatabase(req);
        const conversationId = String(req.body?.conversation_id || "").trim();
        if (!conversationId) {
            res.status(400).json({ message: "conversation_id is required" });
            return;
        }
        const { data, error } = await database
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("visible", true)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(10);
        if (error) throw error;
        const messages = (data || []).reverse();
        const settings = await getSettings(database);
        // Keep the secondary "more replies" request on the same model as the
        // conversation's main chat. The account default can differ after a
        // provider switch; options must not silently use another model.
        let optionsSettings = settings;
        try {
            const conversation = await loadConversation(
                conversationId,
                database
            );
            const effectiveModel = await resolveConversationTurnModel(
                settings,
                conversation,
                "",
                database
            );
            optionsSettings = { ...settings, model: effectiveModel };
        } catch {
            // Keep the account default if the conversation is not resolvable.
        }
        let optionsMessages = messages.slice(-6);
        // Reply options are a lightweight secondary request: do not load the
        // full history/memory/context graph on the first-token critical path.
        // The recent message window plus the persona settings is enough to
        // generate two contextual user lines.
        const optionsMemories = [];
        // Reply options are a secondary UI path. Start the primary and a fast
        // alternate profile together so a slow default profile cannot add its
        // full timeout before the fallback starts; first usable result wins.
        let profiles = [];
        try {
            profiles = await aiProviderCenter
                .forDatabase(database)
                .runtimeProfiles(optionsSettings);
        } catch {
            profiles = [];
        }
        const fallbackProfile =
            profiles.find(
                (profile) =>
                    /deepseek/i.test(String(profile.model || "")) &&
                    !(
                        profile.provider === optionsSettings.provider &&
                        profile.model === optionsSettings.model
                    )
            ) ||
            profiles.find(
                (profile) =>
                    !(
                        profile.provider === optionsSettings.provider &&
                        profile.model === optionsSettings.model
                    )
            );
        const candidates = [
            { settings: optionsSettings, fallback: false },
            ...(fallbackProfile
                ? [
                      {
                          settings: { ...optionsSettings, ...fallbackProfile },
                          fallback: true
                      }
                  ]
                : [])
        ];
        const settled = await Promise.all(
            candidates.map(async (candidate) => {
                try {
                    const generated = await generateReplyOptions({
                        settings: candidate.settings,
                        messages: optionsMessages,
                        memories: optionsMemories,
                        count: 4
                    });
                    return { ...candidate, generated };
                } catch {
                    return null;
                }
            })
        );
        let best = null;
        let winner = null;
        for (const entry of settled) {
            const count = Array.isArray(entry?.generated?.options)
                ? entry.generated.options.length
                : 0;
            if (!count) continue;
            if (!best) best = entry;
            if (count >= 2) {
                winner = entry;
                break;
            }
        }
        let selected = winner || best;
        if (!selected) {
            // A provider can occasionally return an empty body on the first
            // call. One sequential retry on the fastest candidate restores the
            // secondary sheet instead of immediately showing “没想出选项”.
            const retryCandidate =
                candidates.find((candidate) => candidate.fallback) ||
                candidates[0];
            if (retryCandidate) {
                try {
                    const generated = await generateReplyOptions({
                        settings: retryCandidate.settings,
                        messages: optionsMessages,
                        memories: optionsMemories,
                        count: 4
                    });
                    if (
                        Array.isArray(generated?.options) &&
                        generated.options.length
                    ) {
                        selected = { ...retryCandidate, generated };
                    }
                } catch {
                    // Fall through to the empty-receipt response.
                }
            }
        }
        const result = selected
            ? {
                  ...selected.generated,
                  options: selected.generated.options
              }
            : { options: [], skipped: true, reason: "provider_unavailable" };
        const usedSettings = selected?.settings || optionsSettings;
        const fallbackUsed = selected?.fallback === true;
        res.json({
            options: result.options,
            generated: !result.skipped,
            reason: result.reason || "",
            model: usedSettings.model || "",
            provider: usedSettings.provider || "",
            fallback_used: fallbackUsed
        });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/voice/warmup",
    async (req, res) => {
        const result = hervoiceWarmup.start({
            baseUrl: process.env.HERVOICE_URL
        });
        res.status(202).json({
            ok: true,
            started: result.started,
            reason: result.reason
        });
    }
);

app.post(
    "/voice/turn",
    limitVoiceTurnsPerIp,
    voiceUpload.single("file"),
    async (req, res, next) => {
        res.set("Cache-Control", "no-store");

        const turnAbort = new AbortController();
        const deadlineMs = Math.min(
            170_000,
            Math.max(30_000, Number(process.env.VOICE_TURN_DEADLINE_MS) || 140_000)
        );
        let deadlineExpired = false;
        const deadlineTimer = setTimeout(() => {
            deadlineExpired = true;
            turnAbort.abort();
        }, deadlineMs);
        deadlineTimer.unref?.();
        res.on("close", () => {
            clearTimeout(deadlineTimer);
            if (!res.writableEnded) turnAbort.abort();
        });
        res.on("finish", () => clearTimeout(deadlineTimer));

        let voiceTurnClaimed = null;
        let clientMessageIdForLease = "";
        let voiceLeaseId = "";
        let voiceOwnership = {};
        let voiceLeaseSettled = false;
        try {
            const database = requestDatabase(req);
            if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
                return res.status(400).json({ message: "请先录制一段语音。" });
            }

            const fields = parseVoiceTurnFields(req.body);
            const clientMessageId = normalizeClientMessageId(
                fields.clientMessageId
            );
            clientMessageIdForLease = clientMessageId || "";
            if (clientMessageId) {
                const guardKey = [
                    req.scope?.userId || "",
                    req.scope?.companionId || "",
                    clientMessageId
                ].join(":");
                const guardTtlMs = deadlineMs + 60_000;
                const claimToken = claimVoiceTurnOrRespond(
                    res,
                    voiceTurnGuard,
                    guardKey,
                    guardTtlMs
                );
                if (!claimToken) return;
                voiceTurnClaimed = { key: guardKey, token: claimToken };
            }

            // Replayed voice turn: the same client id must never create a
            // second user message, model call, or assistant message.
            let resumedUserMessage = null;
            let resumedVoiceAnalysis = null;
            if (clientMessageId) {
                const previousUserMessage = await findUserMessageByClientId(
                    clientMessageId,
                    database
                );
                if (previousUserMessage) {
                    if (previousUserMessage.tool_calls?.is_voice !== true) {
                        const error = new Error(
                            "这个客户端消息编号已用于文字聊天。"
                        );
                        error.status = 409;
                        error.code = "CLIENT_MESSAGE_NOT_VOICE";
                        throw error;
                    }
                    assertClientMessageConversation(
                        previousUserMessage,
                        fields.sessionId || previousUserMessage.conversation_id
                    );
                    const previousAssistantMessage =
                        await findAssistantReplyByClientId(
                            previousUserMessage.conversation_id,
                            clientMessageId,
                            database
                        );
                    if (previousAssistantMessage) {
                        return res.json(
                            voiceReplayPayload(
                                previousUserMessage,
                                previousAssistantMessage
                            )
                        );
                    }
                    const resumeAfterMs = voiceOrphanResumeWindowMs(
                        process.env.VOICE_ORPHAN_RESUME_MS || 175_000
                    );
                    if (
                        !canResumeVoiceOrphan(
                            previousUserMessage,
                            Date.now(),
                            resumeAfterMs
                        )
                    ) {
                        const recovery = voiceTurnRecoveryResponse(
                            voiceOrphanRemainingMs(
                                previousUserMessage,
                                resumeAfterMs
                            )
                        );
                        res.set(recovery.headers);
                        return res
                            .status(recovery.status)
                            .json(recovery.body);
                    }
                    const storedAnalysis =
                        previousUserMessage.tool_calls?.voice_analysis || {};
                    resumedUserMessage = previousUserMessage;
                    resumedVoiceAnalysis = {
                        text: previousUserMessage.content || "",
                        emotion: storedAnalysis.emotion || "neutral",
                        confidence: Number(storedAnalysis.confidence) || 0,
                        hint: storedAnalysis.hint || "",
                        features: storedAnalysis.features || {},
                        analyzed_at:
                            storedAnalysis.analyzed_at ||
                            previousUserMessage.created_at ||
                            new Date().toISOString(),
                        source: storedAnalysis.source || "hervoice"
                    };
                }
            }

            let conversationId = resumedUserMessage?.conversation_id || null;
            const [settings, ensuredConversationId] = await Promise.all([
                getSettings(database),
                fields.sessionId
                    ? ensureConversation(fields.sessionId, "", database)
                    : Promise.resolve(null)
            ]);
            if (!conversationId) conversationId = ensuredConversationId;
            const conversation = conversationId
                ? await loadConversation(conversationId, database)
                : null;
            const effectiveModel = await resolveConversationTurnModel(
                settings,
                conversation,
                fields.requestedModel,
                database
            );
            if (turnAbort.signal.aborted) return;
            const voiceAnalysis =
                resumedVoiceAnalysis ||
                (await analyzeVoiceWithHervoice({
                    file: req.file,
                    baseUrl: process.env.HERVOICE_URL,
                    secret: process.env.HERVOICE_SECRET,
                    timeoutMs: process.env.HERVOICE_TIMEOUT_MS,
                    signal: turnAbort.signal
                }));
            if (turnAbort.signal.aborted) return;
            if (!conversationId) {
                conversationId = await ensureConversation(
                    "",
                    voiceAnalysis.text,
                    database,
                    effectiveModel
                );
            }

            const effectiveSettings = withClampedOutputTokens({
                ...settings,
                model: effectiveModel,
                emotion_understanding_enabled:
                    fields.emotionUnderstandingEnabled,
                // Voice turns are latency-sensitive: cap the provider call so
                // the frontend timeout can cover transcription + generation.
                request_timeout_ms: Math.min(
                    60_000,
                    Math.max(
                        1_500,
                        Number(settings.request_timeout_ms) || 60_000
                    )
                )
            });
            const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
                isContextTimestampCurrent(
                    fields.companionStatus?.updatedAt,
                    settings
                )
                    ? fields.companionStatus
                    : {},
                new Date(),
                { userDisplayName: req.scope?.profile?.display_name || "" }
            );
            voiceLeaseId = clientMessageId ? randomUUID() : "";
            voiceOwnership = req.scope
                ? {
                      userId: req.scope.userId,
                      companionId: req.scope.companionId
                  }
                : {};
            let savedUserMessage = resumedUserMessage;
            try {
                if (!savedUserMessage) {
                savedUserMessage = await saveMessage(
                    conversationId,
                    "user",
                    voiceAnalysis.text,
                    {
                        tool_calls: {
                            ...(fields.voiceAnalysisRetentionEnabled
                                ? buildVoiceMessageMetadata(voiceAnalysis)
                                : { is_voice: true }),
                            requested_model: fields.requestedModel || null,
                            resolved_model: effectiveModel || ""
                        },
                        ...(clientMessageId
                            ? {
                                  generation_lease: generationLeaseFields(
                                      voiceLeaseId,
                                      Date.now(),
                                      VOICE_GENERATION_LEASE_SECONDS
                                  )
                              }
                            : {}),
                        database,
                        ...(clientMessageId
                            ? { client_message_id: clientMessageId }
                            : {})
                    }
                );
                }
            } catch (error) {
                if (
                    clientMessageId &&
                    isClientMessageUniqueConflict(error)
                ) {
                    const previousUserMessage =
                        await findUserMessageByClientId(
                            clientMessageId,
                            database
                        );
                    if (previousUserMessage) {
                        assertClientMessageConversation(
                            previousUserMessage,
                            conversationId
                        );
                        const previousAssistantMessage =
                            await findAssistantReplyByClientId(
                                previousUserMessage.conversation_id,
                                clientMessageId,
                                database
                            );
                        if (previousAssistantMessage) {
                            return res.json(
                                voiceReplayPayload(
                                    previousUserMessage,
                                    previousAssistantMessage
                                )
                            );
                        }
                        const resumeAfterMs = voiceOrphanResumeWindowMs(
                            process.env.VOICE_ORPHAN_RESUME_MS
                        );
                        const recovery = voiceTurnRecoveryResponse(
                            voiceOrphanRemainingMs(
                                previousUserMessage,
                                resumeAfterMs
                            )
                        );
                        res.set(recovery.headers);
                        return res
                            .status(recovery.status)
                            .json(recovery.body);
                    }
                    throw chatGenerationInProgressError();
                }
                throw error;
            }
            if (clientMessageId && savedUserMessage && resumedUserMessage) {
                // A brand-new user row already carries an unexpired lease from
                // saveMessage; claiming it again would always be rejected.
                let leaseClaim = null;
                try {
                    leaseClaim = await claimVoiceGenerationLease({
                        clientMessageId,
                        savedUserMessage,
                        resumedUserMessage,
                        store: voiceGenerationLeaseStore,
                        leaseId: voiceLeaseId,
                        ownership: voiceOwnership
                    });
                } catch (leaseError) {
                    // Voice remains available if the lease RPC is temporarily
                    // unavailable; the in-process guard still serializes here.
                    markVoiceLeaseDegraded();
                    console.error("语音生成租约获取失败：", {
                        code: publicChatErrorCode(leaseError)
                    });
                }
                if (leaseClaim && leaseClaim.claimed !== true) {
                    const recovery = voiceTurnRecoveryResponse(
                        voiceOrphanRemainingMs(
                            savedUserMessage,
                            voiceOrphanResumeWindowMs(
                                process.env.VOICE_ORPHAN_RESUME_MS
                            )
                        )
                    );
                    res.set(recovery.headers);
                    return res.status(recovery.status).json(recovery.body);
                }
                if (leaseClaim?.message) {
                    savedUserMessage = leaseClaim.message;
                }
            }
            const [
                context,
                listeningRuntimeContext,
                mcpRuntime,
                customStickers,
                specialDatesContext,
                xinchaoNowContext
            ] = await Promise.all([
                loadChatContext(conversationId, settings, database),
                safeLoadListeningRuntimeContext(database),
                mcpDeviceCenter
                    .forDatabase(database)
                    .createRuntime()
                    .catch((error) => {
                        console.error(
                            "语音轮次 MCP 设备运行时加载失败：",
                            error?.code || error?.message || "unknown"
                        );
                        return {
                            tools: [],
                            actions: [],
                            runtimeContext: "",
                            hasTool: () => false,
                            execute: async () => ({
                                ok: false,
                                error: "设备中心暂时不可用。"
                            })
                        };
                    }),
                req.scope
                    ? listActiveCustomStickers(req.scope).catch(() => [])
                    : Promise.resolve([]),
                (async () => {
                    if (!req.scope) return "";
                    try {
                        const specialDates = createSpecialDatesService({ database });
                        return specialDates.buildContext(
                            await specialDates.upcoming(req.scope, 7)
                        );
                    } catch (error) {
                        console.error(
                            "特殊日子日历加载失败：",
                            error?.code || error?.message || "unknown"
                        );
                        return "";
                    }
                })(),
                xinchaoClient.loadNow(req.scope)
            ]);
            const worldBookContext = await resolveWorldBookContext({
                database,
                settings: effectiveSettings,
                messages: context.messages
            });
            const chatTools = createChatToolExecutor(
                conversationId,
                initialCompanionStatus,
                "",
                mcpRuntime,
                database,
                req.scope?.profile?.display_name || "",
                customStickers,
                req.scope || null,
                createTakeoutChannel({ database }),
                createSpecialDatesService({ database }),
                {
                    dailies: createDailyShotsService({ database }),
                    achievements: createAchievementsService({ database }),
                    funLabs: createFunLabsService({ database })
                },
                "",
                createConfiguredXhsClient(),
                neteaseQrLogin,
                createWebExplorer(),
                interestEngine
            );
            const runtimeContext = [
                xinchaoNowContext ? `【心潮·此刻】\n${xinchaoNowContext}` : "",
                runtimeContextFromValues(
                    {
                        environmentContext: fields.environmentContext
                    },
                    initialCompanionStatus,
                    req.scope?.profile?.display_name || ""
                ),
                buildVoiceRuntimeContext(
                    voiceAnalysis,
                    fields.emotionUnderstandingEnabled
                ),
                buildNurseryRuntimeContext(
                    context.nursery,
                    voiceAnalysis.text
                ),
                listeningRuntimeContext,
                specialDatesContext,
                buildReplyRhythmContext({
                    userMessage: voiceAnalysis.text || fields.message,
                    settings: effectiveSettings
                }),
                mcpRuntime.runtimeContext
            ]
                .filter(Boolean)
                .join("\n\n");
            if (turnAbort.signal.aborted) {
                const error = new Error(
                    deadlineExpired
                        ? "语音处理等待超时，本次先不保存回复。"
                        : "语音请求已取消。"
                );
                error.status = deadlineExpired ? 504 : 499;
                error.code = deadlineExpired
                    ? "VOICE_TURN_DEADLINE"
                    : "VOICE_TURN_CANCELLED";
                throw error;
            }
            const generationPromise = generateReply({
                settings: effectiveSettings,
                messages: context.messages,
                memories: context.memories,
                runtimeContext,
                turnContext: fields.turnContext,
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                worldBookContext,
                tools: [
                    UPDATE_COMPANION_STATUS_TOOL,
                    POST_MOMENT_TOOL,
                    SPECIAL_DATE_ADD_TOOL,
                    SPECIAL_DATE_LIST_TOOL,
                    SPECIAL_DATE_REMOVE_TOOL,
                    DAILY_SHOT_ADD_TOOL,
                    ACHIEVEMENTS_LIST_TOOL,
                    ACHIEVEMENT_DEFINE_TOOL,
                    ACHIEVEMENT_UNLOCK_TOOL,
                    DANMAKU_READ_TOOL,
                    COMPATIBILITY_RECORD_TOOL,
                    XHS_ME_TOOL,
                    XHS_SEARCH_TOOL,
                    XHS_LIKE_TOOL,
                    XHS_COMMENT_TOOL,
                    XHS_FOLLOW_TOOL,
                    WEB_READ_TOOL,
                    RSS_READ_TOOL,
                    V2EX_HOT_TOOL,
                    V2EX_TOPIC_TOOL,
                    V2EX_NODE_TOOL,
                    BILI_SEARCH_TOOL,
                    BILI_VIDEO_TOOL,
                    EXA_SEARCH_TOOL,
                    WEB_SEARCH_TOOL,
                    BILI_RECOMMEND_TOOL,
                    INTERESTS_VIEW_TOOL,
                    CLOUD_MUSIC_SEARCH_TOOL,
                    CLOUD_MUSIC_DAILY_TOOL,
                    CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL,
                    CLOUD_MUSIC_CREATE_PLAYLIST_TOOL,
                    CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL,
                    CLOUD_MUSIC_ALBUM_INFO_TOOL,
                    CLOUD_MUSIC_ARTIST_INFO_TOOL,
                    CLOUD_MUSIC_SUBSCRIPTIONS_TOOL,
                    CLOUD_MUSIC_LIKE_TOOL,
                    CLOUD_MUSIC_HISTORY_TOOL,
                    CLOUD_MUSIC_MY_PLAYLISTS_TOOL,
                    CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL,
                    NETEASE_PLAY_SONG_TOOL,
                    chatTools.getStickerTool(),
                    SELECT_REPLY_SUGGESTIONS_TOOL,
                    COMPANION_ACTIVITY_TOOL,
                    ...mcpRuntime.tools
                ],
                executeTool: async (...args) => {
                    if (turnAbort.signal.aborted) {
                        return {
                            ok: false,
                            error: "语音请求已取消，未执行工具。"
                        };
                    }
                    return chatTools.executeTool(...args);
                }
            });
            const generated = await raceWithAbort(
                generationPromise,
                turnAbort.signal,
                () => {
                    const error = new Error(
                        deadlineExpired
                            ? "语音处理等待超时，本次先不保存回复。"
                            : "语音请求已取消。"
                    );
                    error.status = deadlineExpired ? 504 : 499;
                    error.code = deadlineExpired
                        ? "VOICE_TURN_DEADLINE"
                        : "VOICE_TURN_CANCELLED";
                    return error;
                }
            );
            const finalizedReplySuggestions = finalizeReplySuggestions({
                recentMessages: context.messages,
                assistantText: generated.text,
                candidate: chatTools.getReplySuggestions(),
                previousSuggestions: previousReplySuggestionsFromMessages(
                    context.messages
                )
            });
            if (turnAbort.signal.aborted) {
                if (voiceLeaseId && !voiceLeaseSettled) {
                    try {
                        await voiceGenerationLeaseStore.fail(
                            clientMessageId,
                            voiceLeaseId,
                            voiceOwnership
                        );
                        voiceLeaseSettled = true;
                    } catch (leaseError) {
                        console.error("语音保存前释放租约失败：", {
                            code: publicChatErrorCode(leaseError)
                        });
                    }
                }
                if (!res.writableEnded && !res.destroyed) {
                    const aborted = new Error(
                        deadlineExpired
                            ? "语音处理超时，请稍后重试。"
                            : "语音请求已取消。"
                    );
                    aborted.status = deadlineExpired ? 504 : 499;
                    aborted.code = deadlineExpired
                        ? "VOICE_TURN_DEADLINE"
                        : "VOICE_TURN_CANCELLED";
                    next(aborted);
                }
                return;
            }
            let savedAssistantMessage;
            try {
                savedAssistantMessage = await saveMessage(
                    conversationId,
                    "assistant",
                    generated.text,
                    {
                        tool_calls: {
                            ...companionStickerToolCalls(chatTools),
                            ...replySuggestionToolCalls(finalizedReplySuggestions),
                            ...(chatTools.getActivityActions().length ? { activity_actions: chatTools.getActivityActions() } : {}),
                            ...(mcpRuntime.actions.length
                                ? { mcp_actions: mcpRuntime.actions }
                                : {}),
                            ...(clientMessageId
                                ? { reply_to_client_message_id: clientMessageId }
                                : {})
                        },
                        database
                    }
                );
            } catch (error) {
                if (
                    clientMessageId &&
                    isClientMessageUniqueConflict(error)
                ) {
                    const replayedAssistant =
                        await findAssistantReplyByClientId(
                            conversationId,
                            clientMessageId,
                            database
                        );
                    if (replayedAssistant) {
                        voiceLeaseSettled = true;
                        return res.json(
                            voiceReplayPayload(
                                savedUserMessage,
                                replayedAssistant
                            )
                        );
                    }
                }
                throw error;
            }
            if (clientMessageId && voiceLeaseId) {
                try {
                    await voiceGenerationLeaseStore.commit({
                        userId: voiceOwnership.userId,
                        companionId: voiceOwnership.companionId,
                        clientMessageId,
                        leaseId: voiceLeaseId,
                        content: generated.text,
                        toolCalls:
                            savedAssistantMessage.tool_calls || {},
                        visible: savedAssistantMessage.visible !== false
                    });
                } catch (leaseError) {
                    markVoiceLeaseDegraded();
                    console.error("语音生成租约提交失败：", {
                        code: publicChatErrorCode(leaseError)
                    });
                }
            }
            voiceLeaseSettled = true;

            void xinchaoClient
                .recordExchange({
                    scope: req.scope,
                    userMessage: voiceAnalysis.text || fields.message,
                    assistantMessage: isProviderBoundaryResidue(generated.text)
                        ? ""
                        : generated.text,
                    messageId: savedAssistantMessage.id
                })
                .catch(() => {});

            // 语音轮的转写与回复同样进入 Kiwi 记忆，避免语音聊天永久缺席长期记忆。
            void reportChatTurn({
                conversationId,
                userMessage: voiceAnalysis.text || fields.message,
                assistantMessage: isProviderBoundaryResidue(generated.text)
                    ? ""
                    : generated.text,
                model: effectiveModel || "",
                tenant: {
                    userId: settings.user_id,
                    companionId: settings.companion_id
                }
            }).catch(() => {});

            res.json({
                reply: generated.text,
                session_id: conversationId,
                conversation_id: conversationId,
                user_message: publicMessage(savedUserMessage),
                assistant_message: publicAssistantMessage(
                    savedAssistantMessage,
                    conversationId
                ),
                model: effectiveModel || "",
                provider: settings.provider,
                response_mode: generated.mode,
                voice_analysis: publicVoiceAnalysis(voiceAnalysis),
                prompt_receipt: generated.prompt_receipt || null,
                // Memory compression can issue another provider request. Do it
                // after the voice response instead of extending the turn budget.
                memory_compression: null,
                companion_status: chatTools.getCompanionStatus(),
                companion_status_updated: chatTools.wasCompanionStatusUpdated()
            });
            void touchConversation(conversationId, database).catch(() => {});
            void tryScheduleProactiveMessageEvaluation({
                database,
                settings,
                sourceMessageId: savedAssistantMessage.id
            }).catch(() => {});
            void tryScheduleAutonomousContentEvaluations({
                database,
                sourceMessageId: savedAssistantMessage.id
            }).catch(() => {});
            void tryCompressMemory(
                conversationId,
                effectiveSettings,
                database
            ).catch((error) => {
                console.error(
                    "语音轮次记忆压缩失败：",
                    error?.code || error?.message || "unknown"
                );
            });
        } catch (error) {
            if (voiceLeaseId && !voiceLeaseSettled) {
                try {
                    await voiceGenerationLeaseStore.fail(
                        clientMessageIdForLease,
                        voiceLeaseId,
                        voiceOwnership
                    );
                    voiceLeaseSettled = true;
                } catch (leaseError) {
                    console.error("语音失败租约释放失败：", {
                        code: publicChatErrorCode(leaseError)
                    });
                }
            }
            next(error);
        } finally {
            if (voiceLeaseId && !voiceLeaseSettled) {
                void voiceGenerationLeaseStore
                    .fail(
                        clientMessageIdForLease,
                        voiceLeaseId,
                        voiceOwnership
                    )
                    .catch((leaseError) => {
                        console.error("语音生成租约释放失败：", {
                            code: publicChatErrorCode(leaseError)
                        });
                    });
            }
            if (voiceTurnClaimed) {
                voiceTurnGuard.release(
                    voiceTurnClaimed.key,
                    voiceTurnClaimed.token
                );
            }
        }
    }
);

app.post("/voice/speech", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = requestDatabase(req);
        const messageId = cleanText(req.body?.message_id, 80);
        const conversationId = cleanText(
            req.body?.session_id || req.body?.conversation_id,
            80
        );
        const speechToken = cleanText(req.body?.speech_token, 160);
        if (
            !isSafeSpeechMessageId(messageId) ||
            !isSafeConversationId(conversationId) ||
            !verifySpeechAccessToken(
                messageId,
                conversationId,
                speechToken,
                process.env
            )
        ) {
            return res.status(404).json({
                message: "找不到这条可朗读的 AI 回复。"
            });
        }

        const { data: message, error } = await database
            .from("messages")
            .select("id, role, content, tool_calls")
            .eq("id", messageId)
            .eq("conversation_id", conversationId)
            .eq("role", "assistant")
            .eq("visible", true)
            .maybeSingle();
        if (error) throw error;
        if (!message) {
            return res.status(404).json({ message: "找不到这条可朗读的 AI 回复。" });
        }

        const limit = expressiveSpeechRateLimitState.consume(req.ip);
        if (!limit.allowed) {
            const retryAfterSeconds = setRetryAfterHeader(
                res,
                limit.retryAfterMs
            );
            return res.status(429).json({
                message: "自然语音请求太频繁，请稍等一会儿再试。",
                retry_after_seconds: retryAfterSeconds
            });
        }

        const providerConfig = req.scope
            ? await createVoiceProviderCenter({
                  database: req.scope.db,
                  env: process.env
              }).resolveRuntimeProfile()
            : null;
        const cacheKey = [
            req.scope?.userId || "legacy",
            req.scope?.companionId || "legacy",
            messageId,
            providerConfig?.provider || "global-minimax",
            providerConfig?.model || "",
            providerConfig?.region || "",
            providerConfig?.speed || "",
            providerConfig?.updatedAt || ""
        ].join(":");
        const { speech, cacheStatus } =
            await expressiveSpeechCache.getOrCreate(
                cacheKey,
                () =>
                    synthesizeExpressiveSpeech({
                        text: message.content,
                        emotionHint:
                            message.tool_calls?.speech_emotion,
                        providerConfig,
                        env: process.env
                    })
            );
        res.set({
            "Content-Type": speech.contentType,
            "Content-Length": String(speech.audio.length),
            "X-DengTa-Voice-Provider": speech.provider,
            "X-DengTa-Voice-Model": speech.model || "",
            "X-DengTa-Voice-Emotion": speech.emotion,
            "X-DengTa-Voice-Cache": cacheStatus,
            "X-Content-Type-Options": "nosniff"
        });
        res.send(speech.audio);
    } catch (error) {
        next(error);
    }
});

app.post("/chat", acceptChatBody, async (req, res, next) => {
    try {
        res.json(await executeChatTurn(req));
    } catch (error) {
        next(error);
    }
});

app.post("/api/v2/whereabouts/ingest", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        if (!scope?.userId || !scope?.companionId) {
            const error = new Error("行踪上报需要登录态。");
            error.status = 401;
            error.code = "whereabouts_auth_required";
            throw error;
        }
        const result = await whereaboutsIngestPoint({
            database: scope.db,
            userId: scope.userId,
            companionId: scope.companionId,
            point: req.body || {}
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
});
app.post("/chat/stream", acceptChatBody, async (req, res, next) => {
    let streamStarted = false;
    let streamedText = "";
    let userMessageCommitted = false;
    let bubbleBuffer = null;
    let bubbleTimer = null;
    // VM/source tests may execute this route without the module-level flag;
    // default to the safe legacy path when it is unavailable.
    const bubblesEnabled =
        typeof sentenceBubblesEnabled === "boolean"
            ? sentenceBubblesEnabled
            : false;

    const clearBubbleTimer = () => {
        if (bubbleTimer) {
            clearTimeout(bubbleTimer);
            bubbleTimer = null;
        }
    };
    const emitBubbleEvents = (events) => {
        for (const event of events || []) writeSse(res, event);
    };
    const scheduleBubbleFlush = () => {
        clearBubbleTimer();
        if (!bubblesEnabled || !bubbleBuffer || !bubbleBuffer.hasPending()) {
            return;
        }
        const delay = bubbleBuffer.nextFlushDelay(Date.now());
        if (delay === null) return;
        bubbleTimer = setTimeout(() => {
            bubbleTimer = null;
            if (!bubbleBuffer) return;
            emitBubbleEvents(bubbleBuffer.flushDue(Date.now()));
            scheduleBubbleFlush();
        }, delay);
    };

    try {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        streamStarted = true;
        if (bubblesEnabled) {
            bubbleBuffer = new SentenceBubbleBuffer({
                immediate:
                    process.env.STREAM_SENTENCE_IMMEDIATE !== "false",
                minBubbleChars: Math.min(
                    600,
                    Math.max(
                        0,
                        Number(process.env.STREAM_SENTENCE_MIN_CHARS) || 120
                    )
                )
            });
        }
        const result = await executeChatTurn(req, {
            onStatus: (event) => {
                if (event?.type === "meta" && event.user_message) {
                    userMessageCommitted = true;
                }
                writeSse(res, event);
            },
            onModelEvent: (event) => {
                if (
                    ["text", "reasoning", "monologue"].includes(event?.type)
                ) {
                    if (
                        event.type === "text" &&
                        typeof event.content === "string"
                    ) {
                        streamedText += event.content;
                        if (bubblesEnabled && bubbleBuffer) {
                            emitBubbleEvents(bubbleBuffer.push(event.content));
                            scheduleBubbleFlush();
                        } else {
                            writeSse(res, event);
                        }
                        return;
                    }
                    writeSse(res, event);
                }
            }
        });

        if (bubblesEnabled && bubbleBuffer) {
            clearBubbleTimer();
            emitBubbleEvents(bubbleBuffer.flushFinal());
            const savedReplyContent =
                result?.assistant_message?.content ?? result?.reply ?? "";
            const bubbleState = alignReplyBubbleState(
                bubbleBuffer.getSegments(),
                savedReplyContent
            );
            if (
                bubbleState &&
                result?.assistant_message?.id
            ) {
                result.reply_bubbles = bubbleState;
                if (result.assistant_message.tool_calls) {
                    result.assistant_message.tool_calls.reply_bubbles =
                        bubbleState;
                }
                try {
                    await persistReplyBubbles(
                        requestDatabase(req),
                        result.assistant_message.id,
                        bubbleState
                    );
                } catch (bubblePersistError) {
                    console.error("reply_bubbles_persist_failed", {
                        code: publicChatErrorCode(bubblePersistError)
                    });
                }
            }
        }

        writeSse(res, streamSuccess(result));
        if (!res.destroyed && !res.writableEnded) res.end();
    } catch (error) {
        clearBubbleTimer();
        if (!streamStarted) return next(error);
        console.error("stream_chat_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            provider_code: publicChatErrorMetadata(error).provider_code || null,
            error_source: publicChatErrorMetadata(error).error_source || null,
            provider_phase: publicChatErrorMetadata(error).provider_phase || null,
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            upstream_response_status:
                String(error?.upstreamResponseStatus || "").slice(0, 40) ||
                null,
            upstream_incomplete_reason:
                String(error?.upstreamIncompleteReason || "").slice(0, 80) ||
                null,
            upstream_output_types: Array.isArray(error?.upstreamOutputTypes)
                ? error.upstreamOutputTypes.slice(0, 12)
                : [],
            user_message_committed: userMessageCommitted
        });
        // 已通过 SSE 发出的部分正文必须保留：先落一条 partial assistant 消息，再发错误事件。
        if (bubblesEnabled && bubbleBuffer) {
            emitBubbleEvents(bubbleBuffer.flushFinal());
        }
        // 流式错误同样落库并带 log_id，聊天页可点开查看完整日志
        const streamLogId = await persistChatErrorLog(req, error);
        if (streamedText.trim() && userMessageCommitted && isUuid(req.body?.session_id) && !isProviderBoundaryResidue(streamedText)) {
            try {
                await saveMessage(req.body.session_id, "assistant", streamedText, {
                    database: requestDatabase(req),
                    tool_calls: {
                        partial_reply: true,
                        error_code: publicChatErrorCode(error),
                        error_log_id: streamLogId || "",
                        error_source: publicChatErrorMetadata(error).error_source || "",
                        provider_phase: publicChatErrorMetadata(error).provider_phase || "",
                        provider_code: publicChatErrorMetadata(error).provider_code || "",
                        upstream_status: Number(error?.upstreamStatus) || null
                    }
                });
            } catch (partialError) {
                console.error("partial_reply_save_failed", { code: publicChatErrorCode(partialError) });
            }
        }
        res.locals = res.locals || {};
        res.locals.userMessageCommitted = userMessageCommitted;
        res.locals.streamLogId = streamLogId;
        try {
            writeSse(
                res,
                streamFailure(error, {
                    userMessageCommitted,
                    logId: streamLogId
                })
            );
            writeSse(res, { type: "done", ok: false });
            if (!res.destroyed && !res.writableEnded) res.end();
        } catch (sendError) {
            // 连接已损坏时无法发送错误事件，交给错误中间件兜底（同样已落库）。
            next(sendError);
        }
    }
});

async function persistRefusalLog({ userId, companionId, conversationId }) {
    // 成功响应的拒答也落日志（供聊天页顶部标注条'查看日志'），
    // 与请求失败的 chat_error_logs 同一张表、同一错误码。
    try {
        const { data, error } = await supabase
            .from("chat_error_logs")
            .insert({
                user_id: userId || null,
                companion_id: companionId || null,
                conversation_id: conversationId || null,
                path: "/chat",
                method: "POST",
                error_code: "provider_boundary_residue",
                message: "供应商回复未保存，诊断不保留回复正文。",
                error_source: "upstream_provider_or_gateway",
                provider_phase: "response",
                request_summary: { stream: true, refusal: true }
            })
            .select("id")
            .single();
        return {
            code: "provider_boundary_residue",
            source: "upstream",
            error_log_id: data?.id || null
        };
    } catch {
        return { code: "provider_boundary_residue", source: "upstream", error_log_id: null };
    }
}

async function persistChatErrorLog(req, error) {
    try {
        const scope = req.scope;
        const candidateId = req.body?.conversation_id || req.body?.session_id;
        const { data } = await supabase.from("chat_error_logs").insert({
            user_id: scope?.userId || null,
            companion_id: scope?.companionId || null,
            conversation_id: isUuid(candidateId) ? candidateId : null,
            ...diagnosticRecord(req, error)
        }).select("id").single();
        return data?.id || null;
    } catch { return null; }
}

app.use(async (error, req, res, next) => {
    const errorStatus = Number(error?.status) || 500;
    // Anonymous probes must not turn into one DB insert per request, but keep
    // the error_log_id for authenticated users hitting a real 403.
    const skipAnonymousAuthError = !req.scope && [401, 403].includes(errorStatus);
    const errorLogId = skipAnonymousAuthError
        ? null
        : await persistChatErrorLog(req, error);
    const isChatRequest = ["/chat", "/chat/stream"].includes(req.path);
    const isVoiceRequest = ["/voice/turn", "/voice/speech"].includes(req.path);
    if (isChatRequest) {
        console.error("chat_request_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            provider_code: publicChatErrorMetadata(error).provider_code || null,
            error_source: publicChatErrorMetadata(error).error_source || null,
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            method: req.method,
            path: req.path
        });
    } else {
        console.error("request_failed", diagnosticRecord(req, error));
    }

    if (res.headersSent) {
        // /chat/stream 已开始 SSE 但发生未捕获错误：必须把错误以 SSE 事件发给前端，
        // 否则客户端只会看到"连接提前结束"且拿不到日志 id。
        if (req.path === "/chat/stream" && res.writableEnded === false) {
            try {
                const committed = res.locals?.userMessageCommitted === true;
                for (const event of streamErrorEvents(error, {
                    userMessageCommitted: committed,
                    logId: res.locals?.streamLogId || errorLogId || null
                })) {
                    writeSse(res, event);
                }
                res.end();
                return;
            } catch {
                // 响应已损坏，无法再发送任何内容。
            }
        }
        return next(error);
    }

    if (error instanceof multer.MulterError) {
        const voiceRequest = req.path === "/voice/turn";
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                message: voiceRequest
                    ? "语音文件不能超过 12MB。"
                    : "单个附件不能超过 12MB。"
            });
        }
        if (["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error.code)) {
            return res.status(413).json({
                message: voiceRequest
                    ? "一次只能发送一个语音文件。"
                    : "一次最多发送 4 个附件。"
            });
        }
        return res.status(400).json({
            message: voiceRequest
                ? "语音上传格式不正确，请重新录制后再试。"
                : "附件上传格式不正确，请重新选择后再试。"
        });
    }

    const status = Number(error.status) || 500;
    const isDistillRequest = req.path.replace(/\/+$/, "") === "/api/v2/style-distill";
    const clientErrorCode =
        status >= 400 &&
        (status < 500 || (isDistillRequest && /^style_distill_[a-z_]+$/.test(error.code || ""))) &&
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
            ? error.code
            : null;
    const voiceLifecycleCode =
        isVoiceRequest &&
        [
            "VOICE_TURN_DEADLINE",
            "VOICE_TURN_CANCELLED",
            "CLIENT_MESSAGE_NOT_VOICE"
        ].includes(error.code)
            ? error.code
            : null;
    const publicErrorCode =
        voiceLifecycleCode || publicChatErrorCode(error) || clientErrorCode || (safeDiagnosticCode(error.code) !== "request_failed" ? safeDiagnosticCode(error.code) : null) || (isChatRequest ? "request_failed" : null);
    const isModelRequest = isChatRequest || isDistillRequest || isVoiceRequest;
    const chatErrorMetadata = isModelRequest
        ? publicChatErrorMetadata(error)
        : {};
    if (isVoiceRequest && status === 409 && !res.getHeader("Retry-After")) {
        setRetryAfterHeader(res, 5_000);
    }
    res.status(error.status || 500).json({
        message: isModelRequest
            ? publicChatErrorMessage(error, "服务器处理请求失败，请稍后重试。")
            : error.status
              ? error.message
              : "服务器处理请求失败。",
        detail:
            process.env.NODE_ENV === "production" || isModelRequest
                ? undefined
                : error.message,
        ...(publicErrorCode ? { code: publicErrorCode } : {}),
        ...(errorLogId ? { error_log_id: errorLogId } : {}),
        ...chatErrorMetadata,
        ...(error.errorSource === "external_memory_gateway" ? {error_source:"external_memory_gateway",upstream_status:Number.isInteger(error.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599 ? error.upstreamStatus : undefined} : {})
    });
});

let diaryMaintenanceTimer = null;
if (!authRequired) {
    diaryMaintenanceTimer = setInterval(() => {
        void maybeGenerateDiaryEntry();
    }, 60 * 1000);
    diaryMaintenanceTimer.unref?.();
}

const httpServer = app.listen(port, () => {
    qqCloud.start();
    if (!authRequired) {
        void maybeGenerateDiaryEntry();
    }
    console.log(`服务器运行在 http://localhost:${port}`);
    // Startup has no tenant scope; do not probe the shared public memory library.
    void (async () => {
        const health = await checkKiwiMemoryHealth().catch(() => null);
        if (!health) {
            console.warn("[KIWI-MEM] 健康检查失败：记忆网关无响应。");
            return;
        }
        if (!health.configured) {
            console.warn("[KIWI-MEM] 未配置：设置 KIWI_MEM_URL 启用记忆网关。");
            return;
        }
        if (health.error === "kiwi_mem_tenant_required") {
            console.log("[KIWI-MEM] 已配置，等待登录后的账号与伴侣范围检查；尚未验证连接。");
            return;
        }
        if (!health.reachable) {
            console.warn("[KIWI-MEM] 不可达：", health.message);
            return;
        }
        if (health.embedding_available !== true) {
            console.warn(
                `[KIWI-MEM] ⚠️ embedding 不可用（source=${health.embedding_source}，model=${health.embedding_model || "(未配置)"}，覆盖率 ${health.coverage}）。语义检索已降级为关键词；请在 kiwi 控制面板配置可用的嵌入模型。`
            );
            return;
        }
        console.log(
            `[KIWI-MEM] 正常：${health.total_memories} 条记忆，embedding 覆盖率 ${health.coverage}（${health.embedding_model} @ ${health.embedding_source}）。`
        );
    })();
});

// Render sends SIGTERM on deploy. Let in-flight responses finish and stop the
// local maintenance loop instead of killing sockets immediately.
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received; closing server`);
    try {
        backgroundJobLoop?.stop?.();
    } catch { /* maintenance loop is best-effort */ }
    if (diaryMaintenanceTimer) clearInterval(diaryMaintenanceTimer);
    const stopQQCloud = qqCloud.stop().catch(() => {});
    httpServer.close(() => {
        console.log("[shutdown] http server closed");
        void stopQQCloud.finally(() => process.exit(0));
    });
    httpServer.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref?.();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
