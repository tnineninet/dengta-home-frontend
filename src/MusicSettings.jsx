import { Clipboard } from "@capacitor/clipboard";
import { useEffect, useRef, useState } from "react";
import {
  detectNeteasePlaylistShare,
  deleteMusicPlaylist,
  getMusicPlaylist,
  importMusicPlaylist,
  listMusicPlaylists,
} from "./music-listening.js";

const PROVIDERS = [
  ["local_playlist", "本地歌单", "ready", "可用"],
  ["direct_https", "HTTPS 音频直链", "ready", "可用"],
  ["netease", "网易云音乐 MCP", "unconnected", "等待用户自托管连接"],
];

const PLAYLIST_ACCEPT = ".json,.m3u,.m3u8,.txt,application/json,text/plain,audio/x-mpegurl";
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

  const localAudioUrlRef = useRef("");
  const neteaseShare = detectNeteasePlaylistShare(content);
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
  useEffect(() => () => {
    if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
  }, []);

  async function importPlaylist() {
    if (neteaseShare) {
      setError("");
      setMessage(`已识别 ${neteaseShare.provider} 歌单 ${neteaseShare.playlistId}；网页分享不会导入，请使用网易云 MCP 或合法歌单文件。`);
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
      setFileName(file.name);
      setFormat(lower.endsWith(".json") ? "json" : /\.m3u8?$/.test(lower) ? "m3u" : "txt");
      setContent(await file.text());
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
        return <div className="music-provider-status" key={id}><strong>{label}</strong><span className={`provider-dot ${status}`}>{remote?.display_name || fallbackText}</span>{id === "netease" && <><small>可通过用户自托管的网易云 MCP 管理歌单；网页分享不会被当作音频导入。</small><button type="button" onClick={onOpenMcpDeviceCenter}>去连接网易云 MCP</button></>}</div>;
      })}
    </div>
    <div className="music-import-grid">
      <label>歌单名称<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
      <label>格式<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="json">JSON</option><option value="m3u">M3U / M3U8</option><option value="txt">TXT</option></select></label>
      <label className="music-file-label">导入歌单文件（JSON/M3U/M3U8/TXT）<input type="file" accept={PLAYLIST_ACCEPT} disabled={busy || fileBusy} onChange={(event) => void choosePlaylistFile(event)} /></label>
      <label className="music-file-label">选择本机音频（MP3/M4A/AAC/WAV/OGG/OPUS/FLAC）<input type="file" accept={AUDIO_ACCEPT} disabled={fileBusy} onChange={chooseLocalAudio} /></label>
      <label className="music-content-label">粘贴歌单文本<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="JSON、M3U 或每行一个 HTTPS 音频地址" /></label>
      <div className="music-clipboard-actions"><button type="button" disabled={clipboardBusy || busy} onClick={() => void readClipboard()}>{clipboardBusy ? "读取中…" : "读取剪贴板"}</button><span role="status">{content.trim() ? `已输入 ${content.trim().length} 个字符，可执行主操作。` : "等待粘贴或读取歌单文本。"}</span></div>
    </div>
    {neteaseShare && <div className="music-share-recognition" role="status"><strong>{neteaseShare.provider}</strong><span>Playlist ID：{neteaseShare.playlistId}</span><span>标题提示：{neteaseShare.title}</span><p>这是网页分享入口，不是音频 URL，DengTa 不会抓取网页或声称已导入。</p><button type="button" onClick={onOpenMcpDeviceCenter}>去连接网易云 MCP</button></div>}
    <button type="button" className="together-primary" disabled={!canImport} onClick={() => void importPlaylist()}>{busy ? "正在导入…" : neteaseShare ? "确认识别结果（不会导入）" : "导入歌单"}</button>
    {localAudio && <section className="music-local-audio" aria-label="本机音频播放器"><strong>{localAudio.name}</strong><audio src={localAudio.url} controls playsInline preload="metadata" /><p>仅本机播放，不能投屏/跨设备同步；文件不会上传、发送后端或交给 AI。</p></section>}
    {error && <p className="music-feedback is-error" role="alert">{error}</p>}{message && <p className="music-feedback" role="status">{message}</p>}
    <div className="music-playlist-list"><h4>已保存歌单</h4>{playlists.length ? playlists.map((playlist) => <article key={playlist.id}><button type="button" className="music-playlist-summary" onClick={async () => setSelected(await getMusicPlaylist(playlist.id))}><strong>{playlist.name}</strong><span>{playlist.itemCount} 首 · {playlist.provider}</span></button><button type="button" className="danger" disabled={busy} onClick={() => void removePlaylist(playlist.id)}>删除</button></article>) : <p>还没有导入歌单。</p>}</div>
    {selected && <section className="music-playlist-detail" aria-label="歌单详情"><h4>{selected.name}</h4>{selected.items.map((item, index) => <div key={item.id || index}><span>{index + 1}</span><strong>{item.title}</strong><small>{item.artist || "未知艺术家"}</small></div>)}</section>}
  </section>;
}
