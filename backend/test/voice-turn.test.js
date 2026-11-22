const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    HERVOICE_EMOTIONS,
    HERVOICE_DEFAULT_TIMEOUT_MS,
    HERVOICE_MAX_TIMEOUT_MS,
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    inferTextEmotion,
    createVoiceRateLimitState,
    canResumeVoiceOrphan,
    createHervoiceWarmup,
    applyVoiceTurnInProgressResponse,
    claimVoiceGenerationLease,
    claimVoiceTurnOrRespond,
    createVoiceTurnGuard,
    voiceOrphanRemainingMs,
    voiceOrphanResumeWindowMs,
    voiceTurnRecoveryResponse,
    voiceTurnInProgressResponse,
    setRetryAfterHeader,
    parseVoiceTurnFields,
    raceWithAbort,
    sanitizeHervoiceAnalysis
} = require("../services/voice-turn");

assert.equal(HERVOICE_DEFAULT_TIMEOUT_MS, 25_000);
assert.equal(HERVOICE_MAX_TIMEOUT_MS, 60_000);

{
    const fields = parseVoiceTurnFields({
        client_message_id: "11111111-1111-4111-8111-111111111111",
        session_id: "session-a"
    });
    assert.equal(fields.clientMessageId, "11111111-1111-4111-8111-111111111111");
    assert.equal(fields.sessionId, "session-a");
}
(async () => {
    const controller = new AbortController();
    const pending = analyzeVoiceWithHervoice({
        file: {
            buffer: Buffer.from("voice"),
            mimetype: "audio/webm",
            originalname: "voice.webm"
        },
        baseUrl: "https://voice.example.test",
        secret: "test-secret",
        signal: controller.signal,
        fetchImpl: (url, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        })
    });
    controller.abort();
    await assert.rejects(pending, (error) => {
        assert.equal(error.status, 499);
        assert.equal(error.code, "VOICE_TURN_CANCELLED");
        return true;
    });
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


(async () => {
{
    let resolveLate;
    const controller = new AbortController();
    const pending = new Promise((resolve) => { resolveLate = resolve; });
    const raced = raceWithAbort(pending, controller.signal, () => {
        const error = new Error("deadline");
        error.status = 504;
        error.code = "VOICE_TURN_DEADLINE";
        return error;
    });
    controller.abort();
    await assert.rejects(raced, (error) => {
        assert.equal(error.status, 504);
        assert.equal(error.code, "VOICE_TURN_DEADLINE");
        return true;
    });
    resolveLate("late");
}
{
    const controller = new AbortController();
    const raced = raceWithAbort(
        Promise.resolve({ reply: "ok" }),
        controller.signal,
        () => new Error("should not abort")
    );
    assert.deepEqual(await raced, { reply: "ok" });
}
{
    const controller = new AbortController();
    controller.abort();
    const raced = raceWithAbort(
        Promise.reject(new Error("late provider failure")),
        controller.signal,
        () => {
            const error = new Error("cancelled");
            error.code = "VOICE_TURN_CANCELLED";
            return error;
        }
    );
    await assert.rejects(raced, (error) => error.code === "VOICE_TURN_CANCELLED");
    await new Promise((resolve) => setImmediate(resolve));
}

})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
{
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    assert.equal(
        canResumeVoiceOrphan(
            { created_at: "2026-10-29T23:58:00.000Z" },
            now,
            160_000
        ),
        false,
        "fresh in-flight voice turn must not be resumed"
    );
    assert.equal(
        canResumeVoiceOrphan(
            { created_at: "2026-10-29T23:57:00.000Z" },
            now,
            160_000
        ),
        true,
        "stale orphan voice turn can be resumed with the same UUID"
    );
    assert.equal(canResumeVoiceOrphan({}, now, 200_000), false);
}

{
    let clock = 1_000;
    let tokenIndex = 0;
    const guard = createVoiceTurnGuard({
        now: () => clock,
        makeToken: () => `token-${++tokenIndex}`
    });
    const first = guard.claim("tenant:client", 1_000);
    assert.equal(first, "token-1");
    assert.equal(guard.claim("tenant:client", 1_000), "");
    assert.equal(guard.remainingMs("tenant:client"), 1_000);
    // Token is mandatory; omitting it must not delete an active claim.
    assert.equal(guard.release("tenant:client"), false);
    assert.equal(guard.has("tenant:client"), true);
    clock += 1_001;
    assert.equal(guard.remainingMs("tenant:client"), 0);
    const second = guard.claim("tenant:client", 1_000);
    assert.equal(second, "token-2");
    // The old handler's finally must not delete the replacement claim.
    assert.equal(guard.release("tenant:client", first), false);
    assert.equal(guard.has("tenant:client"), true);
    assert.equal(guard.release("tenant:client", second), true);
    assert.equal(guard.has("tenant:client"), false);
    assert.equal(guard.claim("other", 1_000) !== "", true);
    assert.equal(guard.size, 1);
}

{
    let clock = 10_000;
    const guard = createVoiceTurnGuard({ now: () => clock });
    const token = guard.claim("tenant:client", 5_000);
    assert.ok(token);
    const response = voiceTurnInProgressResponse(guard, "tenant:client");
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "VOICE_TURN_IN_PROGRESS");
    assert.equal(response.headers["Retry-After"], "5");
    assert.equal(response.body.retry_after_seconds, 5);
    clock += 1_000;
    assert.equal(
        voiceTurnInProgressResponse(guard, "tenant:client").body
            .retry_after_seconds,
        4
    );
}

