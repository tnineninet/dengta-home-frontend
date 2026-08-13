import { useEffect, useRef, useState } from "react";
import { CircleStop, Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatMediaTime } from "./co-watch.js";
import { getMusicPlaylist, listMusicPlaylists, validateDirectAudioUrl } from "./music-listening.js";

const ERROR_MESSAGE = "音频无法播放。链接可能已过期、需要登录、受到防盗链限制，或使用了 DRM。DengTa 不会绕过这些限制。";

export default function TogetherMusic({ session, busy = false, onStart, onEnd, onPlaybackChange, onPositionChange }) {
  const audioRef = useRef(null);
  const lastReportRef = useRef(0);
  const [playlists, setPlaylists] = useState([]);
  const [playlist, setPlaylist] = useState(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [feedback, setFeedback] = useState("");

  useEffect(() => { void listMusicPlaylists().then(setPlaylists).catch((error) => setFeedback(error?.message || "歌单暂时无法读取。")); }, []);
  const item = playlist?.items?.[index] || null;
  const report = (event, immediate = false) => {
    const audio = event?.currentTarget || audioRef.current;
    if (!audio || !session?.id) return;
    const nextPosition = Number(audio.currentTime) || 0;
    const nextDuration = Number(audio.duration) || item?.durationSeconds || 0;
    setPosition(nextPosition); setDuration(nextDuration); onPositionChange?.(nextPosition);
    if (immediate || Date.now() - lastReportRef.current >= 15_000) {
      lastReportRef.current = Date.now();
      onPlaybackChange?.({ sessionId: session.id, playbackState: audio.paused ? "paused" : "playing", mediaPositionSeconds: nextPosition, mediaDurationSeconds: nextDuration, musicPlaylistId: playlist?.id, musicPlaylistItemId: item?.id, revision: session.revision });
    }
  };
  const selectPlaylist = async (id) => { const next = await getMusicPlaylist(id); setPlaylist(next); setIndex(0); setPosition(0); setFeedback(""); };
  const selectItem = (nextIndex) => {
    const boundedIndex = Math.max(0, Math.min((playlist?.items?.length || 1) - 1, nextIndex));
    const nextItem = playlist?.items?.[boundedIndex];
    setIndex(boundedIndex); setPosition(0); setPlaying(false);
    if (session?.id && nextItem) onPlaybackChange?.({ sessionId: session.id, playbackState: "paused", mediaPositionSeconds: 0, mediaDurationSeconds: nextItem.durationSeconds, musicPlaylistId: playlist.id, musicPlaylistItemId: nextItem.id, revision: session.revision });
  };
  const start = async () => { if (!item) return; const validation = validateDirectAudioUrl(item.url); if (!validation.ok) { setFeedback(validation.message); return; } const result = await onStart?.({ title: item.title, sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: item.id, mediaDurationSeconds: item.durationSeconds, mediaPositionSeconds: 0 }); if (result === false) return; setFeedback("一起听歌已开始。音频由浏览器直接播放。"); window.setTimeout(() => void audioRef.current?.play().catch(() => setFeedback("浏览器阻止了自动播放，请点击播放按钮。")), 0); };
  useEffect(() => { if (!item || !audioRef.current) return; audioRef.current.load(); }, [item]);
  useEffect(() => { if (!item || typeof navigator === "undefined" || !("mediaSession" in navigator)) return; const changeTrack = (nextIndex) => { const boundedIndex = Math.max(0, Math.min((playlist?.items?.length || 1) - 1, nextIndex)); const nextItem = playlist?.items?.[boundedIndex]; setIndex(boundedIndex); setPosition(0); setPlaying(false); if (session?.id && nextItem) onPlaybackChange?.({ sessionId: session.id, playbackState: "paused", mediaPositionSeconds: 0, mediaDurationSeconds: nextItem.durationSeconds, musicPlaylistId: playlist.id, musicPlaylistItemId: nextItem.id, revision: session.revision }); }; navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist || "", album: item.album || playlist?.name || "一起听歌" }); navigator.mediaSession.setActionHandler?.("play", () => void audioRef.current?.play()); navigator.mediaSession.setActionHandler?.("pause", () => audioRef.current?.pause()); navigator.mediaSession.setActionHandler?.("previoustrack", () => changeTrack(index - 1)); navigator.mediaSession.setActionHandler?.("nexttrack", () => changeTrack(index + 1)); }, [item, index, playlist, session, onPlaybackChange]);

  return <div className="together-setup together-music-setup">
    <div className="music-player-title"><Music2 aria-hidden="true" /><div><strong>{item?.title || "选择一首歌"}</strong><span>{item?.artist || "一起听歌"}</span></div></div>
    <label>歌单<select value={playlist?.id || ""} onChange={(event) => void selectPlaylist(event.target.value)}><option value="">选择已导入歌单</option>{playlists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    {playlist && <label>曲目<select value={index} onChange={(event) => selectItem(Number(event.target.value))}>{playlist.items.map((entry, itemIndex) => <option key={entry.id || itemIndex} value={itemIndex}>{itemIndex + 1}. {entry.title}{entry.artist ? ` · ${entry.artist}` : ""}</option>)}</select></label>}
    <audio ref={audioRef} src={item?.url || ""} preload="metadata" controls={false} onLoadedMetadata={(event) => report(event, false)} onTimeUpdate={(event) => report(event)} onPlay={(event) => { setPlaying(true); report(event, true); }} onPause={(event) => { setPlaying(false); report(event, true); }} onSeeked={(event) => report(event, true)} onEnded={(event) => { setPlaying(false); report(event, true); if (index < (playlist?.items?.length || 1) - 1) selectItem(index + 1); }} onError={() => { setPlaying(false); setFeedback(ERROR_MESSAGE); }} aria-label="一起听歌音频播放器" />
    <input className="music-progress-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || position)} disabled={!duration} onChange={(event) => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setPosition(next); }} aria-label="播放进度" />
    <div className="music-player-actions"><button type="button" aria-label="上一首" disabled={!playlist || index === 0} onClick={() => selectItem(index - 1)}><SkipBack /></button><button type="button" className="together-primary" disabled={!item || busy} onClick={() => { if (playing) audioRef.current?.pause(); else if (session?.status === "active") void audioRef.current?.play(); else void start(); }}>{playing ? <Pause /> : <Play />}{playing ? "暂停" : session?.status === "active" ? "播放" : "开始一起听"}</button><button type="button" aria-label="下一首" disabled={!playlist || index >= playlist.items.length - 1} onClick={() => selectItem(index + 1)}><SkipForward /></button></div>
    {session?.status === "active" && <button type="button" disabled={busy} onClick={() => void onEnd?.({ title: item?.title, mediaPositionSeconds: position, musicPlaylistId: playlist?.id, musicPlaylistItemId: item?.id })}><CircleStop />结束本场</button>}
    <p className="together-device-note">{formatMediaTime(position)} / {duration ? formatMediaTime(duration) : "等待媒体信息"}。只接受可直接访问的 HTTPS 音频地址；不代理、不下载、不绕过 DRM。</p>
    {feedback && <p className="together-feedback is-error" role="alert">{feedback}</p>}
  </div>;
}
