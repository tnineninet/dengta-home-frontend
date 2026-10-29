import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Maximize2, Music2, RefreshCw, TriangleAlert } from "lucide-react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";
import "./music-studio.css";

export default function MusicStudio({ onOpenSync }) {
  const [state, setState] = useState({ loading: true, url: "", error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiRequest("/api/v2/music/embed-url");
        if (cancelled) return;
        if (!data?.url) throw new Error("音乐工作室没有返回访问地址。");
        setState({ loading: false, url: data.url, error: "" });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          url: "",
          error: settingsServiceErrorMessage(error) || error?.message || "暂时打不开音乐工作室。",
        });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reloadKey]);

  const reload = () => {
    setState({ loading: true, url: "", error: "" });
    setReloadKey((current) => current + 1);
  };

  const openExternal = () => {
    if (state.url) window.open(state.url, "_blank", "noopener,noreferrer");
  };

  const enterFullscreen = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    const request = frame.requestFullscreen?.bind(frame);
    if (request) request().catch(() => {});
  };

  return (
    <section className="music-studio-page" aria-labelledby="music-studio-title">
      <header className="music-studio-header">
        <div className="music-studio-heading">
          <span className="music-studio-icon" aria-hidden="true"><Music2 /></span>
          <div>
            <span className="music-studio-kicker">MUSIC STUDIO</span>
            <h2 id="music-studio-title">音乐工作室</h2>
            <p>完整歌单、每日推荐、搜索、播放与一起听</p>
          </div>
        </div>
        <div className="music-studio-actions">
          {onOpenSync ? (
            <button type="button" className="music-studio-sync" onClick={onOpenSync}>
              一起听同步
            </button>
          ) : null}
          <button type="button" aria-label="刷新音乐工作室" onClick={reload}>
            <RefreshCw aria-hidden="true" />
            <span>刷新</span>
          </button>
          <button type="button" aria-label="全屏音乐工作室" onClick={enterFullscreen}>
            <Maximize2 aria-hidden="true" />
            <span>全屏</span>
          </button>
          <button type="button" aria-label="在浏览器打开音乐工作室" onClick={openExternal} disabled={!state.url}>
            <ExternalLink aria-hidden="true" />
            <span>浏览器打开</span>
          </button>
        </div>
      </header>

      <div className="music-studio-frame-shell">
        {state.loading ? (
          <div className="music-studio-state" role="status">
            <Loader2 className="is-spinning" aria-hidden="true" />
            <strong>正在打开音乐工作室</strong>
            <small>正在连接你的歌单和播放器…</small>
          </div>
        ) : null}

        {!state.loading && state.error ? (
          <div className="music-studio-state is-error" role="alert">
            <TriangleAlert aria-hidden="true" />
            <strong>音乐工作室暂时打不开</strong>
            <small>{state.error}</small>
            <div>
              <button type="button" onClick={reload}>重新连接</button>
              <button type="button" onClick={() => { window.location.href = "/?view=chat"; }}>先回聊天</button>
            </div>
          </div>
        ) : null}

        {!state.loading && state.url ? (
          <iframe
            ref={iframeRef}
            className="music-studio-frame"
            src={state.url}
            title="DengTa 音乐工作室"
            allow="autoplay; clipboard-write; fullscreen; microphone; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => {}}
          />
        ) : null}
      </div>

      <p className="music-studio-note">
        音乐工作室是独立的完整播放器页面；如果二维码过期，在播放器里点「换一张」即可。
      </p>
    </section>
  );
}
