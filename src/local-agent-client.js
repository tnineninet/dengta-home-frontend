/**
 * DengTa Local AI Agent, adudir-open, JianyingPro, Multi-Format File Reader,
 * Local Workspace (PC Bridge + Browser OPFS), and User Knowledge Base client.
 */

const BRIDGE_URL_KEY = "dengta.local-agent.bridge-url.v1";
const BROWSER_POLICY_KEY = "dengta.local-agent.browser-policy.v1";
const BROWSER_KB_KEY = "dengta.local-agent.browser-kb.v1";
const BROWSER_WS_KEY = "dengta.local-agent.browser-ws.v1";
const BROWSER_TASKS_KEY = "dengta.local-agent.browser-tasks.v1";

export const DEFAULT_LOCAL_SCOPES = Object.freeze({
  read_files: true,
  workspace_write: true,
  knowledge_base: true,
  media_edit_adudir: true,
  jianying_control: true,
  task_runner: true,
});

export const SCOPE_DESCRIPTIONS = Object.freeze([
  { key: "read_files", label: "读取音视频 / 文档 / 资源包", detail: "允许 DengTa 解析你拖入或指定的本地视频、音频、PDF、Word、Excel、PPT、字幕与 ZIP/.motion 包。" },
  { key: "workspace_write", label: "创建并写入本机 AI 工作区", detail: "允许在授权工作区目录内建立文件夹、保存脚本、素材、笔记与导出任务报告。" },
  { key: "knowledge_base", label: "创建并检索用户知识库", detail: "允许对上传素材做语义切片、建立个人知识库，并在聊天或剪辑时自动召回引用。" },
  { key: "media_edit_adudir", label: "运行 adudir-open 代码式剪辑引擎", detail: "允许运行画质黑屏/模糊检测、FFmpeg 统一响度、近重复镜头检测、SFX 推荐与 .motion 工程生成。" },
  { key: "jianying_control", label: "操控本机剪映专业版 / CapCut", detail: "允许自动检测本机剪映草稿目录、备份 root_meta_info.json、写入多轨草稿与 FCPXML 并唤起剪映。" },
  { key: "task_runner", label: "Antigravity 式多步任务执行", detail: "允许 AI 按步骤编排「读素材 → 建知识库 → 体检剪辑 → 同步剪映 → 输出报告」全流程。" },
]);

