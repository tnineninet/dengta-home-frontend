// kiwi-mem 多租户记忆网关客户端（独立记忆接口模式）
// ============================================================
// 聊天请求仍发往各租户自定义的 AI 供应商（中转站地址由租户自定，不受影响）；
// 记忆系统独立走 kiwi-mem 的 /memory/* 接口：
//   1. 加载聊天上下文时召回该租户的记忆（recallMemories）→ 注入提示词
//   2. 每轮对话结束后上报本轮内容（reportChatTurn）→ kiwi-mem 按间隔自动提取记忆
//
// 配置（后端环境变量）：
//   KIWI_MEM_URL   = http://服务器IP:8080（记忆网关地址；不设置 = 禁用）
//   KIWI_MEM_TOKEN = 与网关 MEMORY_API_TOKEN 一致的 Bearer Token
//
// 所有调用带 3 秒超时 + 失败静默降级：kiwi-mem 不可用时聊天完全不受影响。

const KIWI_MEM_URL = String(process.env.KIWI_MEM_URL || '').replace(/\/+$/, '');
const KIWI_MEM_TOKEN = String(process.env.KIWI_MEM_TOKEN || '');
const KIWI_MEM_TIMEOUT_MS = Number(process.env.KIWI_MEM_TIMEOUT_MS || 3000);
const KIWI_MEM_RECALL_LIMIT = Number(process.env.KIWI_MEM_RECALL_LIMIT || 8);
// Process-local observability for the two soft-dependency paths. These values
// are never written to prompts or memory; they only make silent failures
// visible in the health receipt.
const runtimeDiagnostics = {
    recall: { at: null, ok: null, error: null, count: 0 },
    report: { at: null, ok: null, error: null, count: 0 }
};
function rememberDiagnostic(kind, result, count = 0) {
    const target = runtimeDiagnostics[kind];
    target.at = new Date().toISOString();
    target.ok = result?.ok !== false;
    target.error = target.ok ? null : String(result?.error || 'unknown');
    target.count = Math.max(0, Number(count) || 0);
}
function kiwiMemoryDiagnostics() {
    return JSON.parse(JSON.stringify(runtimeDiagnostics));
}

function tenantIdFor(tenant) {
    const parts = [tenant?.userId, tenant?.companionId];
    if (!parts.every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) return null;
    return parts.join(':');
}

async function gatewayResult(response, tenantId) {
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: `kiwi_mem_http_${response.status}` };
    if (response.headers.get('X-Tenant-Id') !== tenantId) {
        return { ok: false, status: response.status, error: 'kiwi_mem_tenant_unverified' };
    }
    if (response.status === 204) return { ok: true, status: 204, data: {} };
    if (!data || typeof data !== 'object' || data.ok === false || data.error) {
        return { ok: false, status: response.status, error: data?.error === 'memory_disabled' ? 'kiwi_mem_memory_disabled' : 'kiwi_mem_invalid_response' };
    }
    return { ok: true, status: response.status, data };
}

function memoryGatewayEnabled() {
    return Boolean(KIWI_MEM_URL);
}

async function request(path, body, tenant, timeoutMs = KIWI_MEM_TIMEOUT_MS, method = 'POST') {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: 'kiwi_mem_disabled' };
    }
    const tenantId = tenantIdFor(tenant);
    if (!tenantId) return { ok: false, error: 'kiwi_mem_tenant_required' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(KIWI_MEM_TOKEN
                ? { Authorization: 'Bearer ' + KIWI_MEM_TOKEN }
                : {})
        };
        // 租户识别：user_id:companion_id，kiwi-mem 按此隔离记忆库
        headers['X-Tenant-Id'] = tenantId;
        const response = await fetch(KIWI_MEM_URL + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body || {}),
            signal: controller.signal
        });
        return await gatewayResult(response, tenantId);
    } catch (error) {
        return {
            ok: false,
            error:
                error?.name === 'AbortError'
                    ? 'timeout'
                    : 'kiwi_mem_network_error'
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 语义检索该租户的记忆（RRF：向量+关键词，召回会升温）。
 * 返回与 DengTa memories 表兼容形状的数组（可并进注入列表）。
 */
// GET 请求（kiwi /admin/* 状态端点用；带租户头与鉴权）
async function getRequest(path, tenant, timeoutMs = KIWI_MEM_TIMEOUT_MS) {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: "kiwi_mem_disabled" };
    }
    const tenantId = tenantIdFor(tenant);
    if (!tenantId) return { ok: false, error: 'kiwi_mem_tenant_required' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = {
            ...(KIWI_MEM_TOKEN
                ? { Authorization: "Bearer " + KIWI_MEM_TOKEN }
                : {})
        };
        headers['X-Tenant-Id'] = tenantId;
        const response = await fetch(KIWI_MEM_URL + path, {
            method: "GET",
            headers,
            signal: controller.signal
        });
        return await gatewayResult(response, tenantId);
    } catch (error) {
        return {
            ok: false,
            error:
                error?.name === "AbortError"
                    ? "timeout"
                    : 'kiwi_mem_network_error'
        };
    } finally {
        clearTimeout(timer);
    }
}