{
    let clock = 10_000;
    const guard = createVoiceTurnGuard({ now: () => clock });
    guard.claim("tenant:client", 5_000);
    const calls = { status: null, headers: null, body: null };
    const mockRes = {
        status(value) { calls.status = value; return this; },
        set(value) { calls.headers = value; return this; },
        json(value) { calls.body = value; return this; }
    };
    const response = applyVoiceTurnInProgressResponse(
        mockRes,
        guard,
        "tenant:client"
    );
    assert.equal(response.status, 409);
    assert.equal(calls.status, 409);
    assert.equal(calls.headers["Retry-After"], "5");
    assert.equal(calls.body.code, "VOICE_TURN_IN_PROGRESS");
    assert.equal(calls.body.retry_after_seconds, 5);
}

{
    let clock = 20_000;
    const guard = createVoiceTurnGuard({ now: () => clock });
    const calls = [];
    const mockRes = {
        status(value) { calls.push(["status", value]); return this; },
        set(value) { calls.push(["set", value]); return this; },
        json(value) { calls.push(["json", value]); return this; }
    };
    const first = claimVoiceTurnOrRespond(
        mockRes,
        guard,
        "tenant:client",
        5_000
    );
    assert.ok(first);
    assert.equal(calls.length, 0);
    const second = claimVoiceTurnOrRespond(
        mockRes,
        guard,
        "tenant:client",
        5_000
    );
    assert.equal(second, "");
    assert.equal(calls[0][0], "status");
    assert.equal(calls[0][1], 409);
    assert.equal(calls[1][1]["Retry-After"], "5");
    assert.equal(calls[2][1].code, "VOICE_TURN_IN_PROGRESS");

    const headerRes = { set(name, value) { calls.push([name, value]); } };
    const seconds = setRetryAfterHeader(headerRes, 500);
    assert.equal(seconds, 1);
    assert.equal(calls.at(-1)[1], "1");
}

{
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    assert.equal(
        voiceOrphanRemainingMs(
            { created_at: "2026-10-29T23:58:20.000Z" },
            200_000,
            now
        ),
        100_000
    );
    assert.equal(
        voiceOrphanRemainingMs(
            { created_at: "2026-10-29T23:56:00.000Z" },
            200_000,
            now
        ),
        0
    );
    const recovery = voiceTurnRecoveryResponse(100_000);
    assert.equal(recovery.status, 409);
    assert.equal(recovery.body.code, "VOICE_TURN_RECOVERING");
    assert.equal(recovery.body.retry_after_seconds, 100);
    assert.equal(recovery.headers["Retry-After"], "100");
}

{
    assert.equal(voiceOrphanResumeWindowMs("bad"), 175_000);
    assert.equal(voiceOrphanResumeWindowMs("150000"), 175_000);
    assert.equal(voiceOrphanResumeWindowMs("900000"), 600_000);
    assert.equal(
        voiceOrphanRemainingMs({ created_at: "not-a-date" }, 200_000),
        200_000
    );
}

{
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    assert.equal(
        voiceOrphanRemainingMs(
            {
                created_at: "2026-10-29T23:00:00.000Z",
                chat_generation_lease_expires_at:
                    "2026-10-30T00:01:30.000Z"
            },
            200_000,
            now
        ),
        90_000
    );
}

