const dns = require("node:dns").promises;
const net = require("node:net");

const DEFAULT_OPENAI_TTS_BASE_URL = "https://api.openai.com";
const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_MAX_CHARS = 4000;
const OPENAI_TTS_MAX_BYTES = 10 * 1024 * 1024;
const OPENAI_TTS_VOICES = Object.freeze([
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse"
]);

function openAiSpeechError(message, status = 502, code = "OPENAI_TTS_UPSTREAM_ERROR") {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.isVoiceProviderError = true;
    return error;
}

function normalizeOpenAiVoice(value) {
    const voice = String(value || "").trim().toLowerCase();
    return OPENAI_TTS_VOICES.includes(voice) ? voice : "alloy";
}

function isPrivateNetworkAddress(value) {
    const host = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (net.isIP(host) === 6) {
        const normalized = host.toLowerCase();
        return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.") || normalized.startsWith("::ffff:169.254.");
    }
    if (net.isIP(host) === 4) {
        const [a, b] = host.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    return false;
}

function normalizeOpenAiBaseUrl(value) {
    const raw = String(value || DEFAULT_OPENAI_TTS_BASE_URL).trim().replace(/\/+$/, "");
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw openAiSpeechError("自定义 TTS 接口地址格式不正确。", 400, "OPENAI_TTS_BASE_URL_INVALID");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
        throw openAiSpeechError("自定义 TTS 接口必须是公开 HTTPS 地址。", 400, "OPENAI_TTS_BASE_URL_INVALID");
    }
    const host = parsed.hostname.toLowerCase();
    if (host.includes(":") || host.startsWith("[")) {
        throw openAiSpeechError("自定义 TTS 接口不能指向 IPv6 地址。", 400, "OPENAI_TTS_BASE_URL_PRIVATE");
    }
    if (isPrivateNetworkAddress(host)) {
        throw openAiSpeechError("自定义 TTS 接口不能指向本机或内网。", 400, "OPENAI_TTS_BASE_URL_PRIVATE");
    }
    return parsed.href.replace(/\/+$/, "");
}

async function assertSafeOpenAiBaseUrl(value) {
    const normalized = normalizeOpenAiBaseUrl(value);
    const host = new URL(normalized).hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host)) return normalized;
    let addresses;
    try {
        addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
        throw openAiSpeechError("自定义 TTS 接口无法解析。", 400, "OPENAI_TTS_BASE_URL_UNRESOLVED");
    }
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => isPrivateNetworkAddress(entry.address))) {
        throw openAiSpeechError("自定义 TTS 接口解析到了私有地址。", 400, "OPENAI_TTS_BASE_URL_PRIVATE");
    }
    return normalized;
}



function normalizeOpenAiModel(value) {
    const model = String(value || DEFAULT_OPENAI_TTS_MODEL).trim();
    return model.slice(0, 160) || DEFAULT_OPENAI_TTS_MODEL;
}

function normalizeOpenAiSpeed(value) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(1.5, Math.max(0.7, number))
        : 1;
}

async function synthesizeOpenAiSpeech({
    text,
    apiKey,
    voice,
    speed,
    baseUrl,
    model,
    timeoutMs = 45_000,
    fetchImpl = fetch
}) {
    const speechText = Array.from(String(text || "").trim())
        .slice(0, OPENAI_TTS_MAX_CHARS)
        .join("");
    if (!speechText) {
        throw openAiSpeechError("这条回复没有可朗读的文字。", 400, "VOICE_TEXT_REQUIRED");
    }
    if (!String(apiKey || "").trim()) {
        throw openAiSpeechError("OpenAI 语音接口尚未配置 API Key。", 503, "OPENAI_TTS_CREDENTIAL_REQUIRED");
    }
    const normalizedBase = await assertSafeOpenAiBaseUrl(baseUrl);
    const endpoint = normalizedBase.endsWith("/v1")
        ? normalizedBase + "/audio/speech"
        : normalizedBase + "/v1/audio/speech";
    const ttsModel = normalizeOpenAiModel(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${String(apiKey).trim()}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: ttsModel,
                    voice: normalizeOpenAiVoice(voice),
                    input: speechText,
                    speed: normalizeOpenAiSpeed(speed),
                    response_format: "mp3"
                }),
                signal: controller.signal,
                redirect: "manual"
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw openAiSpeechError("OpenAI 语音生成等待超时，请稍后重试。", 504, "OPENAI_TTS_TIMEOUT");
            }
            throw openAiSpeechError("无法连接 OpenAI 语音服务，请稍后重试。", 502, "OPENAI_TTS_UNREACHABLE");
        }
        if (response.status >= 300 && response.status < 400) {
            throw openAiSpeechError(
                "自定义 TTS 接口不允许重定向。",
                400,
                "OPENAI_TTS_BASE_URL_REDIRECT"
            );
        }
        if (!response.ok) {
            let detail = "";
            try { detail = await response.text(); } catch {}
            const status = response.status === 429 ? 429 : 502;
            throw openAiSpeechError(
                response.status === 401
                    ? "OpenAI 语音 API Key 无效或已失效。"
                    : response.status === 429
                      ? "OpenAI 语音请求太频繁或额度不足，请稍后重试。"
                      : `OpenAI 语音服务暂时不可用（HTTP ${response.status}）。`,
                status,
                "OPENAI_TTS_UPSTREAM_ERROR"
            );
        }
        const contentType = String(response.headers?.get?.("content-type") || "audio/mpeg").split(";")[0];
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) {
            throw openAiSpeechError("OpenAI 语音服务没有返回音频。", 502, "OPENAI_TTS_EMPTY_AUDIO");
        }
        if (buffer.length > OPENAI_TTS_MAX_BYTES) {
            throw openAiSpeechError("OpenAI 语音音频超过大小限制。", 502, "OPENAI_TTS_AUDIO_TOO_LARGE");
        }
        return {
            audio: buffer,
            contentType: contentType.startsWith("audio/") ? contentType : "audio/mpeg",
            provider: "openai",
            model: ttsModel,
            voice: normalizeOpenAiVoice(voice),
            emotion: ""
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    DEFAULT_OPENAI_TTS_BASE_URL,
    assertSafeOpenAiBaseUrl,
    isPrivateNetworkAddress,
    DEFAULT_OPENAI_TTS_MODEL,
    OPENAI_TTS_MAX_CHARS,
    OPENAI_TTS_VOICES,
    normalizeOpenAiBaseUrl,
    normalizeOpenAiModel,
    normalizeOpenAiVoice,
    synthesizeOpenAiSpeech
};
