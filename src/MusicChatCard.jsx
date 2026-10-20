import { useEffect, useRef, useState } from "react";
import { FileText, Music2, Pause, Play } from "lucide-react";
import { fetchMusicLyrics, fetchMusicTrackUrl } from "./music-lyrics-client.js";
import { activeLyricIndex, parseLrc } from "./music-lyrics.js";

const PLAY_EVENT = "dengta:chat-music-play";
const eventBus = globalThis.window || new EventTarget();

function formatTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}

export default function MusicChatCard({ music, onPlaybackChange, onAudioRefresh }) {
  const playbackChangeRef = useRef(onPlaybackChange);
  useEffect(() => { playbackChangeRef.current = onPlaybackChange; }, [onPlaybackChange]);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(Number(music?.duration_seconds) || 0);
  const [error, setError] = useState("");
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyrics, setLyrics] = useState([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState("");
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState(String(music?.audio_url || ""));
  const [refreshingAudio, setRefreshingAudio] = useState(false);
  const lyricsListRef = useRef(null);
  const audioUrl = resolvedAudioUrl;
  const canPlay = /^https:\/\//i.test(audioUrl);
  const activeIndex = activeLyricIndex(lyrics, position);

  useEffect(() => {
    if (!lyricsOpen) return;
    const active = lyricsListRef.current?.querySelector("[data-active='true']");
    active?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [activeIndex, lyricsOpen]);

  async function refreshAudio() {
    if (refreshingAudio) return;
    setRefreshingAudio(true);
    try {
      const url = await fetchMusicTrackUrl(music?.id);
      if (url) {
        setResolvedAudioUrl(url);
        setError("");
        onAudioRefresh?.({ id: music?.id, url });
      } else {
        setError("这首歌暂时没有可内播的音频。");
      }
    } catch {
      setError("音频地址刷新失败，稍后再试。");
    } finally {
      setRefreshingAudio(false);
    }
  }

  async function openLyrics() {
    if (!canPlay) return;
    setLyricsOpen(true);
    if (lyrics.length > 0 || lyricsLoading) return;
    setLyricsLoading(true);
    setLyricsError("");
    try {
      const data = await fetchMusicLyrics(music?.id);
      const parsed = parseLrc(data?.lyric);
      const translated = parseLrc(data?.translated_lyric);
      if (parsed.length === 0) setLyricsError("这首歌暂时没有可显示的歌词。");
      else {
        const translationByTime = new Map(translated.map((line) => [line.time.toFixed(2), line.text]));
        setLyrics(parsed.map((line) => ({
          ...line,
          translation: translationByTime.get(line.time.toFixed(2)) || "",
        })));
      }
    } catch {
      setLyricsError("歌词暂时加载失败，稍后再试。");
    } finally {
      setLyricsLoading(false);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setPosition(audio.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : Number(music?.duration_seconds) || 0);
    const onPlay = () => {
      setPlaying(true);
      playbackChangeRef.current?.(true);
      eventBus.dispatchEvent?.(new CustomEvent(PLAY_EVENT, { detail: { id: music?.id } }));
    };
    const onPause = () => { setPlaying(false); playbackChangeRef.current?.(false); };
    const onEnded = () => { setPlaying(false); setPosition(0); playbackChangeRef.current?.(false); };
    const onError = () => { setPlaying(false); playbackChangeRef.current?.(false); setError("这首暂时无法在内置播放器加载，可能受版权或链接有效期限制。"); };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, [music?.id, music?.duration_seconds, audioUrl]);

  useEffect(() => {
    const onOtherPlay = (event) => {
      if (event.detail?.id !== music?.id) audioRef.current?.pause();
    };
    eventBus.addEventListener?.(PLAY_EVENT, onOtherPlay);
    return () => eventBus.removeEventListener?.(PLAY_EVENT, onOtherPlay);
  }, [music?.id]);

  if (!music?.id || !music?.title) return null;

  const seekTo = (time) => {
    const audio = audioRef.current;
    if (!audio || !canPlay) return;
    const next = Math.max(0, Number(time) || 0);
    audio.currentTime = next;
    setPosition(next);
    if (audio.paused) void audio.play().catch(() => {});
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !canPlay) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError("浏览器没有允许自动播放，请再点一次播放。");
      }
    } else {
      audio.pause();
    }
  };

  return (
    <>
    <article className={`chat-music-card${playing ? " is-playing" : ""}${!canPlay ? " is-unavailable" : ""}`}>
      <div className="chat-music-cover" aria-hidden="true">
        {music.cover_url ? <img src={music.cover_url} alt="" loading="lazy" /> : <Music2 size={22} />}
      </div>
      <div className="chat-music-copy">
        <strong>{music.title}</strong>
        <span>{[music.artist, music.album].filter(Boolean).join(" · ") || "网易云音乐"}</span>
        {canPlay ? (
          <div className="chat-music-progress">
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.1"
              value={Math.min(position, duration || position)}
              aria-label="歌曲进度"
              onChange={(event) => {
                const audio = audioRef.current;
                const next = Number(event.target.value) || 0;
                setPosition(next);
                if (audio) audio.currentTime = next;
              }}
            />
            <small>{formatTime(position)} / {duration ? formatTime(duration) : "--:--"}</small>
          </div>
        ) : (
          <small className="chat-music-unavailable">暂无可内播音频（可能需要会员或版权受限）</small>
        )}
        {error && (
          <div className="chat-music-error" role="alert">
            <small>{error}</small>
            <button type="button" className="chat-music-retry" disabled={refreshingAudio} onClick={() => void refreshAudio()}>
              {refreshingAudio ? "解析中…" : "重新获取音频"}
            </button>
          </div>
        )}
      </div>
      {canPlay && (
        <button type="button" className="chat-music-lyric-button" aria-label="查看歌词" onClick={() => void openLyrics()}>
          <FileText size={16} />
        </button>
      )}
      <button type="button" className="chat-music-toggle" aria-label={playing ? "暂停" : "播放"} disabled={!canPlay} onClick={() => void toggle()}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      {canPlay && <audio ref={audioRef} src={audioUrl} preload="metadata" playsInline />}
    </article>
    {lyricsOpen && (
      <div className="music-lyrics-backdrop" role="presentation" onClick={() => setLyricsOpen(false)}>
        <section className="music-lyrics-sheet" role="dialog" aria-modal="true" aria-label={"歌词：" + music.title} onClick={(event) => event.stopPropagation()}>
          <header>
            <div>
              <strong>{music.title}</strong>
              <span>{music.artist || "网易云音乐"}</span>
            </div>
            <button type="button" aria-label="关闭歌词" onClick={() => setLyricsOpen(false)}>×</button>
          </header>
          {lyricsLoading && <p className="music-lyrics-status">正在加载歌词…</p>}
          {!lyricsLoading && lyricsError && <p className="music-lyrics-status">{lyricsError}</p>}
          {!lyricsLoading && !lyricsError && (
            <div className="music-lyrics-list" ref={lyricsListRef}>
              {lyrics.map((line, index) => (
                <button
                  type="button"
                  className="music-lyric-line"
                  key={line.time + "-" + index}
                  data-active={index === activeIndex ? "true" : "false"}
                  onClick={() => seekTo(line.time)}
                >
                  <span>{line.text}</span>
                  {line.translation && <small>{line.translation}</small>}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    )}
    </>
  );
}