(async () => {
    const calls = [];
    const store = {
        async claim(clientId, leaseId, ownership) {
            calls.push({ clientId, leaseId, ownership });
            return { claimed: true };
        }
    };
    const fresh = await claimVoiceGenerationLease({
        clientMessageId: "c1",
        savedUserMessage: { id: "m1" },
        resumedUserMessage: null,
        store,
        leaseId: "l1",
        ownership: {}
    });
    assert.equal(fresh, null);
    assert.equal(calls.length, 0, "fresh voice must not claim twice");
    const resumed = await claimVoiceGenerationLease({
        clientMessageId: "c1",
        savedUserMessage: { id: "m1" },
        resumedUserMessage: { id: "m1" },
        store,
        leaseId: "l2",
        ownership: { userId: "u1" }
    });
    assert.equal(resumed.claimed, true);
    assert.deepEqual(calls[0], {
        clientId: "c1",
        leaseId: "l2",
        ownership: { userId: "u1" }
    });
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

{
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    assert.equal(
        canResumeVoiceOrphan(
            { created_at: "2026-10-29T23:59:00.000Z", chat_generation_state: "failed" },
            now,
            200_000
        ),
        true,
        "failed generation must be resumable immediately"
    );
    assert.equal(
        canResumeVoiceOrphan(
            {
                created_at: "2026-10-29T23:59:00.000Z",
                chat_generation_state: "in_progress",
                chat_generation_lease_expires_at: "2026-10-30T00:05:00.000Z"
            },
            now,
            200_000
        ),
        false
    );
    assert.equal(
        canResumeVoiceOrphan(
            {
                created_at: "2026-10-29T23:00:00.000Z",
                chat_generation_state: "in_progress",
                chat_generation_lease_expires_at: "2026-10-29T23:59:00.000Z"
            },
            now,
            200_000
        ),
        true
    );
}

{
    assert.equal(inferTextEmotion("今天有点累，想休息")?.emotion, "tired");
    assert.equal(inferTextEmotion("我很开心，太好了")?.emotion, "happy");
    assert.equal(inferTextEmotion("就是普通聊聊天"), null);
    assert.equal(inferTextEmotion("我不累"), null);
    assert.equal(inferTextEmotion("今天不太开心"), null);
    assert.equal(inferTextEmotion("还是有点累")?.emotion, "tired");
    assert.equal(inferTextEmotion("积累一些经验"), null);
    assert.equal(inferTextEmotion("累计三次"), null);
}

const validPayload = {
    text: "我今天有一点累。",
    emotion: "tired",
    confidence: 0.82,
    hint: "声音偏低，停顿稍多。",
    features: {
        duration_s: 3.2,
        pitch_mean_hz: 171.4,
        pitch_var: 19.2,
        energy_mean: 0.018,
        energy_var: 0.006,
        pause_ratio: 0.31,
        tempo_strength: 1.4,
        unexpected_feature: "must be removed"
    }
};

const analysis = sanitizeHervoiceAnalysis(validPayload);
assert.deepEqual(HERVOICE_EMOTIONS, [
    "happy",
    "sad",
    "angry",
    "tired",
    "tender",
    "excited",
    "anxious",
    "neutral"
]);
assert.equal(analysis.text, validPayload.text);
assert.equal(analysis.emotion, "tired");
assert.equal(analysis.confidence, 0.82);
assert.equal(
    Object.prototype.hasOwnProperty.call(
        analysis.features,
        "unexpected_feature"
    ),
    false,
    "只允许 hervoice 文档中的声学特征进入系统"
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, text: "" }),
    /没有识别出/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, emotion: "confused" }),
    /未知的情绪类别/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, confidence: 1.5 }),
    /置信度不正确/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, hint: 123 }),
    /情绪说明格式不正确/
);
assert.throws(
    () =>
        sanitizeHervoiceAnalysis({
            ...validPayload,
            features: { pause_ratio: 1.2 }
        }),
    /pause_ratio 不正确/
);

