// 聊天历史本地缓存（stale-while-revalidate）：
// 打开聊天页时先用内存 / IndexedDB 中上次的历史秒开，再在后台向服务器校准。
// 按「账号+伴侣」范围隔离；只缓存服务器已确认的消息，最多保留每个会话最近 200 条。

const DB_NAME = "dengta-chat-history-cache";
const DB_VERSION = 1;
const STORE = "histories";
const MAX_CACHED_MESSAGES = 200;
const MAX_MEMORY_SESSIONS = 16;
const WRITE_DEBOUNCE_MS = 350;

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

/** 同步读取内存缓存（同一次运行内切换会话时零等待）。 */
export function peekCachedHistory(sessionId) {
  if (!sessionId) return null;
  const entry = memory.get(cacheKey(sessionId));
  return Array.isArray(entry?.messages) ? entry.messages : null;
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