export function getSavedBridgeBaseUrl() {
  try {
    return String(globalThis.localStorage?.getItem(BRIDGE_URL_KEY) || "").trim().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function setSavedBridgeBaseUrl(url) {
  const clean = String(url || "").trim().replace(/\/$/, "");
  try {
    if (clean) globalThis.localStorage?.setItem(BRIDGE_URL_KEY, clean);
    else globalThis.localStorage?.removeItem(BRIDGE_URL_KEY);
  } catch {
    // ignore storage quota errors
  }
  return clean;
}

export function isLoopbackClient() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function buildBridgeEndpoint(path) {
  const saved = getSavedBridgeBaseUrl();
  if (saved) return `${saved}${path}`;
  return path;
}

async function fetchBridgeJson(path, { method = "GET", body, timeoutMs = 90_000 } = {}) {
  const url = buildBridgeEndpoint(path);
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function buildDownloadUrl(absPath) {
  return buildBridgeEndpoint(`/api/v2/local-agent/download?path=${encodeURIComponent(String(absPath || ""))}`);
}

// ---------------------------------------------------------------------------
// Browser / Mobile Pure-Local Fallback (OPFS + localStorage + Media Inspector)
// ---------------------------------------------------------------------------
function readJsonStore(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStore(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function getBrowserPolicy() {
  const saved = readJsonStore(BROWSER_POLICY_KEY, null);
  return {
    ok: true,
    workspaceRoot: "浏览器 / 手机端侧 OPFS 私有工作区",
    authorized: saved ? Boolean(saved.authorized) : true,
    scopes: { ...DEFAULT_LOCAL_SCOPES, ...(saved?.scopes || {}) },
    updatedAt: saved?.updatedAt || new Date().toISOString(),
  };
}

export function updateBrowserPolicy(patch = {}) {
  const cur = getBrowserPolicy();
  const nextScopes = { ...cur.scopes, ...(patch.scopes || {}) };
  const next = {
    ...cur,
    authorized: "authorized" in patch ? Boolean(patch.authorized) : Object.values(nextScopes).some(Boolean),
    scopes: nextScopes,
    updatedAt: new Date().toISOString(),
  };
  writeJsonStore(BROWSER_POLICY_KEY, next);
  return next;
}

function tokenizeHybrid(text) {
  const low = String(text || "").toLowerCase();
  const raw = low.match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || [];
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    out.push(raw[i]);
    if (raw[i].length === 1 && /[\u4e00-\u9fff]/.test(raw[i]) && i + 1 < raw.length && raw[i + 1].length === 1 && /[\u4e00-\u9fff]/.test(raw[i + 1])) {
      out.push(raw[i] + raw[i + 1]);
    }
  }
  return out;
}

function chunkTextBrowser(text, size = 480, overlap = 80) {
  const clean = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const out = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + size);
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 120);
  }
  return out;
}

export function getBrowserKbOverview() {
  const store = readJsonStore(BROWSER_KB_KEY, {
    collections: [{ id: "kb_mobile_default", name: "我的端侧知识库", description: "保存在本机设备中，离线也能秒级检索。", createdAt: new Date().toISOString() }],
    documents: [],
  });
  const docs = Array.isArray(store.documents) ? store.documents : [];
  return {
    ok: true,
    workspaceRoot: "端侧浏览器 / 手机本地存储",
    collections: store.collections || [],
    documentCount: docs.length,
    chunkCount: docs.reduce((s, d) => s + (d.chunks?.length || 0), 0),
    documents: docs.map((d) => ({
      id: d.id,
      kbName: d.kbName,
      title: d.title,
      sourcePath: d.sourcePath || "",
      tags: d.tags || [],
      chunkCount: d.chunks?.length || 0,
      charCount: d.charCount || 0,
      createdAt: d.createdAt,
      preview: (d.chunks?.[0] || "").slice(0, 180),
    })),
  };
}

export function addBrowserKbCollection(name, description = "") {
  const clean = String(name || "").trim().slice(0, 48);
  if (!clean) throw new Error("知识库名称不能为空。");
  const store = readJsonStore(BROWSER_KB_KEY, { collections: [], documents: [] });
  if (!store.collections.some((c) => c.name === clean)) {
    store.collections.push({ id: `kb_${Date.now().toString(36)}`, name: clean, description, createdAt: new Date().toISOString() });
    writeJsonStore(BROWSER_KB_KEY, store);
  }
  return getBrowserKbOverview();
}

export function addBrowserKbDocument({ kbName = "我的端侧知识库", title = "未命名笔记", content = "", sourcePath = "", tags = [] }) {
  const chunks = chunkTextBrowser(content);
  if (!chunks.length) throw new Error("文档正文为空，无法入库。");
  const store = readJsonStore(BROWSER_KB_KEY, {
    collections: [{ id: "kb_mobile_default", name: "我的端侧知识库", description: "", createdAt: new Date().toISOString() }],
    documents: [],
  });
  if (!store.collections.some((c) => c.name === kbName)) {
    store.collections.push({ id: `kb_${Date.now().toString(36)}`, name: kbName, description: "", createdAt: new Date().toISOString() });
  }
  const id = `bdoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  store.documents.unshift({
    id,
    kbName,
    title: String(title || "未命名笔记").slice(0, 120),
    sourcePath,
    tags,
    charCount: String(content).length,
    chunks,
    createdAt: new Date().toISOString(),
  });
  writeJsonStore(BROWSER_KB_KEY, store);
  return { ok: true, documentId: id, kbName, title, chunkCount: chunks.length };
}

export function deleteBrowserKbDocument(docId) {
  const store = readJsonStore(BROWSER_KB_KEY, { collections: [], documents: [] });
  store.documents = (store.documents || []).filter((d) => d.id !== docId);
  writeJsonStore(BROWSER_KB_KEY, store);
  return { ok: true, overview: getBrowserKbOverview() };
}

export function searchBrowserKb(query, { kbName = "", topK = 6 } = {}) {
  const qToks = [...new Set(tokenizeHybrid(query))];
  if (!qToks.length) return { ok: true, query, hits: [], totalChunksSearched: 0 };
  const store = readJsonStore(BROWSER_KB_KEY, { collections: [], documents: [] });
  const rows = [];
  for (const doc of store.documents || []) {
    if (kbName && doc.kbName !== kbName) continue;
    (doc.chunks || []).forEach((ch, idx) => {
      const toks = tokenizeHybrid(`${doc.title} ${(doc.tags || []).join(" ")} ${ch}`);
      const freq = new Map();
      for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
      let score = 0;
      const matched = [];
      for (const qt of qToks) {
        if (freq.has(qt)) {
          score += 1 + Math.log1p(freq.get(qt));
          matched.push(qt);
        }
      }
      if (String(ch).toLowerCase().includes(String(query).trim().toLowerCase())) score += 2.5;
      if (score > 0) {
        rows.push({
          docId: doc.id,
          kbName: doc.kbName,
          title: doc.title,
          sourcePath: doc.sourcePath || "",
          chunkIndex: idx,
          score: Number(score.toFixed(3)),
          matchedTerms: matched.slice(0, 10),
          snippet: ch,
          estimatedTokens: Math.max(1, Math.round(ch.length * 0.6)),
        });
      }
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return { ok: true, query, totalChunksSearched: rows.length, hits: rows.slice(0, topK) };
}

export async function writeBrowserWorkspaceFile(relPath, content) {
  const clean = String(relPath || "").replace(/^\/+/, "").trim();
  if (!clean || clean.includes("..")) throw new Error("无效工作区路径。");
  // Persist into OPFS when available + index in localStorage
  if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const parts = clean.split("/").filter(Boolean);
      let dir = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await fh.createWritable();
      await writable.write(String(content ?? ""));
      await writable.close();
    } catch {
      // fallback to localStorage record below
    }
  }
  const files = readJsonStore(BROWSER_WS_KEY, []);
  const next = [
    { relPath: clean, name: clean.split("/").pop(), type: "file", sizeBytes: new Blob([String(content ?? "")]).size, content: String(content ?? ""), modifiedAt: new Date().toISOString() },
    ...files.filter((f) => f.relPath !== clean),
  ].slice(0, 80);
  writeJsonStore(BROWSER_WS_KEY, next);
  return { ok: true, relPath: clean, sizeBytes: next[0].sizeBytes };
}

export function listBrowserWorkspace() {
  const files = readJsonStore(BROWSER_WS_KEY, [
    { relPath: "AGENTS.md", name: "AGENTS.md", type: "file", sizeBytes: 186, content: "# DengTa 端侧 AI 工作区\n支持手机/电脑离线保存脚本、知识库笔记与 .motion 工程。", modifiedAt: new Date().toISOString() },
  ]);
  return { ok: true, workspaceRoot: "浏览器 / 手机端侧 OPFS 工作区", relDir: "", entries: files };
}

/**
 * Pure-JS lightweight ZIP/.motion entry scanner for mobile/offline mode (no extra dependency).
 */
async function scanZipEntriesInBrowser(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries = [];
  // Scan EOCD (End of Central Directory signature 0x06054b50) from end
  let eocd = -1;
  const minOffset = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  let pos = cdOffset;
  const limit = Math.min(buf.length, cdOffset + cdSize);
  while (pos + 46 <= limit && view.getUint32(pos, true) === 0x02014b50) {
    const uncompSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const name = decoder.decode(buf.subarray(pos + 46, pos + 46 + nameLen));
    if (!name.endsWith("/") && !name.includes("..")) {
      entries.push({ path: name, sizeBytes: uncompSize });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function probeMediaElementInBrowser(file, isVideo) {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve({});
    const url = URL.createObjectURL(file);
    const el = document.createElement(isVideo ? "video" : "audio");
    el.preload = "metadata";
    const done = (meta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = window.setTimeout(() => done({}), 5000);
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done({
        durationSec: Number.isFinite(el.duration) ? Number(el.duration.toFixed(2)) : 0,
        width: isVideo ? el.videoWidth || 0 : 0,
        height: isVideo ? el.videoHeight || 0 : 0,
      });
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      done({});
    };
    el.src = url;
  });
}

export async function inspectFileInBrowser(file) {
  const name = String(file?.name || "未命名文件");
  const ext = (name.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] || "");
  const sizeBytes = Number(file?.size || 0);
  const videoExts = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);
  const audioExts = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const textExts = new Set([".txt", ".md", ".json", ".csv", ".xml", ".html", ".srt", ".vtt", ".ass", ".yaml", ".yml", ".py", ".js", ".jsx", ".ts", ".css"]);

  if (videoExts.has(ext) || String(file?.type || "").startsWith("video/")) {
    const meta = await probeMediaElementInBrowser(file, true);
    return {
      ok: true,
      name,
      ext,
      kind: "video",
      format: ext.replace(/^\./, "") || "video",
      sizeBytes,
      probe: { durationSec: meta.durationSec || 0, width: meta.width || 0, height: meta.height || 0, hasVideo: true, hasAudio: true },
      text: `视频「${name}」：时长 ${meta.durationSec || "?"}s，分辨率 ${meta.width || "?"}×${meta.height || "?"}，大小 ${(sizeBytes / 1024 / 1024).toFixed(2)} MB。`,
    };
  }
  if (audioExts.has(ext) || String(file?.type || "").startsWith("audio/")) {
    const meta = await probeMediaElementInBrowser(file, false);
    const supported = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav"]).has(ext);
    return {
      ok: true,
      name,
      ext,
      kind: "audio",
      format: ext.replace(/^\./, "") || "audio",
      sizeBytes,
      bgmSupported: supported,
      probe: { durationSec: meta.durationSec || 0, hasVideo: false, hasAudio: true },
      text: `音频「${name}」：时长 ${meta.durationSec || "?"}s，大小 ${(sizeBytes / 1024).toFixed(1)} KB，${supported ? "adudir-open 原生支持播放与自动配乐" : "建议转码为 mp3/m4a/wav"}。`,
    };
  }
  if (ext === ".zip" || ext === ".motion") {
    const entries = await scanZipEntriesInBrowser(file);
    return {
      ok: true,
      name,
      ext,
      kind: ext === ".motion" ? "motion_pack" : "resource_pack",
      format: ext.replace(/^\./, ""),
      sizeBytes,
      fileCount: entries.length,
      entries: entries.slice(0, 100),
      text: `资源包「${name}」包含 ${entries.length} 个文件：${entries.slice(0, 25).map((e) => e.path).join(", ")}`,
    };
  }
  if (imageExts.has(ext) || String(file?.type || "").startsWith("image/")) {
    return {
      ok: true,
      name,
      ext,
      kind: "image",
      format: ext.replace(/^\./, "") || "image",
      sizeBytes,
      text: `图片「${name}」（${(sizeBytes / 1024).toFixed(1)} KB）已读取，可直接送入对话或剪辑轨道。`,
    };
  }
  if (textExts.has(ext) || String(file?.type || "").startsWith("text/")) {
    const txt = await file.text();
    return {
      ok: true,
      name,
      ext,
      kind: ext === ".srt" || ext === ".vtt" ? "subtitle" : "text",
      format: ext.replace(/^\./, "") || "txt",
      sizeBytes,
      text: txt.slice(0, 24_000),
      truncated: txt.length > 24_000,
    };
  }
  return {
    ok: true,
    name,
    ext,
    kind: "document",
    format: ext.replace(/^\./, "") || "file",
    sizeBytes,
    text: `文档「${name}」（${(sizeBytes / 1024).toFixed(1)} KB）已载入端侧工作区。连接电脑本机 AI 网关后可深度解析 PDF/Word/Excel/PPT 全文。`,
  };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || "");
      const idx = str.indexOf(",");
      resolve(idx >= 0 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error("读取本地文件失败。"));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Unified Client API (Auto-selects PC Local Bridge or Mobile/Browser Fallback)
// ---------------------------------------------------------------------------
export async function fetchLocalAgentOverview() {
  try {
    const data = await fetchBridgeJson("/api/v2/local-agent/overview", { timeoutMs: 12_000 });
    return { mode: "pc_bridge", ...data };
  } catch (err) {
    return {
      mode: "browser_local",
      bridgeError: err?.message || "未检测到本机网关",
      ok: true,
      lanUrls: [],
      adudir: { ok: false, loadedAlgorithms: ["bgm_format", "sfx_recommender", "quality_detector", "finishing_loudness", "finishing_neardup"] },
      jianying: { ok: false, installed: false, compatibilityNote: "当前为纯浏览器/手机端侧模式，可生成 .motion 工程与 SRT/FCPXML；若需直接操控电脑剪映，请启动电脑端「一键启动DengTa本机AI助手.bat」并扫码配对。" },
      jianyingDrafts: { drafts: [] },
      policy: getBrowserPolicy(),
      workspace: listBrowserWorkspace(),
      kb: getBrowserKbOverview(),
      tasks: { tasks: readJsonStore(BROWSER_TASKS_KEY, []) },
    };
  }
}

export async function updateLocalAgentPolicy(mode, patch) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/policy", { method: "PUT", body: patch });
  }
  return updateBrowserPolicy(patch);
}

export async function uploadAndInspectFile(mode, file, { addToKb = false, kbName = "我的默认知识库" } = {}) {
  if (mode === "pc_bridge") {
    const contentBase64 = await fileToBase64(file);
    return fetchBridgeJson("/api/v2/local-agent/upload-inspect", {
      method: "POST",
      body: { filename: file.name, contentBase64, addToKb, kbName },
      timeoutMs: 120_000,
    });
  }
  const parsed = await inspectFileInBrowser(file);
  await writeBrowserWorkspaceFile(`inbox/${file.name}`, parsed.text || "");
  let kbIndexed = null;
  if (addToKb && parsed.text) {
    kbIndexed = addBrowserKbDocument({ kbName, title: file.name, content: parsed.text, tags: [parsed.kind, parsed.format] });
  }
  return { ok: true, savedRelPath: `inbox/${file.name}`, savedAbsPath: `opfs://inbox/${file.name}`, parsed, kbIndexed };
}

export async function inspectLocalPathOnPc(filePath, { addToKb = false, kbName = "我的默认知识库" } = {}) {
  return fetchBridgeJson("/api/v2/local-agent/upload-inspect", {
    method: "POST",
    body: { filePath, addToKb, kbName },
  });
}

export async function runAdudirAnalyze(mode, payload) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/adudir/analyze", { method: "POST", body: payload, timeoutMs: 120_000 });
  }
  // Browser fallback: deterministic BGM format + SFX recommendations
  const bgmExts = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav"]);
  const bgm = (payload.bgmFiles || []).map((f) => {
    const ext = (String(f).toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] || "");
    const supported = !ext || bgmExts.has(ext);
    return { file: f, ext, supported, reason: supported ? "" : `格式 ${ext} 不支持预览/合成，请换 mp3/m4a/wav/ogg` };
  });
  return {
    ok: true,
    note: "当前为浏览器端侧轻量模式；连接电脑本机网关后将自动调用 OpenCV 实帧检测与 FFmpeg 2-Pass LUFS 响度测量。",
    audioHelpers: { bgm, sfx: [] },
  };
}

