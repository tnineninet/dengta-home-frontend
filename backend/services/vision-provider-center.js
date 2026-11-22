const {
    assertPublicMcpEndpoint,
    decryptCredential,
    encryptCredential
} = require("./mcp-device-center");
const { describeImageWithDebug } = require("./vision-describe");

const NAME_MAX = 80;
const URL_MAX = 1000;
const MODEL_MAX = 160;
const API_KEY_MAX = 2000;

class VisionProviderError extends Error {
    constructor(message, code, status = 400) {
        super(message);
        this.name = "VisionProviderError";
        this.code = code;
        this.status = status;
    }
}

function cleanText(value, max) {
    return Array.from(String(value ?? "").trim()).slice(0, max).join("");
}

function normalizeBaseUrl(value) {
    return cleanText(value, URL_MAX).replace(/\/+$/, "");
}

function publicProfile(row) {
    if (!row) {
        return {
            configured: false,
            enabled: false,
            name: "自定义视觉接口",
            base_url: "",
            model: "",
            auth_type: "bearer",
            has_secret: false,
            last_status: "untested",
            last_error_code: null,
            last_checked_at: null
        };
    }
    return {
        configured: true,
        enabled: row.enabled === true,
        name: row.name || "自定义视觉接口",
        base_url: row.base_url || "",
        model: row.model || "",
        auth_type: row.auth_type === "none" ? "none" : "bearer",
        has_secret: Boolean(row.secret_ciphertext),
        last_status: ["untested", "configuration_ok", "connected", "error"].includes(row.last_status)
            ? row.last_status
            : "untested",
        last_error_code: row.last_error_code || null,
        last_checked_at: row.last_checked_at || null
    };
}

async function readProfile(database) {
    const { data, error } = await database
        .from("vision_provider_profiles")
        .select("*")
        .maybeSingle();
    if (error) {
        if (
            error.code === "42P01" ||
            error.code === "PGRST205" ||
            /vision_provider_profiles.*does not exist|could not find.*vision_provider_profiles/i.test(String(error.message || ""))
        ) {
            return null;
        }
        throw error;
    }
    return data || null;
}

async function saveProfile(database, body = {}) {
    const current = await readProfile(database);
    const baseUrl = normalizeBaseUrl(body.base_url);
    const model = cleanText(body.model, MODEL_MAX);
    const name = cleanText(body.name, NAME_MAX) || "自定义视觉接口";
    const authType = body.auth_type === "none" ? "none" : "bearer";
    const enabled = body.enabled === true;
    if (!baseUrl) throw new VisionProviderError("请填写视觉接口地址。", "VISION_BASE_URL_REQUIRED");
    if (!model) throw new VisionProviderError("请填写视觉模型名称。", "VISION_MODEL_REQUIRED");
    try {
        await assertPublicMcpEndpoint(baseUrl);
    } catch (error) {
        throw new VisionProviderError(
            error?.message || "视觉接口地址不可访问。",
            "VISION_ENDPOINT_INVALID"
        );
    }
    const submittedKey = String(body.api_key || "").trim();
    const existingKey = current?.secret_ciphertext || "";
    if (enabled && authType === "bearer" && !submittedKey && !existingKey) {
        throw new VisionProviderError("启用前请填写 API Key。", "VISION_API_KEY_REQUIRED");
    }
    const values = {
        name,
        base_url: baseUrl,
        auth_type: authType,
        model,
        enabled,
        secret_ciphertext: submittedKey
            ? encryptCredential(submittedKey)
            : existingKey,
        updated_at: new Date().toISOString()
    };
    if (current) {
        const { data, error } = await database
            .from("vision_provider_profiles")
            .update(values)
            .eq("id", current.id)
            .select("*")
            .single();
        if (error) throw error;
        return publicProfile(data);
    }
    const { data, error } = await database
        .from("vision_provider_profiles")
        .insert(values)
        .select("*")
        .single();
    if (error) throw error;
    return publicProfile(data);
}

async function resolveVisionConfig(database) {
    let row = null;
    try {
        row = await readProfile(database);
    } catch {
        return null;
    }
    if (!row || row.enabled !== true) return null;
    const baseUrl = normalizeBaseUrl(row.base_url);
    const model = cleanText(row.model, MODEL_MAX);
    if (!baseUrl || !model) return null;
    let apiKey = "";
    if (row.auth_type !== "none" && row.secret_ciphertext) {
        try {
            apiKey = decryptCredential(row.secret_ciphertext);
        } catch {
            return null;
        }
    }
    if (row.auth_type !== "none" && !apiKey) return null;
    return {
        apiKey,
        baseUrl,
        model,
        maxTokens: 1024,
        timeoutMs: 60000
    };
}

async function testProfile(database) {
    const config = await resolveVisionConfig(database);
    if (!config) {
        throw new VisionProviderError("请先启用并保存视觉接口。", "VISION_NOT_CONFIGURED");
    }
    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3ZkAAAAASUVORK5CYII=",
        "base64"
    );
    const result = await describeImageWithDebug(png, "image/png", config);
    const row = await readProfile(database);
    if (row) {
        const status = result.text ? "connected" : "error";
        await database
            .from("vision_provider_profiles")
            .update({
                last_status: status,
                last_error_code: result.text ? null : "vision_provider_test_failed",
                last_checked_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", row.id);
    }
    return {
        ok: Boolean(result.text),
        message: result.text
            ? "视觉接口已连通。"
            : "视觉接口未返回可见描述，请检查地址、模型和 API Key。",
        http_status: result.debug?.httpStatus || null
    };
}

module.exports = {
    VisionProviderError,
    publicProfile,
    readProfile,
    resolveVisionConfig,
    saveProfile,
    testProfile
};