async function recallMemories(query, tenant, { limit = KIWI_MEM_RECALL_LIMIT } = {}) {
    if (!KIWI_MEM_URL) return [];
    if (!query || !String(query).trim()) return [];
    const result = await request(
        '/memory/recall',
        { query: String(query).slice(0, 2000), limit },
        tenant
    );
    if (!result.ok || !Array.isArray(result.data?.memories) || !result.data.memories.every(memory =>
        memory && typeof memory === 'object' && memory.id !== undefined &&
        (memory.content === undefined || typeof memory.content === 'string') &&
        (memory.title === undefined || typeof memory.title === 'string')
    )) {
        rememberDiagnostic('recall', { ok: false, error: result.error || 'kiwi_mem_recall_invalid_response' });
        if (result.error !== 'kiwi_mem_disabled') {
            console.error('kiwi_mem_recall_failed', {
                error: result.error || 'kiwi_mem_recall_invalid_response',
                status: result.status || null
            });
        }
        return [];
    }
    rememberDiagnostic('recall', { ok: true }, result.data.memories.length);
    return result.data.memories.map((memory) => ({
        id: 'kiwi-' + memory.id,
        summary: [memory.title, memory.content]
            .filter(Boolean)
            .join('：'),
        created_at: memory.created_at || new Date().toISOString(),
        updated_at: memory.created_at || new Date().toISOString(),
        locked: Boolean(memory.is_permanent),
        source: 'kiwi-mem',
        importance: Number(memory.importance) || 5,
        heat: Number(memory.heat) || 0,
        category_name: memory.category_name || '',
        emotional_weight: Number(memory.emotional_weight) || 0
    }));
}

/**
 * 只读列出当前租户的网关记忆，用于 DengTa 记忆页展示。网关的 debug 读取
 * 端点本身带租户 schema 上下文；这里只允许经登录后后端代理调用。
 */
async function listMemories({ tenant, limit = 20, offset = 0, query = "", timeoutMs = 8000 } = {}) {
    if (!KIWI_MEM_URL) return { ok: false, error: "kiwi_mem_disabled" };
    const params = new URLSearchParams({
        limit: String(Math.min(50, Math.max(1, Number(limit) || 20))),
        offset: String(Math.max(0, Number(offset) || 0)),
        sort: "newest"
    });
    if (query) params.set("q", String(query).slice(0, 200));
    const result = await getRequest(`/debug/memories?${params}`, tenant, timeoutMs);
    rememberDiagnostic('recall', result, Array.isArray(result.data?.memories) ? result.data.memories.length : 0);
    if (!result.ok && (result.status === 404 || result.error === "kiwi_mem_http_404")) {
        // Older/edge gateway versions do not expose /debug/memories. Fall back
        // to tenant-scoped recall so the memory page remains useful without
        // pretending it is a complete list.
        const recalled = await recallMemories(query || "最近的记忆", tenant, {
            limit: Math.min(50, Math.max(1, Number(limit) || 20))
        });
        return {
            ok: true,
            mode: "recall",
            total: recalled.length,
            memories: recalled.map((memory) => ({
                id: memory.id,
                title: "",
                content: memory.summary,
                importance: Number(memory.importance) || 0,
                permanent: memory.locked === true,
                heat: Number(memory.heat) || 0,
                created_at: memory.created_at || "",
                category_name: memory.category_name || ""
            }))
        };
    }
    if (!result.ok || !Array.isArray(result.data?.memories)) {
        return { ok: false, error: result.error || "kiwi_mem_list_invalid_response", status: result.status || null };
    }
    return {
        ok: true,
        mode: "list",
        total: Math.max(0, Number(result.data.total_memories) || 0),
        memories: result.data.memories.map((memory) => ({
            id: String(memory.id || ""),
            title: String(memory.title || "").slice(0, 200),
            content: String(memory.content || "").slice(0, 2000),
            importance: Number(memory.importance) || 0,
            permanent: memory.is_permanent === true,
            heat: Number(memory.heat) || 0,
            created_at: memory.created_at || "",
            category_name: String(memory.category_name || "").slice(0, 80)
        })).filter((memory) => memory.id && memory.content)
    };
}

/**
 * 锁定/解锁一条网关记忆。memory_id 必须是当前租户的数字 id。
 */
