import { apiRequest } from "./api.js";
import { isPrivateMediaHostname } from "./direct-media.js";

const MAX_TEXT = 500;
const MAX_ITEMS = 2_000;
const READ_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 15_000;

function text(value, maximum = MAX_TEXT) {
  return String(value ?? "").trim().slice(0, maximum);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function validateDirectAudioUrl(value) {
  const input = text(value, 4096);
  if (!input) return { ok: false, code: "required", message: "请先填写音频 HTTPS 直链。" };
  let url;
  try { url = new URL(input); } catch { return { ok: false, code: "invalid", message: "请填写完整的 HTTPS 音频地址。" }; }
  if (url.protocol !== "https:") return { ok: false, code: "protocol", message: "只允许公开 HTTPS 音频直链。" };
  if (url.username || url.password) return { ok: false, code: "userinfo", message: "音频地址不能包含用户名或密码。" };
  if (isPrivateMediaHostname(url.hostname)) {
    return { ok: false, code: "private_host", message: "不能播放本机、局域网或私有 IP 的音频。" };
  }
  return { ok: true, code: "ok", url: url.href, message: "" };
}

export function detectNeteasePlaylistShare(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/https?:\/\/(?:y\.)?music\.163\.com\/(?:m\/)?playlist\?[^\s]*\bid=(\d+)/i);
  if (!match) return null;
  const beforeLink = raw.slice(0, match.index).replace(/^(?:分享|复制).*?[:：]\s*/i, "").trim();
  const titleLines = beforeLink.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = titleLines[titleLines.length - 1] || "网易云歌单";
  return Object.freeze({ provider: "网易云音乐", providerId: "netease", playlistId: match[1], title: text(title, 180) });
}

function normalizeItem(item, index = 0) {
  const source = typeof item === "string" ? { url: item } : item || {};
  const url = text(source.url || source.audio_url || source.src, 4096);
  return Object.freeze({
    id: text(source.id || `local-${index}`, 100),
    title: text(source.title || source.name || `曲目 ${index + 1}`, 180),
    artist: text(source.artist || source.author, 180),
    album: text(source.album, 180),
    url,
    durationSeconds: number(source.duration_seconds ?? source.duration),
    lyrics: String(source.lyrics ?? source.lyric ?? ""),
  });
}

function normalizeFavorite(value) {
  const source = value || {};
  return Object.freeze({
    itemId: text(source.item_id ?? source.itemId, 100),
    playlistId: text(source.playlist_id ?? source.playlistId, 100),
    title: text(source.title, 180),
    artist: text(source.artist, 180),
    album: text(source.album, 180),
    durationSeconds: number(source.duration_seconds ?? source.durationSeconds),
    favoritedAt: source.favorited_at ?? source.favoritedAt ?? "",
  });
}

export function normalizeMusicPlaylist(value) {
  const source = value?.playlist || value || {};
  const rawItems = source.items || source.tracks || source.playlist_items || [];
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS).map(normalizeItem);
  return Object.freeze({
    id: text(source.id, 100),
    name: text(source.name || source.title || "未命名歌单", 180),
    provider: text(source.provider || source.source_format || "local_playlist", 80),
    itemCount: number(source.item_count ?? source.itemCount, items.length),
    items: Object.freeze(items),
    createdAt: source.created_at || "",
  });
}

export function parseMusicText(content, format = "auto") {
  const raw = String(content || "").replace(/^\uFEFF/, "").trim();
  const requested = String(format || "auto").toLowerCase();
  if (!raw) return [];
  if (requested === "json" || (requested === "auto" && (raw.startsWith("{") || raw.startsWith("[")))) {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.tracks || parsed.playlist_items || [];
    return items.map(normalizeItem);
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (requested === "m3u" || requested === "m3u8" || (requested === "auto" && lines.some((line) => line.toUpperCase() === "#EXTM3U"))) {
    const result = [];
    let metadata = {};
    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        const [, duration, label = ""] = line.match(/^#EXTINF:([^,]*),(.*)$/) || [];
        const split = label.split(" - ");
        metadata = { duration, title: split.pop() || label, artist: split.join(" - ") };
      } else if (!line.startsWith("#")) {
        result.push(normalizeItem({ ...metadata, url: line }, result.length));
        metadata = {};
      }
    }
    return result;
  }
  return lines.filter((line) => !line.startsWith("#")).map((line, index) => normalizeItem({ url: line, title: line.split("/").pop() }, index));
}

function resolveImportFormat(content, format) {
  const requested = String(format || "auto").toLowerCase();
  if (["txt", "text", "url", "tab"].includes(requested)) return "text";
  if (requested !== "auto") return requested;
  const raw = String(content || "").replace(/^\uFEFF/, "").trimStart();
  if (raw.startsWith("{") || raw.startsWith("[")) return "json";
  if (/^#EXTM3U/im.test(raw)) return "m3u";
  return "text";
}

export async function importMusicPlaylist({ format = "auto", sourceName = "粘贴内容", name = "我的歌单", content }) {
  if (detectNeteasePlaylistShare(content)) {
    throw new Error("这是网易云歌单网页分享，不是音频直链或歌单文件，不能直接导入。");
  }
  const resolvedFormat = resolveImportFormat(content, format);
  const items = parseMusicText(content, resolvedFormat);
  if (!items.length) throw new Error("没有解析到可播放曲目。");
  return normalizeMusicPlaylist(await apiRequest("/api/v2/music/playlists/import", {
    method: "POST", timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ format: resolvedFormat, source_name: text(sourceName, 180), name: text(name, 180), content: String(content || "") }),
  }));
}

export async function listMusicPlaylists() {
  const data = await apiRequest("/api/v2/music/playlists", { timeoutMs: READ_TIMEOUT_MS });
  return (Array.isArray(data?.playlists) ? data.playlists : []).map(normalizeMusicPlaylist);
}

export async function getMusicPlaylist(id) {
  return normalizeMusicPlaylist(await apiRequest(`/api/v2/music/playlists/${encodeURIComponent(id)}`, { timeoutMs: READ_TIMEOUT_MS }));
}

export async function deleteMusicPlaylist(id) {
  return apiRequest(`/api/v2/music/playlists/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: WRITE_TIMEOUT_MS });
}

export async function listMusicFavorites() {
  const data = await apiRequest("/api/v2/music/favorites", { timeoutMs: READ_TIMEOUT_MS });
  const favorites = Array.isArray(data?.favorites) ? data.favorites : Array.isArray(data) ? data : [];
  return Object.freeze(favorites.map(normalizeFavorite).filter((entry) => entry.itemId));
}

export async function putMusicFavorite(itemId) {
  const data = await apiRequest(`/api/v2/music/favorites/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: "{}",
  });
  return normalizeFavorite(data?.favorite || data);
}

export async function deleteMusicFavorite(itemId) {
  const data = await apiRequest(`/api/v2/music/favorites/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return Object.freeze({
    itemId: text(data?.deleted?.item_id ?? itemId, 100),
    favorited: false,
  });
}