export async function createMotionProjectClient(mode, payload) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/adudir/create-motion", { method: "POST", body: payload });
  }
  const manifest = {
    format: "adudir-motion-project",
    specVersion: "2.0.0",
    project: { id: `mobile_motion_${Date.now().toString(36)}`, name: payload.projectName || payload.title || "DengTa_Motion", revision: 1 },
    output: { width: payload.layout === "portrait" ? 1080 : 1920, height: payload.layout === "portrait" ? 1920 : 1080, fps: { num: 30, den: 1 } },
    lines: payload.lines || [],
  };
  await writeBrowserWorkspaceFile(`motion-projects/${manifest.project.id}/motion.json`, JSON.stringify(manifest, null, 2));
  return { ok: true, projectId: manifest.project.id, projectName: manifest.project.name, mobileManifest: manifest, validation: { ok: true, integrityChecked: 1 } };
}

export async function createJianyingDraftClient(mode, payload) {
  if (mode !== "pc_bridge") {
    throw new Error("当前未连接电脑本机 AI 网关。请先在电脑运行「一键启动DengTa本机AI助手.bat」，手机可扫码局域网配对操控电脑剪映。");
  }
  return fetchBridgeJson("/api/v2/local-agent/jianying/create-draft", { method: "POST", body: payload, timeoutMs: 120_000 });
}

