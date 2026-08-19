import { useEffect, useRef, useState } from "react";

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * DLNA 投屏专用播放器。
 *
 * 与「屏幕共看」（AI 看你屏幕）完全独立：
 *  - 只播放从视频 App（B站等）通过 DLNA 投过来的媒体直链
 *  - 显示标题 + 进度条 + 播放控制
 */
export default function DlnaCastPlayer({ info, onClose }) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const endedAtRef = useRef(null);

  const mediaUrl = info?.uri || info?.mediaUrl || "";
  const title = info?.title || "投屏播放";

  // 新媒体到来时重置播放器状态
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setFailed(false);
    setEnded(false);
    setWaiting(false);
    endedAtRef.current = null;
  }, [mediaUrl]);

  // 自动播放
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl) return undefined;
    const tryPlay = () => {
      video.play().catch(() => {
        // 自动播放被拦截时静默等待，用户可手动点播放
      });
    };
    // 等待元数据后再播放（部分直链需要加载后才能播放）
    const onLoaded = () => {
      setDuration(video.duration || 0);
      tryPlay();
    };
    video.addEventListener("loadedmetadata", onLoaded);
    const timer = window.setTimeout(tryPlay, 300);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      window.clearTimeout(timer);
    };
  }, [mediaUrl]);

  if (!mediaUrl && !waiting) {
    return (
      <div className="dlna-cast-player dlna-cast-empty">
        <p>没有正在播放的投屏内容。</p>
        {onClose && (
          <button type="button" onClick={onClose}>返回</button>
        )}
      </div>
    );
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="dlna-cast-player">
      <header className="dlna-cast-header">
        <div className="dlna-cast-badge">投屏播放中</div>
        <h2 className="dlna-cast-title">{title}</h2>
        {onClose && (
          <button type="button" className="dlna-cast-close" onClick={onClose}>
            结束投屏
          </button>
        )}
      </header>

      <div className="dlna-cast-stage">
        {waiting ? (
          <div className="dlna-cast-waiting">
            <p>请在 B站 等视频 App 中重新点击投屏。</p>
            <p className="dlna-cast-waiting-hint">投屏后会自动播放。</p>
            {onClose && (
              <button type="button" onClick={onClose}>结束投屏</button>
            )}
          </div>
        ) : failed ? (
          <div className="dlna-cast-failed">
            <p>媒体地址已失效或无法直接播放。</p>
            <p className="dlna-cast-failed-hint">B站 的直链有时效限制，失效后需要重新投屏。</p>
            <div className="dlna-cast-failed-actions">
              <button type="button" onClick={() => setWaiting(true)}>重新投屏</button>
              {onClose && (
                <button type="button" onClick={onClose}>结束投屏</button>
              )}
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              src={mediaUrl}
              controls
              playsInline
              autoPlay
              preload="auto"
              referrerPolicy="no-referrer"
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => {
                setDuration(event.currentTarget.duration || 0);
                setEnded(false);
                endedAtRef.current = null;
              }}
              onError={() => setFailed(true)}
              onEnded={() => {
                setEnded(true);
                endedAtRef.current = Date.now();
              }}
            >
              当前浏览器不支持 HTML5 视频。
            </video>
            {ended && (
              <div className="dlna-cast-ended">
                <p>投屏播放已结束</p>
                {onClose && <button type="button" onClick={onClose}>关闭</button>}
              </div>
            )}
          </>
        )}
      </div>

      <footer className="dlna-cast-footer">
        <div className="dlna-cast-track">
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="dlna-cast-times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </footer>
    </div>
  );
}