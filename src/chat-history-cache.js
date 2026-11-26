// 聊天历史本地缓存（stale-while-revalidate）：
// 打开聊天页时先用内存 / IndexedDB 中上次的历史秒开，再在后台向服务器校准。
// 按「账号+伴侣」范围隔离；只缓存服务器已确认的消息，最多保留每个会话最近 200 条。

const DB_NAME = "dengta-chat-history-cache";
const DB_VERSION = 1;
const STORE = "histories";
const MAX_CACHED_MESSAGES = 200;
const MAX_MEMORY_SESSIONS = 16;
const WRITE_DEBOUNCE_MS = 350;
const INSTANT_SNAPSHOT_PREFIX = "dengta.chat-instant-snapshot.v1::";
const MAX_INSTANT_SESSIONS = 20;
const MAX_INSTANT_MESSAGES = 25;
const MAX_INSTANT_JSON_BYTES = 48 * 1024;

const memory = new Map();
const pendingWrites = new Map();
let activeScope = "";
let dbPromise = null;

export function setChatHistoryCacheScope(scope) {
  activeScope = String(scope || "");
}

function cacheKey(sessionId, scope = activeScope) {
  return `${scope}::${sessionId}`;
}

function remember(key, entry) {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_MEMORY_SESSIONS) {
    memory.delete(memory.keys().next().value);
  }
}

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

/** 同步读取内存缓存条目元信息（区分完整校准缓存与首屏预热缓存）。 */
export function peekCachedHistoryEntry(sessionId) {
  if (!sessionId) return null;
  const entry = memory.get(cacheKey(sessionId));
  return Array.isArray(entry?.messages) ? entry : null;
}

/** 同步读取内存缓存（同一次运行内切换会话时零等待）。 */
export function peekCachedHistory(sessionId) {
  const entry = peekCachedHistoryEntry(sessionId);
  return entry ? entry.messages : null;
}

/** 用 bootstrap 预取或 L0 快照预热 L1 内存缓存（不覆盖已有更完整的本地缓存）。 */
export function seedInitialHistory(sessionId, rawMessages) {
  if (!sessionId || !Array.isArray(rawMessages) || rawMessages.length === 0) return false;
  const key = cacheKey(sessionId);
  const existing = memory.get(key);
  if (Array.isArray(existing?.messages) && existing.messages.length >= rawMessages.length) {
    return false;
  }
  remember(key, {
    messages: rawMessages.slice(-MAX_CACHED_MESSAGES),
    savedAt: Date.now(),
    full: false,
  });
  return true;
}

