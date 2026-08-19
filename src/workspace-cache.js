// 工作区文件本地缓存（IndexedDB）：把查看过的文件缓存在手机本地，
// 离线时仍能查看已缓存的内容；「清理缓存」一键删除全部缓存副本。

const DB_NAME = "dengta-workspace-cache";
const STORE = "files";
const DB_VERSION = 1;

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
        db.createObjectStore(STORE, { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
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
        reject(error);
        return;
      }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
}

export async function workspaceCacheWrite(path, content) {
  return withStore("readwrite", (store) => {
    store.put({ path, content, savedAt: Date.now() });
  });
}

export async function workspaceCacheRead(path) {
  return withStore("readonly", (store) => store.get(path));
}

export async function workspaceCacheList() {
  return withStore("readonly", (store) => store.getAll());
}

export async function workspaceCacheClear() {
  return withStore("readwrite", (store) => store.clear());
}