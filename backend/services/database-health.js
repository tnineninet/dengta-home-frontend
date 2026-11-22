"use strict";

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_MS = 15000;

function boundedTimeout(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, parsed));
}

function createDatabaseHealthCheck({
    readOnce,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheMs = DEFAULT_CACHE_MS,
    now = Date.now
} = {}) {
    if (typeof readOnce !== "function") {
        throw new TypeError("readOnce must be a function");
    }
    const normalizedTimeout = boundedTimeout(timeoutMs);
    const normalizedCache = Math.max(0, Number(cacheMs) || 0);
    let cached = null;
    let inFlight = null;

    async function run() {
        const startedAt = now();
        let timer = null;
        const controller = new AbortController();
        try {
            await Promise.race([
                Promise.resolve().then(() => readOnce(controller.signal)),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        const error = new Error("database health query timed out");
                        error.name = "AbortError";
                        reject(error);
                    }, normalizedTimeout);
                })
            ]);
            return {
                ok: true,
                dependency: "database",
                status: "up",
                latencyMs: Math.max(0, now() - startedAt)
            };
        } catch (error) {
            const timedOut =
                error?.name === "AbortError" ||
                /timed out/i.test(String(error?.message || ""));
            return {
                ok: false,
                dependency: "database",
                status: "down",
                reason: timedOut ? "timeout" : "query_failed",
                latencyMs: Math.max(0, now() - startedAt),
                logMessage: String(error?.message || error || "unknown error").slice(
                    0,
                    300
                )
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    return async function check() {
        const current = now();
        if (cached && current - cached.at < normalizedCache) {
            return cached.result;
        }
        if (inFlight) return inFlight;
        inFlight = run()
            .then((result) => {
                cached = { at: now(), result };
                return result;
            })
            .finally(() => {
                inFlight = null;
            });
        return inFlight;
    };
}

function publicDatabaseHealth(result, date = new Date()) {
    if (result.ok) {
        return { ...result, time: date.toISOString() };
    }
    return {
        ok: false,
        dependency: "database",
        status: "down",
        error: "Database dependency down",
        reason: result.reason,
        time: date.toISOString()
    };
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    DEFAULT_CACHE_MS,
    boundedTimeout,
    createDatabaseHealthCheck,
    publicDatabaseHealth
};
