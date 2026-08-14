import { Clipboard } from "@capacitor/clipboard";
import { useEffect, useRef, useState } from "react";
import {
  detectNeteaseShare,
  deleteMusicPlaylist,
  getNeteaseConnectionStatus,
  getNeteasePlaylist,
  getMusicPlaylist,
  importNeteaseShare,
  importMusicPlaylist,
  listNeteaseConnections,
  listNeteasePlaylists,
  listMusicPlaylists,
  requestExternalMusicPlayback,
  searchNeteaseMusic,
} from "./music-listening.js";
import { MAX_PLAYLIST_TEXT_LENGTH, readPlaylistTextFile } from "./playlist-file.js";
import { resolveMusicPlayback, MUSIC_PLAYBACK_MODES } from "./music-playback.js";
import { openNeteasePlayback } from "./netease-playback.js";

const PROVIDERS = [
  ["local_playlist", "本地歌单", "ready", "可用"],
  ["direct_https", "HTTPS 音频直链", "ready", "可用"],
  ["netease", "网易云音乐 MCP", "unconnected", "等待用户自托管连接"],
];

const PLAYLIST_ACCEPT = ".json,.m3u,.m3u8,.txt,application/json,text/plain,audio/x-mpegurl,application/vnd.apple.mpegurl";
const AUDIO_ACCEPT = ".mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/opus,audio/flac";
const AUDIO_EXTENSION = /\.(?:mp3|m4a|aac|wav|ogg|opus|flac)$/i;

