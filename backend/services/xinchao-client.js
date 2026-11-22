"use strict";

// Optional, tenant-scoped bridge from DengTa to a self-hosted Xinchao instance.
// The bridge is deliberately fail-open: Xinchao being slow, down, or
// misconfigured must never block a chat reply or a proactive-message job.
const DEFAULT_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 60 * 1000;

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function normalizedId(value) {
    return String(value ?? "").trim().toLowerCase();
}

function createXinchaoClient({
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = Date.now
} = {}) {
    const baseUrl = String(env.XINCHAO_BASE_URL || "")
        .trim()
        .replace(/\/+$/, "");
    const token = String(env.XINCHAO_TOKEN || "").trim();
    const gatewayBaseUrl = String(env.XINCHAO_TENANT_GATEWAY_URL || "")
        .trim()
        .replace(/\/+$/, "");
    const gatewayToken = String(env.XINCHAO_TENANT_GATEWAY_TOKEN || "").trim();
    const gatewayEnabled = Boolean(gatewayBaseUrl && gatewayToken);
    const ownerUserId = normalizedId(env.XINCHAO_OWNER_USER_ID);
    const ownerCompanionId = normalizedId(env.XINCHAO_OWNER_COMPANION_ID);
    const legacyEnabled = Boolean(
        baseUrl && token && ownerUserId && ownerCompanionId
    );
    const enabled = gatewayEnabled || legacyEnabled;
    const tenantIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
    const tenantPairPattern = /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/;
    const timeoutMs = Math.min(
        5000,
        Math.max(
            300,
            Number(env.XINCHAO_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
        )
    );
    const cachedTextByTenant = new Map();
    let cachedText = "";
    let cachedAt = 0;

    function gatewayTenant(scope) {
        const userId = String(scope?.userId || "").trim();
        const companionId = String(scope?.companionId || "").trim();
        if (
            !tenantIdPattern.test(userId) ||
            !tenantIdPattern.test(companionId)
        ) {
            return "";
        }
        const pair = `${userId}:${companionId}`;
        return tenantPairPattern.test(pair) ? pair : "";
    }

    function requestContext(scope) {
        if (gatewayEnabled) {
            const tenant = gatewayTenant(scope);
            return tenant
                ? {
                      base: gatewayBaseUrl,
                      headers: {
                          Authorization: `Bearer ${gatewayToken}`,
                          "X-Tenant-Id": tenant
                      },
                      cacheKey: tenant
                  }
                : null;
        }
        if (!legacyEnabled) return null;
        if (
            normalizedId(scope?.userId) !== ownerUserId ||
            normalizedId(scope?.companionId) !== ownerCompanionId
        ) {
            return null;
        }
        return {
            base: baseUrl,
            headers: { Authorization: `Bearer ${token}` },
            cacheKey: ""
        };
    }

    function scopeMatches(scope) {
        return Boolean(
            enabled &&
            typeof fetchImpl === "function" &&
            requestContext(scope)
        );
    }

    async function loadNow(scope) {
        const context = requestContext(scope);
        if (!context) return "";
        const cachedTenantText = context.cacheKey
            ? cachedTextByTenant.get(context.cacheKey) || ""
            : cachedText;
        const cachedTenantAt = context.cacheKey
            ? cachedTextByTenant.get(`${context.cacheKey}:at`) || 0
            : cachedAt;
        const currentTime = Number(now());
        if (
            cachedTenantText &&
            Number.isFinite(cachedTenantAt) &&
            currentTime - cachedTenantAt < CACHE_TTL_MS
        ) {
            return cachedTenantText;
        }
        try {
            const response = await fetchImpl(`${context.base}/v1/now`, {
                method: "GET",
                headers: {
                    ...context.headers,
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!response?.ok) return cachedTenantText;
            const payload = await response.json();
            const text = cleanText(payload?.text, 4000);
            if (text) {
                if (context.cacheKey) {
                    cachedTextByTenant.set(context.cacheKey, text);
                    cachedTextByTenant.set(`${context.cacheKey}:at`, currentTime);
                } else {
                    cachedText = text;
                    cachedAt = currentTime;
                }
            }
            return text;
        } catch {
            return cachedTenantText;
        }
    }

    async function loadState(scope) {
        const context = requestContext(scope);
        if (!context) return null;
        try {
            const response = await fetchImpl(`${context.base}/v1/state`, {
                method: "GET",
                headers: {
                    ...context.headers,
                    Accept: "application/json"
                },
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (!response?.ok) return null;
            const payload = await response.json();
            const drives = {};
            for (const [key, value] of Object.entries(payload?.drives || {})) {
                const number = Number(value);
                if (Number.isFinite(number)) {
                    drives[key] = Math.max(0, Math.min(1, number));
                }
            }
            const emotion = payload?.emotion || {};
            return {
                revision: Number(payload?.revision) || 0,
                consciousness: cleanText(payload?.consciousness, 40),
                lastConversationAt: cleanText(
                    payload?.lastConversationAt,
                    40
                ),
                drives,
                emotion: {
                    label: cleanText(emotion.label, 40),
                    valence: Number(emotion.valence) || 0,
                    arousal: Number(emotion.arousal) || 0
                }
            };
        } catch {
            return null;
        }
    }

    async function recordExchange({
        scope,
        userMessage,
        assistantMessage,
        messageId
    }) {
        const context = requestContext(scope);
        if (!context) return { skipped: true };
        const user = cleanText(userMessage, 3000);
        const assistant = cleanText(assistantMessage, 3000);
        if (!user || !assistant) return { skipped: true };
        const eventId = `dengta-turn:${cleanText(messageId, 100)}`;
        const exchange = `${`她说：${user}`}\n${`他回：${assistant}`}`;
        try {
            const response = await fetchImpl(
                `${context.base}/v1/conversation-event`,
                {
                    method: "POST",
                    headers: {
                        ...context.headers,
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify({
                        event_id: eventId,
                        exchange: exchange.slice(0, 1500)
                    }),
                    signal: AbortSignal.timeout(timeoutMs)
                }
            );
            return { sent: Boolean(response?.ok), status: response?.status };
        } catch {
            return { sent: false };
        }
    }

    return {
        enabled,
        loadNow,
        loadState,
        recordExchange,
        scopeMatches
    };
}

module.exports = {
    createXinchaoClient
};