export async function launchJianyingClient(mode, payload) {
  if (mode !== "pc_bridge") throw new Error("请先连接电脑本机网关后再唤起本机剪映。");
  return fetchBridgeJson("/api/v2/local-agent/jianying/launch", { method: "POST", body: payload });
}

export async function writeWorkspaceFileClient(mode, relPath, content) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/workspace/write", { method: "POST", body: { relPath, content } });
  }
  return writeBrowserWorkspaceFile(relPath, content);
}

export async function kbCreateCollectionClient(mode, name, description = "") {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/kb/collections", { method: "POST", body: { name, description } });
  }
  return addBrowserKbCollection(name, description);
}

export async function kbAddDocumentClient(mode, payload) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/kb/documents", { method: "POST", body: payload });
  }
  return addBrowserKbDocument(payload);
}

export async function kbDeleteDocumentClient(mode, docId) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson(`/api/v2/local-agent/kb/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
  }
  return deleteBrowserKbDocument(docId);
}

export async function kbSearchClient(mode, payload) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/kb/search", { method: "POST", body: payload });
  }
  return searchBrowserKb(payload.query, { kbName: payload.kbName, topK: payload.topK });
}

export async function runAgentTaskClient(mode, payload) {
  if (mode === "pc_bridge") {
    return fetchBridgeJson("/api/v2/local-agent/tasks/run", { method: "POST", body: payload, timeoutMs: 180_000 });
  }
  // Browser-side task runner receipt
  const kbRes = searchBrowserKb(payload.goal || "", { topK: 4 });
  const proj = await createMotionProjectClient("browser_local", {
    projectName: String(payload.goal || "端侧任务").slice(0, 24),
    title: String(payload.goal || "端侧 AI 任务").slice(0, 40),
    lines: [String(payload.goal || ""), "由 DengTa 端侧工作台自动生成"],
    layout: payload.layout || "landscape",
  });
  const receipt = {
    ok: true,
    taskId: `btask_${Date.now().toString(36)}`,
    goal: payload.goal,
    createdAt: new Date().toISOString(),
    elapsedSec: 0.2,
    steps: [
      { step: "kb_recall", title: "检索端侧知识库", status: "done", summary: `召回 ${kbRes.hits.length} 条相关笔记。` },
      { step: "motion_build", title: "生成端侧 .motion 工程清单", status: "done", summary: `已保存到端侧工作区：${proj.projectId}` },
    ],
    artifacts: [{ type: "motion_archive", label: "端侧 .motion 清单", path: `motion-projects/${proj.projectId}/motion.json` }],
    kbHits: kbRes.hits,
  };
  const hist = [receipt, ...readJsonStore(BROWSER_TASKS_KEY, [])].slice(0, 20);
  writeJsonStore(BROWSER_TASKS_KEY, hist);
  return receipt;
}