export default function MusicSettings({ providerStatus = null, onOpenMcpDeviceCenter }) {
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [format, setFormat] = useState("auto");
  const [name, setName] = useState("我的歌单");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [localAudio, setLocalAudio] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [neteaseConnections, setNeteaseConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [neteaseStatus, setNeteaseStatus] = useState(null);
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [remoteSelected, setRemoteSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [neteaseBusy, setNeteaseBusy] = useState("");

  const localAudioUrlRef = useRef("");
  const neteaseShare = detectNeteaseShare(content);
  const canImport = Boolean(content.trim()) && !busy;

  async function refresh({ quiet = false } = {}) {
    setRefreshing(true);
    if (!quiet) setError("");
    try {
      setPlaylists(await listMusicPlaylists());
      return true;
    } catch (caught) {
      setError(caught?.message || "歌单暂时无法读取，请稍后重试。");
      return false;
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    let active = true;
    listMusicPlaylists().then((items) => {
      if (active) setPlaylists(items);
    }).catch((caught) => {
      if (active) setError(caught?.message || "歌单暂时无法读取。");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    listNeteaseConnections().then((items) => {
      if (!active) return;
      setNeteaseConnections(items);
      setConnectionId((current) => current || String(items[0]?.id || ""));
    }).catch((caught) => {
      if (active) setError(caught?.message || "网易云 MCP 连接暂时无法读取。");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!connectionId) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) setNeteaseBusy("loading");
      return Promise.allSettled([getNeteaseConnectionStatus(connectionId), listNeteasePlaylists(connectionId)]);
    }).then(([statusResult, playlistsResult]) => {
      if (!active) return;
      if (statusResult.status === "fulfilled") setNeteaseStatus(statusResult.value);
      if (playlistsResult.status === "fulfilled") setRemotePlaylists(playlistsResult.value);
      const failure = statusResult.status === "rejected" ? statusResult.reason : playlistsResult.status === "rejected" ? playlistsResult.reason : null;
      if (failure) setError(failure?.message || "网易云账号状态或歌单读取失败。");
    }).finally(() => { if (active) setNeteaseBusy(""); });
    return () => { active = false; };
  }, [connectionId]);

  function selectNeteaseConnection(nextId) {
    setConnectionId(nextId);
    setNeteaseStatus(null);
    setRemotePlaylists([]);
    setRemoteSelected(null);
    setSearchResults([]);
  }
  useEffect(() => () => {
    if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
  }, []);

  async function importPlaylist() {
    if (neteaseShare) {
      setBusy(true); setError(""); setMessage("");
      try {
        const imported = await importNeteaseShare(connectionId, content);
        setContent(""); setFileName(""); setSelected(imported);
        setMessage(connectionId ? "网易云内容已导入，可在下方查看曲目。" : "已保存网易云链接元数据；连接 MCP 后可补全歌单曲目，也可直接跳转网易云。音频可用性由网易云判断。");
        await refresh({ quiet: true });
      } catch (caught) { setError(caught?.message || "网易云分享链接导入失败。"); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await importMusicPlaylist({ format, sourceName: fileName || "粘贴内容", name, content });
      setContent(""); setFileName(""); setMessage("歌单已导入。曲目地址仍由浏览器直接访问，不经过 DengTa 后端代理。");
      void refresh({ quiet: true }).then((ok) => {
        if (!ok) setMessage("歌单已导入；列表刷新失败，可稍后手动刷新，页面仍可继续使用。");
      });
    } catch (caught) { setError(caught?.message || "歌单导入失败。"); } finally { setBusy(false); }
  }

  async function searchNetease() {
    if (!connectionId || !searchQuery.trim()) return;
    setNeteaseBusy("search"); setError("");
    try { setSearchResults(await searchNeteaseMusic(connectionId, searchQuery)); }
    catch (caught) { setError(caught?.message || "网易云搜索失败。"); }
    finally { setNeteaseBusy(""); }
  }

  async function openExternal(item, resourceType = "song", fallbackId = "") {
    const playback = resolveMusicPlayback(item);
    const resourceId = playback.resourceId || fallbackId;
    try {
      const opening = openNeteasePlayback(resourceType, resourceId);
      void requestExternalMusicPlayback(resourceType, resourceId).catch(() => {});
      await opening;
    } catch (caught) { setError(caught?.message || "无法打开网易云播放。"); }
  }

  async function removePlaylist(id) {
    setBusy(true); setError("");
    try {
      await deleteMusicPlaylist(id); setSelected(null); setMessage("歌单已删除。");
      void refresh({ quiet: true }).then((ok) => {
        if (!ok) setMessage("歌单已删除；列表刷新失败，可稍后手动刷新。");
      });
    } catch (caught) { setError(caught?.message || "歌单删除失败。"); } finally { setBusy(false); }
  }

  async function readClipboard() {
    setClipboardBusy(true); setError("");
    try {
      let value = "";
      try { value = String((await Clipboard.read())?.value || ""); } catch {
        if (!navigator.clipboard?.readText) throw new Error("当前设备不允许读取剪贴板，请长按输入框手动粘贴。");
        value = await navigator.clipboard.readText();
      }
      if (!value.trim()) throw new Error("剪贴板里没有可读取的文本，请复制歌单内容后重试。");
      if (value.length > MAX_PLAYLIST_TEXT_LENGTH) throw new Error("歌单文本不能超过 1 MiB，请精简后重试。");
      setContent(value);
      setMessage("已从剪贴板读取文本，请确认识别状态后继续。");
    } catch (caught) {
      setError(caught?.message || "剪贴板权限被拒绝。你可以授权后重试，或长按输入框手动粘贴。");
    } finally { setClipboardBusy(false); }
  }

  async function choosePlaylistFile(event) {
    const input = event.currentTarget;
    setFileBusy(true); setError("");
    try {
      const file = input.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const value = await readPlaylistTextFile(file);
      setFileName(file.name);
      setFormat(lower.endsWith(".json") ? "json" : /\.m3u8?$/.test(lower) ? "m3u" : "txt");
      setContent(value);
      setMessage(`已读取歌单文件：${file.name}`);
    } catch (caught) { setError(caught?.message || "歌单文件读取失败，请重新选择。"); }
    finally { input.value = ""; setFileBusy(false); }
  }

  function chooseLocalAudio(event) {
    const input = event.currentTarget;
    setFileBusy(true); setError("");
    try {
      const file = input.files?.[0];
      if (!file) return;
      if (!AUDIO_EXTENSION.test(file.name) && !String(file.type).startsWith("audio/")) throw new Error("请选择 MP3、M4A、AAC、WAV、OGG、OPUS 或 FLAC 音频文件。");
      if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
      const url = URL.createObjectURL(file);
      localAudioUrlRef.current = url;
      setLocalAudio({ name: file.name, url, type: file.type });
      setMessage(`已在本机载入：${file.name}`);
    } catch (caught) { setError(caught?.message || "本机音频选择失败，请重试。"); }
    finally { input.value = ""; setFileBusy(false); }
  }

  return <section className="music-settings settings-card" aria-labelledby="music-settings-title">
    <div className="settings-card-heading"><div><span className="settings-kicker">LISTENING</span><h3 id="music-settings-title">一起听歌</h3><p>只播放你提供的公开音频地址，不下载、不代理、不绕过 DRM。</p></div><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "刷新中…" : "刷新"}</button></div>
    <div className="music-provider-grid" aria-label="音乐 Provider 状态">
      {PROVIDERS.map(([id, label, fallbackStatus, fallbackText]) => {
        const remote = Array.isArray(providerStatus?.providers) ? providerStatus.providers.find((item) => item?.id === id) : null;
        const status = remote?.status || fallbackStatus;
        return <div className="music-provider-status" key={id}><strong>{label}</strong><span className={`provider-dot ${status}`}>{remote?.display_name || fallbackText}</span>{id === "netease" && <><small>通过用户自托管的 Code-MonkeyZhang/cloud-music-mcp 接入：元数据/歌单管理可用，Together 音频不可用。</small><button type="button" onClick={onOpenMcpDeviceCenter}>去连接网易云 MCP</button></>}</div>;
      })}
    </div>
    <section className="music-netease-library" aria-label="网易云音乐连接与曲库">
      <h4>网易云音乐</h4>
      <label>已保存 MCP 连接<select value={connectionId} onChange={(event) => selectNeteaseConnection(event.target.value)}><option value="">选择 provider_profile=netease_cloud_music 的连接</option>{neteaseConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
      {!neteaseConnections.length && <p>尚未保存网易云 Provider 连接。<button type="button" onClick={onOpenMcpDeviceCenter}>去 MCP 设备中心</button></p>}
      {connectionId && <div className="music-netease-status"><strong>账号状态</strong><span>{neteaseStatus?.display_name || neteaseStatus?.account_name || neteaseStatus?.status || (neteaseBusy === "loading" ? "读取中…" : "未知")}</span><small>登录只可在自托管管理页完成；DengTa 不调用 cloud_music_login，也不接收 Cookie。</small></div>}
      {connectionId && <><div className="music-remote-playlists"><strong>远端歌单</strong>{remotePlaylists.length ? remotePlaylists.map((playlist) => <button type="button" key={playlist.providerPlaylistId || playlist.id} onClick={async () => { setNeteaseBusy("playlist"); setError(""); try { setRemoteSelected(await getNeteasePlaylist(connectionId, playlist.providerPlaylistId || playlist.id)); } catch (caught) { setError(caught?.message || "远端歌单读取失败。"); } finally { setNeteaseBusy(""); } }}><span>{playlist.name}</span><small>{playlist.itemCount} 首</small></button>) : <p>{neteaseBusy === "loading" ? "正在读取远端歌单…" : "没有可显示的远端歌单。"}</p>}</div>
      <div className="music-netease-search"><label>搜索网易云曲目<input value={searchQuery} maxLength={500} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchNetease(); } }} /></label><button type="button" disabled={!searchQuery.trim() || Boolean(neteaseBusy)} onClick={() => void searchNetease()}>{neteaseBusy === "search" ? "搜索中…" : "搜索"}</button></div></>}
      {(remoteSelected || searchResults.length > 0) && <div className="music-external-results"><strong>{remoteSelected ? remoteSelected.name : "搜索结果"}</strong>{(remoteSelected?.items || searchResults).map((item, index) => <div key={item.id || item.providerTrackId || index}><span><b>{item.title}</b><small>{item.artist || "未知艺术家"}</small></span><button type="button" onClick={() => void openExternal(item)}>在网易云播放</button></div>)}<p>普通歌曲、VIP 歌曲和版权可用性均由网易云判断。</p></div>}
    </section>
    <div className="music-import-grid">
      <label>歌单名称<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
      <label>格式<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="json">JSON</option><option value="m3u">M3U / M3U8</option><option value="txt">TXT</option></select></label>
      <label className="music-file-label">导入歌单文件（JSON/M3U/M3U8/TXT）<input type="file" accept={PLAYLIST_ACCEPT} disabled={busy || fileBusy} onChange={(event) => void choosePlaylistFile(event)} /></label>
      <label className="music-file-label">选择本机音频（MP3/M4A/AAC/WAV/OGG/OPUS/FLAC）<input type="file" accept={AUDIO_ACCEPT} disabled={fileBusy} onChange={chooseLocalAudio} /></label>
      <label className="music-content-label">粘贴歌单文本<textarea value={content} maxLength={MAX_PLAYLIST_TEXT_LENGTH} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="JSON、M3U、每行一个 HTTPS 音频地址，或网易云分享文本" aria-describedby="music-content-limit" /></label>
      <div className="music-clipboard-actions"><button type="button" disabled={clipboardBusy || busy} onClick={() => void readClipboard()}>{clipboardBusy ? "读取中…" : "读取剪贴板"}</button><span id="music-content-limit" role="status">{content.trim() ? `已输入 ${content.trim().length} 个字符（上限 ${MAX_PLAYLIST_TEXT_LENGTH}）。` : "等待粘贴或读取歌单文本，最大 1 MiB。"}</span></div>
    </div>
    {neteaseShare && <div className="music-share-recognition" role="status"><strong>{neteaseShare.provider}</strong><span>{neteaseShare.resourceType === "short" ? "已识别网易云短链" : `${neteaseShare.resourceType === "song" ? "Song" : "Playlist"} ID：${neteaseShare.resourceId}`}</span><span>标题提示：{neteaseShare.title}</span><p>{connectionId && neteaseShare.resourceType === "playlist" ? "将通过所选自托管连接导入歌单元数据与曲目。" : "将先保存链接元数据；无需 Cookie，仍可跳转网易云。"}</p>{neteaseShare.resourceId && <button type="button" onClick={() => void openExternal({}, neteaseShare.resourceType, neteaseShare.resourceId)}>在网易云打开</button>}{!connectionId && onOpenMcpDeviceCenter && <button type="button" onClick={onOpenMcpDeviceCenter}>连接 MCP 以补全歌单</button>}</div>}
    <button type="button" className="together-primary" disabled={!canImport} onClick={() => void importPlaylist()}>{busy ? "正在导入…" : neteaseShare ? `导入网易云${neteaseShare.resourceType === "song" ? "单曲" : "歌单"}` : "导入歌单"}</button>
    {localAudio && <section className="music-local-audio" aria-label="本机音频播放器"><strong>{localAudio.name}</strong><audio src={localAudio.url} controls playsInline preload="metadata" /><p>仅本机播放，不能投屏/跨设备同步；文件不会上传、发送后端或交给 AI。</p></section>}
    {error && <p className="music-feedback is-error" role="alert">{error}</p>}{message && <p className="music-feedback" role="status">{message}</p>}
    <div className="music-playlist-list"><h4>已保存歌单</h4>{playlists.length ? playlists.map((playlist) => <article key={playlist.id}><button type="button" className="music-playlist-summary" aria-expanded={selected?.id === playlist.id} onClick={async () => setSelected(selected?.id === playlist.id ? null : await getMusicPlaylist(playlist.id))}><strong>{playlist.name}</strong><span>{playlist.itemCount} 首 · 来源：{playlist.provider}</span></button><button type="button" className="danger" disabled={busy} onClick={() => void removePlaylist(playlist.id)}>删除</button></article>) : <p>还没有导入歌单。</p>}</div>
    {selected && <section className="music-playlist-detail" aria-label="歌单详情"><h4>{selected.name}</h4><p>来源：{selected.provider} · {selected.itemCount} 首</p>{selected.providerPlaylistId && <button type="button" onClick={() => void openExternal({}, "playlist", selected.providerPlaylistId)}>在网易云打开歌单</button>}{selected.items.length ? selected.items.map((item, index) => { const playback = resolveMusicPlayback(item); return <div key={item.id || index}><span>{index + 1}</span><span><strong>{item.title}</strong><small>{item.artist || "未知艺术家"} · 播放模式：{playback.mode}</small></span>{playback.mode === MUSIC_PLAYBACK_MODES.external ? <button type="button" onClick={() => void openExternal(item)}>在网易云打开</button> : <audio src={playback.url} controls preload="none" aria-label={`播放 ${item.title}`} />}</div>; }) : <p>此歌单已保存链接元数据，尚无曲目；可在网易云打开，或连接 MCP 后重新导入补全。</p>}</section>}
  </section>;
}
