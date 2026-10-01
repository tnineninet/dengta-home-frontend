import { Pause, Play, SkipForward, X } from "lucide-react";

export default function NowPlayingCard({ song, busy, expanded, onToggle, onPlayPause, onNext, onDismiss }) {
  return (
    <div className="sun-glass-liquid-capsule-toggle has-now-playing" role="group" aria-label={`当前歌曲：${song.title}`} aria-busy={busy}>
      <span className="sun-glass-now-playing">
        <span className={`sun-glass-now-playing-cover${song.isPlaying ? " is-spinning" : ""}`} style={song.cover ? { backgroundImage: `url("${song.cover}")` } : undefined} aria-hidden="true">
          <span className="sun-glass-now-playing-disc" /><span className="sun-glass-now-playing-hole" />
        </span>
        <span className="sun-glass-now-playing-meta">
          <button className="sun-glass-now-playing-title" type="button" aria-label={expanded ? "收起动态状态" : "展开动态状态"} aria-expanded={expanded} onClick={onToggle}><strong>{song.title}</strong></button>
          <small>{busy ? "正在发送指令…" : song.playbackStateKnown === false ? "播放状态待确认" : song.artist || "系统播放器"}</small>
          <span className="sun-glass-now-playing-controls">
            <button type="button" disabled={busy || !song.packageName} aria-label={song.isPlaying ? "暂停" : "播放"} onClick={onPlayPause}>{song.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
            <button type="button" disabled={busy || !song.packageName} aria-label="下一首" onClick={onNext}><SkipForward aria-hidden="true" /></button>
            <button type="button" aria-label="收起歌曲胶囊" onClick={onDismiss}><X aria-hidden="true" /></button>
          </span>
        </span>
      </span>
    </div>
  );
}
