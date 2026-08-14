import assert from "node:assert/strict";
import fs from "node:fs";
import {
  connectNeteaseMcp,
  deleteMusicFavorite,
  deleteMusicPlaylist,
  detectNeteasePlaylistShare,
  getMusicPlaylist,
  getNeteaseConnectionStatus,
  getNeteasePlaylist,
  importMusicPlaylist,
  importNeteaseShare,
  listMusicFavorites,
  listMusicPlaylists,
  listNeteaseConnections,
  listNeteasePlaylists,
  normalizeMusicPlaylist,
  parseMusicText,
  putMusicFavorite,
  requestExternalMusicPlayback,
  searchNeteaseMusic,
  validateDirectAudioUrl,
} from "../src/music-listening.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const json = parseMusicText(JSON.stringify({ items: [{ title: "Explicit adult title", url: "https://media.example.com/a.mp3", lyrics: "成人歌词原文" }] }), "json");
assert.equal(json[0].title, "Explicit adult title");
assert.equal(json[0].lyrics, "成人歌词原文");
assert.equal(parseMusicText("#EXTM3U\n#EXTINF:123,Artist - Song\nhttps://media.example.com/song.mp3", "m3u")[0].artist, "Artist");
assert.equal(parseMusicText("https://media.example.com/one.mp3\nhttps://media.example.com/two.ogg", "txt").length, 2);
assert.equal(validateDirectAudioUrl("https://media.example.com/song.mp3").ok, true);
assert.equal(validateDirectAudioUrl("").code, "required");
assert.equal(validateDirectAudioUrl("not a url").code, "invalid");
assert.deepEqual(detectNeteasePlaylistShare("分享歌单：晚风\nhttps://music.163.com/m/playlist?id=8547232002&creatorId=1"), { provider: "网易云音乐", providerId: "netease", playlistId: "8547232002", title: "晚风" });
assert.equal(detectNeteasePlaylistShare("https://example.com/playlist?id=1"), null);
assert.deepEqual(normalizeMusicPlaylist({ id: "p1", title: "夜航", tracks: [{ id: "1", name: "星海", author: "桃桃", duration: 188 }] }), {
  id: "p1", name: "夜航", provider: "local_playlist", providerPlaylistId: "", itemCount: 1,
  items: [{ id: "1", title: "星海", artist: "桃桃", album: "", url: "", providerTrackId: "", externalUrl: "", playbackMode: "", durationSeconds: 188, lyrics: "" }],
  createdAt: "",
});
assert.equal(normalizeMusicPlaylist({ playlist: { items: ["https://media.example.com/raw.mp3"] } }).items[0].url, "https://media.example.com/raw.mp3");
assert.equal(normalizeMusicPlaylist({ items: "invalid" }).items.length, 0);
assert.equal(parseMusicText("", "auto").length, 0);
assert.equal(parseMusicText("\uFEFF[{\"url\":\"https://media.example.com/a.mp3\"}]", "auto").length, 1);
assert.equal(parseMusicText("# comment\nhttps://media.example.com/a.mp3", "auto").length, 1);
for (const unsafe of ["http://example.com/a.mp3", "javascript:alert(1)", "data:audio/mp3;base64,x", "file:///a.mp3", "https://localhost/a.mp3", "https://192.168.1.2/a.mp3", "https://user:pass@example.com/a.mp3"]) assert.equal(validateDirectAudioUrl(unsafe).ok, false);
const api = source("../src/music-listening.js");
assert.match(api, /\/api\/v2\/music\/playlists\/import/);
assert.match(api, /\/api\/v2\/music\/playlists/);
assert.match(api, /listMusicPlaylists[\s\S]*timeoutMs: READ_TIMEOUT_MS/);
assert.match(api, /connectNeteaseMcp[\s\S]*\/api\/v2\/music\/providers\/netease\/connections\/provision/);
assert.match(api, /connectNeteaseMcp[\s\S]*method: "POST"[\s\S]*token: String\(token \?\? ""\)\.trim\(\)/);
assert.doesNotMatch(api, /proxy|download|drm.*bypass/i);
const player = source("../src/TogetherMusic.jsx");
assert.match(player, /<audio[\s\S]*?preload="metadata"[\s\S]*?controls=\{false\}/);
assert.match(player, /onPlay=\{[\s\S]*?onPause=\{[\s\S]*?onSeeked=\{[\s\S]*?onEnded=\{/);
assert.match(player, /Date\.now\(\) - lastReportRef\.current >= 15_000/);
assert.match(player, /"mediaSession" in navigator/);
assert.match(player, /链接可能已过期、需要登录、受到防盗链限制，或使用了 DRM/);
assert.match(player, /高级用户：连接自己的网易云接口/);
assert.match(player, /Token 不是网易云 Cookie/);
assert.match(player, /自动识别、保存并启用/);
assert.match(player, /接口 Token（可选）/);
assert.match(player, /connectNeteaseMcp\(\{ name: connectionName, endpoint: connectionEndpoint, token: connectionToken \}\)/);
assert.match(player, /setConnectionToken\(""\)/);
assert.match(player, /importNeteaseShare\(connectionId, shareUrl\)/);
const settings = source("../src/MusicSettings.jsx");
assert.match(settings, /读取剪贴板/);
assert.match(settings, /URL\.createObjectURL\(file\)/);
assert.match(settings, /URL\.revokeObjectURL/);
assert.match(settings, /仅本机播放，不能投屏\/跨设备同步/);
assert.match(settings, /导入歌单文件（JSON\/M3U\/M3U8\/TXT）/);
assert.match(settings, /选择本机音频（MP3\/M4A\/AAC\/WAV\/OGG\/OPUS\/FLAC）/);
assert.doesNotMatch(settings, /localAudio[\s\S]{0,120}file\.text/);
assert.doesNotMatch(api + player + settings, /成人.*(?:filter|replace)|敏感词|屏蔽词/i);
const together = source("../src/Together.jsx");
assert.match(together, /屏幕共看/);
assert.match(together, /视频直链/);
assert.match(together, /一起听歌/);
assert.doesNotMatch(together, /role="tab"[\s\S]{0,220}一起听歌/);
assert.match(together, /modeLocked = active \|\| directActive \|\| musicActive/);
const companionStatus = source("../src/CompanionStatus.jsx");
assert.match(companionStatus, /action\.id === "music"\) onListenTogether/);

globalThis.window = { setTimeout, clearTimeout };
const requests = [];
let nextPayload = {};
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  return { ok: true, status: 200, json: async () => nextPayload };
};

nextPayload = { connections: [{ id: "n1", provider_profile: "netease_cloud_music" }, { id: "x1", provider_profile: null }] };
assert.deepEqual((await listNeteaseConnections()).map((entry) => entry.id), ["n1"]);
nextPayload = {};
assert.deepEqual(await listNeteaseConnections(), []);
nextPayload = { connection: { id: "n2", name: "自托管音乐", adapter_id: "cloud_music_mcp" } };
assert.equal((await connectNeteaseMcp({ name: " 自托管音乐 ", endpoint: " https://music.example.com/mcp ", token: " secret " })).id, "n2");
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { name: "自托管音乐", endpoint: "https://music.example.com/mcp", token: "secret" });
nextPayload = { status: { logged_in: true } };
assert.equal((await getNeteaseConnectionStatus("n2")).status.logged_in, true);
nextPayload = { playlists: [{ id: "remote", name: "远程歌单", items: [] }] };
assert.equal((await listNeteasePlaylists("n2"))[0].name, "远程歌单");
nextPayload = [{ id: "remote-array", name: "数组歌单" }];
assert.equal((await listNeteasePlaylists("n2"))[0].id, "remote-array");
nextPayload = { playlist: { id: "remote", name: "详情", items: [{ id: "7", title: "晚风" }] } };
assert.equal((await getNeteasePlaylist("n2", "88")).items[0].title, "晚风");
nextPayload = { tracks: [{ provider_track_id: "9", title: "搜索结果", duration_seconds: 120 }] };
assert.equal((await searchNeteaseMusic("n2", "海风"))[0].providerTrackId, "9");
nextPayload = [{ id: "10", name: "数组结果" }];
assert.equal((await searchNeteaseMusic("n2", "数组"))[0].title, "数组结果");
nextPayload = { playlist: { id: "local-remote", name: "已导入", items: [] } };
assert.equal((await importNeteaseShare("n2", "https://music.163.com/playlist?id=88")).id, "local-remote");
nextPayload = { playback: { accepted: true } };
assert.equal((await requestExternalMusicPlayback("song", "9")).playback.accepted, true);
nextPayload = { playlist: { id: "local", name: "本地", items: [{ id: "a", url: "https://media.example.com/a.mp3" }] } };
assert.equal((await importMusicPlaylist({ content: "https://media.example.com/a.mp3", name: "本地" })).id, "local");
await assert.rejects(() => importMusicPlaylist({ content: "https://music.163.com/playlist?id=88" }), /网易云歌单网页分享/);
nextPayload = { playlists: [{ id: "p2", name: "列表", item_count: 0 }] };
assert.equal((await listMusicPlaylists())[0].id, "p2");
nextPayload = {};
assert.deepEqual(await listMusicPlaylists(), []);
nextPayload = { playlist: { id: "p2", name: "详情", items: [] } };
assert.equal((await getMusicPlaylist("p2")).name, "详情");
nextPayload = { deleted: { id: "p2" } };
assert.equal((await deleteMusicPlaylist("p2")).deleted.id, "p2");
nextPayload = { favorites: [{ item_id: "a", playlist_id: "p2", title: "收藏", duration_seconds: 3 }] };
assert.equal((await listMusicFavorites())[0].itemId, "a");
nextPayload = [{ item_id: "b", title: "数组收藏" }, { title: "无编号" }];
assert.deepEqual((await listMusicFavorites()).map((entry) => entry.itemId), ["b"]);
nextPayload = { favorite: { item_id: "a", playlist_id: "p2", title: "收藏" } };
assert.equal((await putMusicFavorite("a")).itemId, "a");
nextPayload = { deleted: { item_id: "a" } };
assert.deepEqual(await deleteMusicFavorite("a"), { itemId: "a", favorited: false });
console.log("music listening MVP tests passed");
