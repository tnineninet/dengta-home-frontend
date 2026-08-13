import { useEffect, useState } from "react";
import {
  deleteMusicPlaylist,
  getMusicPlaylist,
  importMusicPlaylist,
  listMusicPlaylists,
} from "./music-listening.js";

const PROVIDERS = [
  ["local_playlist", "本地歌单", "ready", "可用"],
  ["direct_https", "HTTPS 音频直链", "ready", "可用"],
  ["netease", "网易云音乐", "unconnected", "官方 OAuth 未连接 / 暂不可连接"],
];

export default function MusicSettings({ providerStatus = null }) {
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [format, setFormat] = useState("auto");
  const [name, setName] = useState("我的歌单");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    try { setPlaylists(await listMusicPlaylists()); } catch (caught) { setError(caught?.message || "歌单暂时无法读取。"); }
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

  async function importPlaylist() {
    setBusy(true); setError(""); setMessage("");
    try {
      await importMusicPlaylist({ format, sourceName: fileName || "粘贴内容", name, content });
      setContent(""); setFileName(""); setMessage("歌单已导入。曲目地址仍由浏览器直接访问，不经过 DengTa 后端代理。");
      await refresh();
    } catch (caught) { setError(caught?.message || "歌单导入失败。"); } finally { setBusy(false); }
  }

  async function removePlaylist(id) {
    setBusy(true); setError("");
    try { await deleteMusicPlaylist(id); setSelected(null); await refresh(); } catch (caught) { setError(caught?.message || "歌单删除失败。"); } finally { setBusy(false); }
  }

  return <section className="music-settings settings-card" aria-labelledby="music-settings-title">
    <div className="settings-card-heading"><div><span className="settings-kicker">LISTENING</span><h3 id="music-settings-title">一起听歌</h3><p>只播放你提供的公开音频地址，不下载、不代理、不绕过 DRM。</p></div><button type="button" onClick={() => void refresh()} disabled={busy}>刷新</button></div>
    <div className="music-provider-grid" aria-label="音乐 Provider 状态">
      {PROVIDERS.map(([id, label, fallbackStatus, fallbackText]) => {
        const remote = Array.isArray(providerStatus?.providers) ? providerStatus.providers.find((item) => item?.id === id) : null;
        const status = remote?.status || fallbackStatus;
        return <div className="music-provider-status" key={id}><strong>{label}</strong><span className={`provider-dot ${status}`}>{remote?.display_name || fallbackText}</span>{id === "netease" && <small>仅支持官方 OAuth；当前没有可连接入口。</small>}</div>;
      })}
    </div>
    <div className="music-import-grid">
      <label>歌单名称<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
      <label>格式<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="json">JSON</option><option value="m3u">M3U / M3U8</option><option value="txt">TXT</option></select></label>
      <label className="music-file-label">导入文件<input type="file" accept=".json,.m3u,.m3u8,.txt,application/json,text/plain,audio/x-mpegurl" disabled={busy} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); setFormat(file.name.toLowerCase().endsWith(".json") ? "json" : file.name.toLowerCase().match(/\.m3u8?$/) ? "m3u" : "txt"); setContent(await file.text()); event.target.value = ""; }} /></label>
      <label className="music-content-label">粘贴歌单文本<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="JSON、M3U 或每行一个 HTTPS 音频地址" /></label>
    </div>
    <button type="button" className="together-primary" disabled={busy || !content.trim()} onClick={() => void importPlaylist()}>导入歌单</button>
    {error && <p className="music-feedback is-error" role="alert">{error}</p>}{message && <p className="music-feedback" role="status">{message}</p>}
    <div className="music-playlist-list"><h4>已保存歌单</h4>{playlists.length ? playlists.map((playlist) => <article key={playlist.id}><button type="button" className="music-playlist-summary" onClick={async () => setSelected(await getMusicPlaylist(playlist.id))}><strong>{playlist.name}</strong><span>{playlist.items.length} 首 · {playlist.provider}</span></button><button type="button" className="danger" disabled={busy} onClick={() => void removePlaylist(playlist.id)}>删除</button></article>) : <p>还没有导入歌单。</p>}</div>
    {selected && <section className="music-playlist-detail" aria-label="歌单详情"><h4>{selected.name}</h4>{selected.items.map((item, index) => <div key={item.id || index}><span>{index + 1}</span><strong>{item.title}</strong><small>{item.artist || "未知艺术家"}</small></div>)}</section>}
  </section>;
}