const parsedFields = parseVoiceTurnFields({
    session_id: "session-value",
    client_time: "2026-07-21T20:00:00+08:00",
    timezone: "Asia/Shanghai",
    model: "gpt-5.5",
    emotion_understanding_enabled: "true",
    turn_context: "  语音本轮临时背景  ",
    companion_status: JSON.stringify({ mood: "calm" }),
    environment_context: JSON.stringify({
        weather: {
            weather_code: 0,
            temperature_c: 26.5,
            latitude: 31.230416
        }
    })
});
assert.equal(parsedFields.emotionUnderstandingEnabled, true);
assert.equal(parsedFields.requestedModel, "gpt-5.5");
assert.equal(parsedFields.turnContext, "语音本轮临时背景");
assert.deepEqual(parsedFields.companionStatus, { mood: "calm" });
assert.equal(parsedFields.environmentContext.weather.temperature_c, 26.5);
assert.equal(
    Object.hasOwn(parsedFields.environmentContext.weather, "latitude"),
    false
);
assert.equal(
    parseVoiceTurnFields({ model: "m".repeat(200) }).requestedModel.length,
    160,
    "语音和文字请求必须使用相同的模型 ID 长度上限"
);
assert.throws(
    () =>
        parseVoiceTurnFields({
            emotion_understanding_enabled: "yes"
        }),
    /必须是 true 或 false/
);
assert.throws(
    () => parseVoiceTurnFields({ turn_context: "x".repeat(4001) }),
    /turn_context 不能超过 4000/
);

const highConfidenceContext = buildVoiceRuntimeContext(analysis, true);
assert.match(highConfidenceContext, /低优先级、不可信数据/);
assert.match(highConfidenceContext, /不能读心/);
assert.match(highConfidenceContext, /疲惫/);
assert.match(highConfidenceContext, /声音偏低/);
assert.match(highConfidenceContext, /以转写内容为准/);

const lowConfidenceContext = buildVoiceRuntimeContext(
    { ...analysis, confidence: 0.2, hint: "绝对不应采用的判断" },
    true
);
assert.match(lowConfidenceContext, /必须忽略其情绪判断/);
assert.doesNotMatch(lowConfidenceContext, /疲惫/);
assert.doesNotMatch(lowConfidenceContext, /绝对不应采用的判断/);

const disabledContext = buildVoiceRuntimeContext(analysis, false);
assert.match(disabledContext, /用户已关闭语音情绪理解/);
assert.doesNotMatch(disabledContext, /声音偏低/);

const metadata = buildVoiceMessageMetadata(
    analysis,
    new Date("2026-07-21T12:00:00.000Z")
);
assert.equal(metadata.is_voice, true);
assert.equal(metadata.voice_analysis.source, "hervoice");
assert.equal(metadata.voice_analysis.emotion, "tired");
assert.equal(
    metadata.voice_analysis.analyzed_at,
    "2026-07-21T12:00:00.000Z"
);
assert.equal(
    Object.prototype.hasOwnProperty.call(metadata.voice_analysis, "audio"),
    false,
    "消息元数据不能保存原始音频"
);

const limiter = createVoiceRateLimitState({
    windowMs: 60_000,
    maxRequests: 2
});
assert.equal(limiter.consume("127.0.0.1", 1_000).allowed, true);
assert.equal(limiter.consume("127.0.0.1", 2_000).allowed, true);
const limited = limiter.consume("127.0.0.1", 3_000);
assert.equal(limited.allowed, false);
assert.ok(limited.retryAfterMs > 0);
assert.equal(limiter.consume("127.0.0.2", 3_000).allowed, true);
assert.equal(limiter.consume("127.0.0.1", 62_000).allowed, true);