async function setMemoryPermanent({ tenant, memoryId, permanent }) {
    if (!KIWI_MEM_URL) return { ok: false, error: "kiwi_mem_disabled" };
    const id = Number(memoryId);
    if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "kiwi_mem_memory_id_invalid" };
    const result = await request(permanent ? "/memory/lock" : "/memory/unlock", { memory_id: id }, tenant, 8000);
    if (!result.ok) return { ok: false, error: result.error || "kiwi_mem_lock_failed", status: result.status || null };
    return { ok: true, memory_id: id, permanent: permanent === true };
}

/**
 * 删除一条当前租户的网关记忆；锁定记忆由网关拒绝，要求先解锁。
 */
async function deleteMemory({ tenant, memoryId }) {
    if (!KIWI_MEM_URL) return { ok: false, error: "kiwi_mem_disabled" };
    const id = Number(memoryId);
    if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "kiwi_mem_memory_id_invalid" };
    const result = await request(`/memory/${id}`, undefined, tenant, 8000, "DELETE");
    if (!result.ok) return { ok: false, error: result.error || "kiwi_mem_delete_failed", status: result.status || null };
    return { ok: true, memory_id: id };
}

/**
 * 编辑一条非永久记忆。网关没有原地更新接口，因此先写入新内容，再删除旧记录；
 * 任一步失败都尽力回滚新记录。永久记忆必须先解锁，避免绕过保护。
 */
async function replaceMemory({ tenant, memoryId, title = "", content, importance = 5, category = "" }) {
    if (!KIWI_MEM_URL) return { ok: false, error: "kiwi_mem_disabled" };
    const id = Number(memoryId);
    if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "kiwi_mem_memory_id_invalid" };
    if (!content || !String(content).trim()) return { ok: false, error: "kiwi_mem_content_required" };
    const stored = await request("/memory/store", {
        title: String(title || "").slice(0, 200),
        content: String(content).trim().slice(0, 10000),
        importance: Math.max(1, Math.min(10, Number(importance) || 5)),
        category: String(category || "").slice(0, 50)
    }, tenant, 8000);
    if (!stored.ok || !stored.data?.id) {
        return { ok: false, error: stored.error || "kiwi_mem_store_failed", status: stored.status || null };
    }
    const newId = Number(stored.data.id);
    const removed = await request(`/memory/${id}`, undefined, tenant, 8000, "DELETE");
    if (!removed.ok) {
        // Best-effort rollback: remove the newly written record if the old one
        // could not be deleted (for example, because it is locked).
        await request(`/memory/${newId}`, undefined, tenant, 8000, "DELETE").catch(() => {});
        return {
            ok: false,
            error: removed.status === 403 ? "kiwi_mem_memory_locked" : (removed.error || "kiwi_mem_delete_failed"),
            status: removed.status || null
        };
    }
    return { ok: true, memory_id: newId, title: String(title || ""), content: String(content).trim() };
}

/**
 * 上报一轮对话，kiwi-mem 按租户落账并按间隔自动提取记忆。失败不影响聊天。
 */
async function reportChatTurn({
    conversationId,
    userMessage,
    assistantMessage,
    model = '',
    tenant
}) {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: 'kiwi_mem_disabled' };
    }
    if (!conversationId || (!userMessage && !assistantMessage)) {
        return { ok: false, error: 'missing_fields' };
    }
    const body = {
        session_id: String(conversationId).slice(0, 200),
        user_message: String(userMessage || '').slice(0, 20000),
        assistant_message: String(assistantMessage || '').slice(0, 20000),
        model: String(model || '').slice(0, 200)
    };
    // A timed-out write may already be committed; retrying without gateway idempotency duplicates a turn.
    const result = await request('/memory/chat-turn', body, tenant);
    rememberDiagnostic('report', result);
    if (!result.ok) {
        console.error('kiwi_mem_report_failed', {
            error: result.error,
            status: result.status || null
        });
    }
    return result;
}

/**
 * 直接写入一条记忆（重要事实/约定，可被锁定）。
 */
async function storeMemory({
    title = '',
    content,
    importance = 5,
    category = '',
    emotionalWeight = 0,
    tenant
}) {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: 'kiwi_mem_disabled' };
    }
    if (!content || !String(content).trim()) {
        return { ok: false, error: 'missing_content' };
    }
    return request(
        '/memory/store',
        {
            title: String(title || '').slice(0, 100),
            content: String(content).slice(0, 10000),
            importance: Math.max(1, Math.min(10, Number(importance) || 5)),
            emotional_weight: Math.max(
                0,
                Math.min(10, Number(emotionalWeight) || 0)
            ),
            category: String(category || '').slice(0, 50)
        },
        tenant
    );
}