/** 合并增量拉取（?after=）返回的新消息并按 id 去重。 */
export function mergeIncrementalMessages(existing = [], incoming = []) {
  const base = Array.isArray(existing) ? existing : [];
  const delta = Array.isArray(incoming) ? incoming : [];
  if (delta.length === 0) return base;
  const seen = new Set(base.map((item) => String(item?.id ?? "")).filter(Boolean));
  const merged = base.slice();
  for (const item of delta) {
    const id = String(item?.id ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(item);
  }
  return merged;
}

/** 快速判断两段原始消息列表尾部是否等价，避免无变化时触发整页 DOM 重绘。 */
export function areRawMessageListsEquivalent(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  if (left.length === 0) return true;
  const aFirst = left[0];
  const bFirst = right[0];
  const aLast = left[left.length - 1];
  const bLast = right[right.length - 1];
  return (
    String(aFirst?.id ?? "") === String(bFirst?.id ?? "") &&
    String(aLast?.id ?? "") === String(bLast?.id ?? "") &&
    String(aLast?.content ?? "") === String(bLast?.content ?? "") &&
    String(aLast?.created_at ?? "") === String(bLast?.created_at ?? "")
  );
}

/** L0 同步本地启动快照：打开聊天页 0ms 首屏秒出，不等网络 /bootstrap 返回。 */
function instantSnapshotKey(scope) {
  return `${INSTANT_SNAPSHOT_PREFIX}${String(scope || "").trim()}`;
}

export function readInstantChatSnapshot(scope, storage = globalThis.localStorage) {
  const safeScope = String(scope || "").trim();
  if (!safeScope || typeof storage?.getItem !== "function") return null;
  try {
    const raw = storage.getItem(instantSnapshotKey(safeScope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((item) => item && typeof item === "object" && item.id)
      : [];
    const activeSessionId = parsed.activeSessionId || sessions[0]?.id || null;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    if (!sessions.length && !messages.length) return null;
    return {
      sessions,
      activeSessionId,
      messages,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function writeInstantChatSnapshot(
  scope,
  { sessions = [], activeSessionId = null, messages = [] } = {},
  storage = globalThis.localStorage,
) {
  const safeScope = String(scope || "").trim();
  if (!safeScope || typeof storage?.setItem !== "function") return false;
  try {
    const slimSessions = (Array.isArray(sessions) ? sessions : [])
      .filter((item) => item && typeof item === "object" && item.id)
      .slice(0, MAX_INSTANT_SESSIONS)
      .map((s) => ({
        id: s.id,
        title: String(s.title || "新对话").slice(0, 60),
        model_id: s.model_id || null,
        created_at: s.created_at || null,
        updated_at: s.updated_at || null,
      }));
    const slimMessages = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && typeof m === "object" && m.id && !m.isStreaming && !m.chatError)
      .slice(-MAX_INSTANT_MESSAGES)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 2000) : "",
        created_at: m.created_at || null,
        reply_to_message_id: m.reply_to_message_id || null,
        reply_snapshot: m.reply_snapshot || null,
      }));
    const serialized = JSON.stringify({
      sessions: slimSessions,
      activeSessionId: activeSessionId || slimSessions[0]?.id || null,
      messages: slimMessages,
      savedAt: Date.now(),
    });
    if (serialized.length > MAX_INSTANT_JSON_BYTES) return false;
    storage.setItem(instantSnapshotKey(safeScope), serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearInstantChatSnapshot(scope, storage = globalThis.localStorage) {
  const safeScope = String(scope || "").trim();
  if (!safeScope || typeof storage?.removeItem !== "function") return;
  try {
    storage.removeItem(instantSnapshotKey(safeScope));
  } catch {
    // 忽略存储不可用
  }
}

/** 读取内存或 IndexedDB 中的缓存（冷启动时使用）。 */
export async function readCachedHistory(sessionId) {
  if (!sessionId) return null;
  const key = cacheKey(sessionId);
  const fromMemory = memory.get(key);
  if (Array.isArray(fromMemory?.messages)) return fromMemory.messages;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (value && Array.isArray(value.messages)) {
          remember(key, value);
          resolve(value.messages);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 写入服务器确认过的原始历史（内存立即生效，IndexedDB 去抖写入）。 */
export function writeCachedHistory(sessionId, rawMessages) {
  if (!sessionId || !Array.isArray(rawMessages)) return;
  const key = cacheKey(sessionId);
  const entry = {
    messages: rawMessages.slice(-MAX_CACHED_MESSAGES),
    savedAt: Date.now(),
    full: true,
  };
  remember(key, entry);
  if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key));
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      void openDb().then((db) => {
        if (!db) return;
        try {
          db.transaction(STORE, "readwrite").objectStore(STORE).put(entry, key);
        } catch {
          // 存储空间不足或隐私模式时静默降级为仅内存缓存。
        }
      });
    }, WRITE_DEBOUNCE_MS),
  );
}

export function clearCachedHistory(sessionId) {
  if (!sessionId) return;
  const key = cacheKey(sessionId);
  memory.delete(key);
  if (pendingWrites.has(key)) {
    clearTimeout(pendingWrites.get(key));
    pendingWrites.delete(key);
  }
  void openDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    } catch {
      // 忽略：缓存删除失败不影响服务器数据。
    }
  });
}