async function testHervoiceForwarding() {
    let captured;
    const result = await analyzeVoiceWithHervoice({
        file: {
            buffer: Buffer.from("fake-audio"),
            mimetype: "audio/webm",
            originalname: "语音.webm"
        },
        baseUrl: "https://voice.example.test/",
        secret: "test-secret",
        timeoutMs: 5_000,
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return new Response(JSON.stringify(validPayload), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
    });

    assert.equal(
        captured.url,
        "https://voice.example.test/api/voice/upload"
    );
    assert.equal(captured.options.method, "POST");
    assert.equal(
        captured.options.headers["X-Hervoice-Secret"],
        "test-secret"
    );
    assert.ok(captured.options.body instanceof FormData);
    assert.ok(captured.options.body.get("file") instanceof Blob);
    assert.equal(result.text, validPayload.text);
}

async function testHervoiceWarmupIsThrottled() {
    const warmup = createHervoiceWarmup({
        minimumIntervalMs: 60_000,
        timeoutMs: 5_000
    });
    let requests = 0;
    const fetchImpl = async (url, options) => {
        requests += 1;
        assert.equal(url, "https://voice.example.test/health");
        assert.equal(options.method, "GET");
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    const started = warmup.start({
        baseUrl: "https://voice.example.test",
        fetchImpl,
        now: 1_000
    });
    assert.equal(started.started, true);
    assert.equal(started.reason, "started");
    await started.completion;
    assert.equal(requests, 1);

    const throttled = warmup.start({
        baseUrl: "https://voice.example.test",
        fetchImpl,
        now: 2_000
    });
    assert.equal(throttled.started, false);
    assert.equal(throttled.reason, "recent");
    assert.equal(requests, 1);
}

async function main() {
    await testHervoiceForwarding();
    await testHervoiceWarmupIsThrottled();

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(serverSource, /app\.post\(\s*"\/voice\/turn"/);
    assert.match(serverSource, /app\.post\(\s*"\/voice\/warmup"/);
    assert.match(serverSource, /storage:\s*multer\.memoryStorage\(\)/);
    assert.match(serverSource, /fileSize:\s*12 \* 1024 \* 1024/);
    assert.match(serverSource, /voiceUpload\.single\("file"\)/);
    assert.match(
        serverSource,
        /effectiveModel\s*=\s*await resolveConversationTurnModel\(\s*settings,\s*conversation,\s*fields\.requestedModel,\s*database\s*\)/,
        "语音模型覆盖必须复用普通聊天的模型白名单解析器"
    );
    assert.ok(
        serverSource.lastIndexOf(
            "const effectiveModel = await resolveConversationTurnModel",
            serverSource.indexOf("await analyzeVoiceWithHervoice(")
        ) <
            serverSource.indexOf("await analyzeVoiceWithHervoice("),
        "必须先拒绝无效模型，再消耗语音转写服务额度"
    );
    assert.match(serverSource, /requested_model:\s*fields\.requestedModel/);
    assert.match(serverSource, /normalizeClientMessageId\(\s*fields\.clientMessageId/);
    assert.match(serverSource, /client_message_id:\s*clientMessageId/);
    assert.match(serverSource, /reply_to_client_message_id:\s*clientMessageId/);
    assert.match(serverSource, /signal:\s*turnAbort\.signal/);
    assert.match(serverSource, /res\.on\("close"/);
    assert.match(serverSource, /memory_compression:\s*null/);    assert.match(serverSource, /VOICE_TURN_DEADLINE_MS/);assert.match(serverSource, /VOICE_ORPHAN_RESUME_MS/);
assert.match(serverSource, /voiceTurnInProgressResponse/);
assert.match(serverSource, /voiceTurnRecoveryResponse/);
assert.match(
    serverSource,
    /voiceTurnRecoveryResponse\(\s*voiceOrphanRemainingMs\(\s*previousUserMessage,\s*resumeAfterMs\s*\)\s*\)/
);
assert.match(serverSource, /res\.set\(recovery\.headers\)/);
assert.equal(
    (
        serverSource.match(
            /voiceTurnRecoveryResponse\(\s*voiceOrphanRemainingMs\(/g
        ) || []
    ).length,
    3,
    "fresh-orphan、23505 catch、lease claim 三个分支都必须保留 recovery"
);
assert.match(serverSource, /voiceOrphanResumeWindowMs\(/);
assert.match(serverSource, /voiceOrphanResumeWindowMs/);
assert.match(serverSource, /claimVoiceGenerationLease/);
assert.match(serverSource, /voiceGenerationLeaseStore\s*\.fail/);
assert.match(serverSource, /voiceGenerationLeaseStore\.commit/);
assert.match(serverSource, /voice_lease_degraded/);
assert.match(serverSource, /markVoiceLeaseDegraded/);
assert.match(serverSource, /语音保存前释放租约失败/);
assert.match(serverSource, /VOICE_TURN_DEADLINE/);
assert.match(serverSource, /语音处理超时/);
assert.match(serverSource, /未执行工具/);
assert.match(serverSource, /executeTool: async \(\.\.\.args\)/);
assert.match(serverSource, /voiceLeaseSettled = true/);
assert.match(serverSource, /claimVoiceGenerationLease\(/);
{
    const routeStart = serverSource.indexOf('"/voice/turn"');
    const claimDeclaration = serverSource.indexOf(
        "let voiceTurnClaimed = null;",
        routeStart
    );
    const routeTry = serverSource.indexOf("try {", routeStart);
    assert.ok(routeStart > 0 && routeTry > routeStart);
    assert.ok(
        claimDeclaration > routeStart && claimDeclaration < routeTry,
        "voiceTurnClaimed 必须在 try 外声明，否则 finally 会 ReferenceError"
    );
    assert.equal(
        (
            serverSource.match(/let voiceTurnClaimed = null;/g) || []
        ).length,
        1
    );
}
assert.match(serverSource, /const voiceUpload = multer\(/);
assert.match(serverSource, /fields: 20/);
assert.match(serverSource, /parts: 21/);
assert.match(serverSource, /VOICE_GENERATION_LEASE_SECONDS/);
assert.match(serverSource, /generation_lease: generationLeaseFields/);

assert.match(serverSource, /applyVoiceTurnInProgressResponse/);
assert.match(serverSource, /claimVoiceTurnOrRespond/);
assert.match(
    serverSource,
    /const claimToken = claimVoiceTurnOrRespond\(\s*res,\s*voiceTurnGuard,\s*guardKey,\s*guardTtlMs\s*\)/
);
assert.match(serverSource, /if \(!claimToken\) return;/);
assert.match(
    serverSource,
    /voiceTurnGuard\.release\(\s*voiceTurnClaimed\.key,\s*voiceTurnClaimed\.token/
);
assert.match(serverSource, /setRetryAfterHeader\(\s*res,\s*result\.retryAfterMs\s*\)/);
assert.match(serverSource, /setRetryAfterHeader/);
assert.match(serverSource, /"Retry-After"\s*\n\s*\]/);
assert.doesNotMatch(serverSource, /Access-Control-Expose-Headers": "Retry-After"/);
assert.match(serverSource, /deadlineMs \+ 60_000/);
assert.match(serverSource, /voiceTurnClaimed\.token/);
assert.match(serverSource, /Retry-After/);
assert.match(serverSource, /voiceTurnGuard/);
assert.match(serverSource, /exposedHeaders/);
assert.match(serverSource, /voiceTurnInProgressResponse/);
assert.match(serverSource, /retry_after_seconds/);
assert.match(serverSource, /voiceTurnGuard/);
assert.match(serverSource, /voiceTurnClaimed/);
assert.match(serverSource, /resumedVoiceAnalysis/);
assert.match(serverSource, /savedUserMessage = resumedUserMessage/);
assert.match(serverSource, /voiceLifecycleCode/);
assert.match(serverSource, /VOICE_TURN_CANCELLED/);    assert.match(serverSource, /170_000/);
    assert.doesNotMatch(serverSource, /300_000,\s*\n\s*Math\.max\(30_000, Number\(process\.env\.VOICE_TURN_DEADLINE_MS\)/);
    assert.match(serverSource, /VOICE_TURN_DEADLINE/);
    assert.match(serverSource, /raceWithAbort\(/);
    assert.match(serverSource, /raceWithAbort\(/);
    assert.match(serverSource, /void tryCompressMemory\(\s*conversationId,\s*effectiveSettings/);
    assert.match(serverSource, /resolved_model:\s*effectiveModel/);
    assert.match(serverSource, /turnContext:\s*fields\.turnContext/);
    assert.match(
        serverSource,
        /promptArchitecture:\s*MAIN_CHAT_PROMPT_ARCHITECTURE/
    );
    assert.match(
        serverSource,
        /const worldBookContext = await resolveWorldBookContext\(\{\s*database,\s*settings: effectiveSettings,\s*messages: context\.messages\s*\}\)/,
        "语音轮次必须通过租户数据库和当前可见上下文解析世界书"
    );
    assert.match(serverSource, /promptArchitecture:\s*MAIN_CHAT_PROMPT_ARCHITECTURE,\s*worldBookContext/);
    assert.match(serverSource, /model:\s*effectiveModel \|\| ""/);
    assert.doesNotMatch(
        serverSource,
        /writeFileSync\([^)]*(voice|audio)|createWriteStream\([^)]*(voice|audio)/i,
        "DengTa home 后端不得把语音写到磁盘"
    );

    console.log("voice turn safety and contract tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