/**
 * 批量导入旧记忆（JSON 数组，最多 500 条）。
 */
async function importMemories({ memories = [], tenant }) {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: "kiwi_mem_disabled" };
    }
    if (!Array.isArray(memories) || memories.length === 0) {
        return { ok: false, error: "empty_memories" };
    }
    return request(
        "/memory/import",
        {
            memories: memories
                .slice(0, 500)
                .map((item) => ({
                    title: String(item.title || "").slice(0, 100),
                    content: String(item.content || "").slice(0, 10000),
                    importance: Math.max(1, Math.min(10, Number(item.importance) || 5)),
                    emotional_weight: Math.max(
                        0,
                        Math.min(10, Number(item.emotional_weight) || 0)
                    ),
                    category: String(item.category || "").slice(0, 50)
                }))
        },
        tenant,
        60000
    );
}

/**
 * 文件导入旧记忆（txt/md/json/csv/pdf/docx/xlsx/zip）。
 * 以 multipart/form-data 转发文件，kiwi-mem 侧做 AI 智能整理或降级分段。
 */
async function importMemoryFile({ filename, fileBuffer, fileType, tenant }) {
    if (!KIWI_MEM_URL) {
        return { ok: false, error: "kiwi_mem_disabled" };
    }
    const tenantId = tenantIdFor(tenant);
    if (!tenantId) return { ok: false, error: 'kiwi_mem_tenant_required' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
        const form = new FormData();
        form.append(
            "file",
            new Blob([fileBuffer], { type: fileType || "application/octet-stream" }),
            filename
        );
        const headers = {};
        if (KIWI_MEM_TOKEN) {
            headers["Authorization"] = "Bearer " + KIWI_MEM_TOKEN;
        }
        headers['X-Tenant-Id'] = tenantId;
        const response = await fetch(KIWI_MEM_URL + "/memory/import-file", {
            method: "POST",
            headers,
            body: form,
            signal: controller.signal
        });
        return await gatewayResult(response, tenantId);
    } catch (error) {
        return {
            ok: false,
            error:
                error?.name === "AbortError"
                    ? "timeout"
                    : 'kiwi_mem_network_error'
        };
    } finally {
        clearTimeout(timer);
    }
}


/**
 * kiwi-mem 记忆网关健康检查：可达性 + embedding 可用性 + 覆盖率。
 * 供启动日志与 /api/v2/memory/health 使用；embedding 不可用时明确报告（不再静默降级）。
 */
async function checkKiwiMemoryHealth(tenant = null) {
    const base = { configured: Boolean(KIWI_MEM_URL), reachable: false, diagnostics: kiwiMemoryDiagnostics() };
    if (!KIWI_MEM_URL) {
        return { ...base, error: "kiwi_mem_not_configured", message: "记忆网关未配置（KIWI_MEM_URL）。" };
    }
    // 使用受 MEMORY_API_TOKEN 保护的普通状态接口，避免为健康检查公开
    // /admin/*；/admin/embedding-stats 仍可留作后台诊断。
    const result = await getRequest("/memory/status", tenant, 8000);
    if (!result.ok) {
        return {
            ...base,
            error: result.error === "timeout" ? "kiwi_mem_timeout" : result.error || "kiwi_mem_unreachable",
            message: result.error === "timeout"
                ? "记忆网关响应超时（8s）。"
                : `记忆网关检查未通过：${result.error || ("HTTP " + (result.status || "?"))}。请核对鉴权、租户标识和网关版本。`,
            status: result.status || null
        };
    }
    const data = result.data || {};
    const stats = data.embedding_stats || data;
    const embeddingAvailable =
        data.embedding_ready === true ||
        stats.embedding_ready === true ||
        stats.embedding_available === true;
    const totalMemories = Number(data.total_memories ?? stats.total_memories) || 0;
    const withEmbedding = Number(stats.with_embedding) || 0;
    return {
        configured: true,
        reachable: true,
        tenant_verified: true,
        memory_enabled: data.memory_enabled !== false,
        embedding_available: embeddingAvailable,
        embedding_model: stats.embedding_model || "",
        embedding_source: stats.embedding_source || "unknown",
        total_memories: totalMemories,
        with_embedding: withEmbedding,
        coverage: stats.coverage || "N/A",
        diagnostics: kiwiMemoryDiagnostics(),
        ok: embeddingAvailable
    };
}

module.exports = {
    enabled: memoryGatewayEnabled,
    tenantIdFor,
    checkKiwiMemoryHealth,
    recallMemories,
    reportChatTurn,
    listMemories,
    setMemoryPermanent,
    deleteMemory,
    replaceMemory,
    storeMemory,
    importMemories,
    importMemoryFile
};
