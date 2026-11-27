import { Disc3, Pause, Play, SkipForward, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { apiRequest } from "./api.js";
import { normalizeNowPlayingCoverUrl } from "./built-in-now-playing.js";
import { nowPlayingActionState } from "./now-playing-capabilities.js";

const resolvedCoverCache = new Map();

export default function NowPlayingCard({ song, busy, expanded, onToggle, onPlayPause, onNext, onDismiss }) {
  const hintId = useId();
  const readOnly = song.readOnly === true;
  const playbackAction = song.isPlaying ? "pause" : "play";
  const playback = nowPlayingActionState(song, playbackAction);
  const next = nowPlayingActionState(song, "next");
  const hint = readOnly
    ? "一起听中，回听歌页查看播放进度"
    : playback.reason && next.reason && playback.reason !== next.reason
    ? `当前播放器未提供${song.isPlaying ? "暂停" : "播放"}、下一首，请在音乐 App 中操作。`
    : playback.reason || next.reason;

  const directCover = normalizeNowPlayingCoverUrl(song.cover || song.cover_url || "");
  const lookupKey = `${String(song.songId || song.song_id || "").trim()}|${String(song.title || "").trim()}|${String(song.artist || "").trim()}`;
  const [fetchedEntry, setFetchedEntry] = useState({ key: "", meta: null });
  const [failedCoverUrl, setFailedCoverUrl] = useState("");

  useEffect(() => {
    const cached = resolvedCoverCache.get(lookupKey) || null;
    if (directCover || cached !== null) return undefined;
    const title = String(song.title || "").trim();
    const songId = String(song.songId || song.song_id || "").trim();
    if (!title && !songId) return undefined;
    if (typeof window === "undefined" || typeof window.location?.origin !== "string" || typeof globalThis.fetch !== "function") {
      return undefined;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let cancelled = false;
    const params = new URLSearchParams();
    if (title) params.set("title", title);
    if (song.artist) params.set("artist", String(song.artist).trim());
    if (songId) params.set("song_id", songId);

    void apiRequest(`/api/v2/music/providers/netease/cover?${params.toString()}`, {
      timeoutMs: 6000,
      ...(controller ? { signal: controller.signal } : {}),
    })
      .then((res) => {
        const cover = normalizeNowPlayingCoverUrl(res?.cover_url || "");
        const meta = {
          cover,
          album: String(res?.album || "").trim(),
          artist: String(res?.artist || "").trim(),
        };
        resolvedCoverCache.set(lookupKey, meta);
        if (!cancelled) setFetchedEntry({ key: lookupKey, meta });
      })
      .catch(() => {
        if (!cancelled) {
          resolvedCoverCache.set(lookupKey, { cover: "", album: "", artist: "" });
        }
      });

    return () => {
      cancelled = true;
      controller?.abort?.();
    };
  }, [directCover, lookupKey, song.artist, song.songId, song.song_id, song.title]);

  const fetchedMeta = resolvedCoverCache.get(lookupKey) || (fetchedEntry.key === lookupKey ? fetchedEntry.meta : null);
  const candidateCover = directCover || fetchedMeta?.cover || "";
  const effectiveCover = candidateCover && failedCoverUrl !== candidateCover ? candidateCover : "";
  const artistText = String(song.artist || fetchedMeta?.artist || "").trim();
  const albumText = String(song.album || fetchedMeta?.album || "").trim();
  const subtitleText = busy
    ? "正在发送指令…"
    : hint ||
      (song.playbackStateKnown === false
        ? "播放状态待确认"
        : artistText && albumText && albumText !== song.title
          ? `${artistText} · ${albumText}`
          : artistText || albumText || "网易云 / 系统播放器");

  // The glass capsule itself remains a status-panel hit target. Controls are
  // real buttons and stop here, so playing a song no longer turns the whole
  // rainbow capsule into a dead layer.
  const openStatusFromCapsule = (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    onToggle?.();
  };
  return (
    <div
      className="sun-glass-liquid-capsule-toggle has-now-playing"
      role="group"
      aria-label={`当前歌曲：${song.title}`}
      aria-busy={busy}
      data-now-playing
      data-dynamic-island="playing"
      onClick={openStatusFromCapsule}
    >
      <span className="sun-glass-now-playing">
        <span
          className={`sun-glass-now-playing-cover${song.isPlaying ? " is-spinning" : ""}${effectiveCover ? " has-art" : ""}`}
          aria-hidden="true"
        >
          {effectiveCover ? (
            <img
              className="sun-glass-now-playing-art"
              src={effectiveCover}
              alt=""
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => setFailedCoverUrl(candidateCover)}
            />
          ) : (
            <span className="sun-glass-now-playing-fallback-icon">
              <Disc3 size={20} aria-hidden="true" />
            </span>
          )}
          <span className="sun-glass-now-playing-disc" />
          <span className="sun-glass-now-playing-hole" />
        </span>
        <span className="sun-glass-now-playing-meta">
          <span className="sun-glass-now-playing-title-row">
            <button
              className="sun-glass-now-playing-title"
              type="button"
              aria-label={expanded ? "收起动态状态" : "展开动态状态"}
              aria-expanded={expanded}
              title={song.title}
              data-dt-tip="点击展开灵动岛中控与伴侣动态状态"
              onClick={onToggle}
            >
              <strong>{song.title}</strong>
            </button>
            <span
              className={`di-audio-spectrum${song.isPlaying ? " is-playing" : ""}`}
              aria-hidden="true"
            >
              <i /><i /><i /><i /><i />
            </span>
          </span>
          <small id={hintId} title={subtitleText}>{subtitleText}</small>
        </span>
        {!readOnly && (
          <span className="sun-glass-now-playing-controls">
            <button type="button" disabled={busy || !playback.available} title={playback.reason || undefined} data-dt-tip={song.isPlaying ? "暂停播放" : "继续播放"} aria-describedby={playback.reason ? hintId : undefined} aria-label={song.isPlaying ? "暂停" : "播放"} onClick={onPlayPause}>{song.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
            <button type="button" disabled={busy || !next.available} title={next.reason || undefined} data-dt-tip="切换到下一首歌曲" aria-describedby={next.reason ? hintId : undefined} aria-label="下一首" onClick={onNext}><SkipForward aria-hidden="true" /></button>
            <button type="button" className="is-dismiss" data-dt-tip="收起当前播放胶囊" aria-label="收起歌曲胶囊" onClick={onDismiss}><X aria-hidden="true" /></button>
          </span>
        )}
      </span>
    </div>
  );
}
