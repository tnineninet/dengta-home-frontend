// 工作区文件本地缓存（IndexedDB）：把查看过的文件缓存在手机本地，
// 离线时仍能查看已缓存的内容；「清理缓存」一键删除全部缓存副本。

const DB_NAME = "dengta-workspace-cache";
const STORE = "account-files";
const DB_VERSION = 2;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持本地缓存。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["account", "path"] });
        store.createIndex("account", "account");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

function withStore(mode, callback) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        tx.abort();
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => { db.close(); resolve(result?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
}

function requireAccount(account) {
  const scope = String(account || "").trim();
  if (!scope) throw new Error("请登录后使用工作区离线缓存。");
  return scope;
}

export async function workspaceCacheWrite(account, path, content) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    return store.put({ account: scope, path, content, savedAt: Date.now() });
  });
}

export async function workspaceCacheRead(account, path) {
  const scope = requireAccount(account);
  return withStore("readonly", (store) => store.get([scope, path]));
}

export async function workspaceCacheList(account) {
  const scope = requireAccount(account);
  return withStore("readonly", (store) => store.index("account").getAll(scope));
}

export async function workspaceCacheDelete(account, path) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => store.delete([scope, path]));
}

export async function workspaceCacheClear(account) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    const request = store.index("account").openKeyCursor(scope);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

export function cachedWorkspaceEntries(items, path = "") {
  const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
  const entries = new Map();
  for (const item of items) {
    if (!item.path.startsWith(prefix)) continue;
    const relative = item.path.slice(prefix.length);
    const [name, ...rest] = relative.split("/");
    if (!name) continue;
    const type = rest.length ? "dir" : "file";
    if (!entries.has(name) || type === "dir") {
      entries.set(name, { name, type, size: type === "file" ? new Blob([item.content]).size : 0 });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}
