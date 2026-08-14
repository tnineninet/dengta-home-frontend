import { useMemo, useRef, useState } from "react";
import {
  CircleStop,
  Clock3,
  Link2,
  MessageCircleMore,
  Music2,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { formatMediaTime } from "./co-watch";
import { detectPlannedCastProviders } from "./receiver-playback.js";
import {
  clearDirectMediaSession,
  DIRECT_MEDIA_SOURCE_APP,
  readDirectMediaSession,
  storeDirectMediaSession,
  validateDirectMediaUrl,
} from "./direct-media.js";
import "./together.css";
import TogetherMusic from "./TogetherMusic.jsx";

function formatMoment(value, fallback = "等待画面") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function finiteMediaSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export default function Together({
  aiName = "伴侣",
  accountScope = "",
  session,
  receipt,
  screenState,
  preview,
  feedback,
  busy = false,
  onStart,
  onStartDirect,
  onPause,
  onStop,
  onStopDirect,
  onStartMusic,
  onStopMusic,
  onMusicPlaybackChange,
  onPlaybackChange,
  onRefresh,
  castPairing,
  castReceiver,
  onGenerateCastPairing,
  dialog = [],
  onReply,
  initialMode = "external",
}) {
  const [restoredDirectMedia] = useState(() =>
    readDirectMediaSession(globalThis.sessionStorage, accountScope),
  );
  const [mode, setMode] = useState(() =>
    session?.sessionMode === "listening"
      ? "music"
      : session?.sourceApp === DIRECT_MEDIA_SOURCE_APP || restoredDirectMedia?.url
      ? "direct"
      : initialMode === "music" ? "music" : "external",
  );
  const [title, setTitle] = useState(
    session?.title || restoredDirectMedia?.title || "",
  );
  const [durationMinutes, setDurationMinutes] = useState(
    session?.mediaDurationSeconds
      ? String(Math.round(session.mediaDurationSeconds / 60))
      : "",
  );
  const [positionMinutes, setPositionMinutes] = useState(
    session?.mediaPositionSeconds
      ? String(Math.round(session.mediaPositionSeconds / 60))
      : "",
  );
  const [cadenceMinutes, setCadenceMinutes] = useState("1.5");
  const [reply, setReply] = useState("");
  const [musicPositionSeconds, setMusicPositionSeconds] = useState(0);
  const [directUrlInput, setDirectUrlInput] = useState(
    restoredDirectMedia?.url || "",
  );
  const [directMediaUrl, setDirectMediaUrl] = useState(
    restoredDirectMedia?.url || "",
  );
  const [directPositionSeconds, setDirectPositionSeconds] = useState(
    restoredDirectMedia?.positionSeconds || 0,
  );
  const [directDurationSeconds, setDirectDurationSeconds] = useState(
    restoredDirectMedia?.durationSeconds || 0,
  );
  const [directPlaying, setDirectPlaying] = useState(false);
  const [directFeedback, setDirectFeedback] = useState({
    status: "idle",
    message: "视频链接只用于本场直链播放与已配对的浏览器接收端，不会在投屏界面公开显示。",
  });
  const videoRef = useRef(null);
  const resumedUrlRef = useRef("");
  const restoredResumeRef = useRef(
    restoredDirectMedia?.url
      ? {
          url: restoredDirectMedia.url,
          positionSeconds: restoredDirectMedia.positionSeconds || 0,
        }
      : null,
  );
  const lastPlaybackSecondRef = useRef(-1);
  const lastPlaybackPatchRef = useRef(0);
  const castProviders = useMemo(() => detectPlannedCastProviders(globalThis), []);

  const active =
    screenState.active &&
    screenState.watchTogetherEnabled &&
    session?.status === "active";
  const directActive =
    session?.status === "active" &&
    session?.sourceApp === DIRECT_MEDIA_SOURCE_APP;
  const musicActive = session?.status === "active" && session?.sessionMode === "listening";
  const selectedMode = musicActive ? "music" : directActive ? "direct" : active ? "external" : mode;
  const selectedActive = selectedMode === "music" ? musicActive : selectedMode === "direct" ? directActive : active;
  const modeLocked = active || directActive || musicActive;

  const fallbackDialog = useMemo(() => {
    const text = String(screenState.lastReaction || "").trim();
    if (!text) return [];
    const key = `${screenState.lastReactionAt}:${text}`;
    return [{ key, text, at: screenState.lastReactionAt }];
  }, [screenState.lastReaction, screenState.lastReactionAt]);
  const visibleDialog = dialog.length ? dialog : fallbackDialog;

  const progress = useMemo(() => {
    const duration = Number(session?.mediaDurationSeconds || 0);
    const position = Number(session?.mediaPositionSeconds || 0);
    return duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  }, [session]);

  const persistDirectPlayback = (positionSeconds, durationSeconds) => {
    if (!directMediaUrl) return;
    storeDirectMediaSession(globalThis.sessionStorage, accountScope, {
      url: directMediaUrl,
      title,
      positionSeconds,
      durationSeconds,
    });
  };

  const reportDirectPlayback = (video, immediate = false) => {
    if (!video || !directMediaUrl) return;
    const positionSeconds = finiteMediaSeconds(video.currentTime);
    const durationSeconds = finiteMediaSeconds(video.duration);
    setDirectPositionSeconds(positionSeconds);
    setDirectDurationSeconds(durationSeconds);
    const roundedSecond = Math.floor(positionSeconds);
    if (roundedSecond !== lastPlaybackSecondRef.current) {
      lastPlaybackSecondRef.current = roundedSecond;
      persistDirectPlayback(positionSeconds, durationSeconds);
    }
    if (session?.id && (immediate || Date.now() - lastPlaybackPatchRef.current >= 5_000)) {
      lastPlaybackPatchRef.current = Date.now();
      onPlaybackChange?.({
        sessionId: session?.id || "",
        playbackState: video.paused ? "paused" : "playing",
        mediaPositionSeconds: positionSeconds,
        mediaDurationSeconds: durationSeconds,
      });
    }
  };

  const loadDirectMedia = () => {
    const validation = validateDirectMediaUrl(directUrlInput);
    if (!validation.ok) {
      setDirectFeedback({ status: "error", message: validation.message });
      return "";
    }
    const changed = validation.url !== directMediaUrl;
    if (changed) {
      setDirectPositionSeconds(0);
      setDirectDurationSeconds(0);
      resumedUrlRef.current = "";
      restoredResumeRef.current = null;
      lastPlaybackSecondRef.current = -1;
    }
    setDirectMediaUrl(validation.url);
    storeDirectMediaSession(globalThis.sessionStorage, accountScope, {
      url: validation.url,
      title,
      positionSeconds: changed ? 0 : directPositionSeconds,
      durationSeconds: changed ? 0 : directDurationSeconds,
    });
    setDirectFeedback({
      status: "success",
      message: "视频直链已载入。若播放器仍失败，通常是地址已过期、需要登录或来源网站禁止外部播放。",
    });
    return validation.url;
  };

  const startExternal = () =>
    onStart?.({
      title,
      mediaDurationSeconds: Math.round(Number(durationMinutes || 0) * 60),
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
      cadenceSeconds: Math.min(
        10_800,
        Math.max(60, Math.round(Number(cadenceMinutes || 1.5) * 60)),
      ),
    });

  const startDirect = async () => {
    const validation = validateDirectMediaUrl(directUrlInput);
    if (!validation.ok) {
      setDirectFeedback({ status: "error", message: validation.message });
      return;
    }
    if (validation.url !== directMediaUrl) {
      setDirectFeedback({
        status: "error",
        message: "链接已经改变，请先重新载入播放器，再开始一起看。",
      });
      return;
    }
    const video = videoRef.current;
    const positionSeconds = finiteMediaSeconds(video?.currentTime);
    const durationSeconds = finiteMediaSeconds(video?.duration);
    persistDirectPlayback(positionSeconds, durationSeconds);
    setDirectFeedback({ status: "checking", message: "正在建立直链共看会话…" });
    try {
      const result = await onStartDirect?.({
        title,
        sessionMode: "direct_media",
        mediaUrl: validation.url,
        mediaDurationSeconds: durationSeconds,
        mediaPositionSeconds: positionSeconds,
      });
      if (!result) return;
      setDirectFeedback({
        status: result.ok === false ? "error" : "success",
        message: result.message || "直链共看已经开始。",
      });
    } catch (error) {
      setDirectFeedback({
        status: "error",
        message: error?.message || "暂时无法开始视频直链共看。",
      });
    }
  };

  const stopExternal = () =>
    onStop?.({
      title,
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
    });

  const stopDirect = async () => {
    const video = videoRef.current;
    const positionSeconds = finiteMediaSeconds(video?.currentTime);
    video?.pause();
    setDirectFeedback({ status: "checking", message: "正在结束这场共看…" });
    try {
      const result = await onStopDirect?.({
        title,
        mediaPositionSeconds: positionSeconds,
      });
      if (!result) return;
      setDirectFeedback({
        status: result.ok === false ? "error" : "idle",
        message: result.message || "这场视频直链共看已经结束。",
      });
      if (result.ok !== false) {
        clearDirectMediaSession(globalThis.sessionStorage, accountScope);
        setDirectMediaUrl("");
        setDirectUrlInput("");
        setDirectPositionSeconds(0);
        setDirectDurationSeconds(0);
      }
    } catch (error) {
      setDirectFeedback({
        status: "error",
        message: error?.message || "暂时无法结束视频直链共看，可以稍后重试。",
      });
    }
  };

  const submitReply = (event) => {
    event.preventDefault();
    const text = reply.trim();
    if (!text || busy || !session?.id) return;
    Promise.resolve(
      onReply?.(
        text,
        selectedMode === "music" ? musicPositionSeconds : selectedMode === "direct" ? directPositionSeconds : undefined,
      ),
    ).then((sent) => {
      if (sent !== false) setReply("");
    });
  };

  const stageTitle = session?.title || title || "还没有填写片名";
  const currentFeedback =
    selectedMode === "direct" ? directFeedback : feedback;

  return (
    <section className="feature-page together-page" aria-label="一起看">
      <header className="together-heading">
        <div>
          <small>TOGETHER</small>
          <h2>和 {aiName} 一起看</h2>
          <p>
            {selectedMode === "music"
              ? "在前台用浏览器音频播放器，和伴侣同步听同一份歌单。"
              : selectedMode === "direct"
              ? "在 DengTa 内播放 HTTPS 视频直链；AI 不会抓取或自动观看视频。"
              : "切到任意视频 App，DengTa 会在画面有变化时陪你聊。"}
          </p>
        </div>
        <span className={`together-live${selectedActive ? " is-live" : ""}`}>
          <i aria-hidden="true" />
          {selectedActive
            ? selectedMode === "direct"
              ? directPlaying
                ? "播放共看中"
                : "播放器已暂停"
              : screenState.paused
                ? "已暂停"
                : "共看中"
            : "未开始"}
        </span>
      </header>

      {selectedMode !== "music" && <div className="together-mode-switch" role="tablist" aria-label="一起看方式">
        <button
          type="button"
          role="tab"
          aria-selected={selectedMode === "external"}
          className={selectedMode === "external" ? "is-selected" : ""}
          disabled={modeLocked && selectedMode !== "external"}
          onClick={() => setMode("external")}
        >
          <MonitorPlay aria-hidden="true" />
          外部 App 屏幕共看
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedMode === "direct"}
          className={selectedMode === "direct" ? "is-selected" : ""}
          disabled={modeLocked && selectedMode !== "direct"}
          onClick={() => setMode("direct")}
        >
          <Link2 aria-hidden="true" />
          DengTa 视频直链
        </button>
      </div>}

      <div className="together-layout">
        <div className="together-stage">
          {selectedMode === "music" ? (
            <div className="together-stage-empty together-music-stage"><Music2 aria-hidden="true" /><strong>一起听歌</strong><span>播放器保持在前台运行，歌单与进度会同步到本场会话。</span></div>
          ) : selectedMode === "direct" ? (
            directMediaUrl ? (
              <video
                ref={videoRef}
                src={directMediaUrl}
                controls
                playsInline
                preload="metadata"
                referrerPolicy="no-referrer"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (resumedUrlRef.current !== directMediaUrl) {
                    const restoredResume = restoredResumeRef.current;
                    const resumeAt = Math.min(
                      restoredResume?.url === directMediaUrl
                        ? restoredResume.positionSeconds
                        : 0,
                      finiteMediaSeconds(video.duration),
                    );
                    if (resumeAt > 0) video.currentTime = resumeAt;
                    restoredResumeRef.current = null;
                    resumedUrlRef.current = directMediaUrl;
                  }
                  reportDirectPlayback(video);
                  setDirectFeedback({
                    status: "success",
                    message: "播放器准备好了。点击播放后，可开始这场直链共看。",
                  });
                }}
                onDurationChange={(event) => reportDirectPlayback(event.currentTarget)}
                onTimeUpdate={(event) => reportDirectPlayback(event.currentTarget)}
                onPlay={(event) => { setDirectPlaying(true); reportDirectPlayback(event.currentTarget, true); }}
                onPause={(event) => { setDirectPlaying(false); reportDirectPlayback(event.currentTarget, true); }}
                onSeeked={(event) => reportDirectPlayback(event.currentTarget, true)}
                onEnded={() => setDirectPlaying(false)}
                onError={() => {
                  setDirectPlaying(false);
                  setDirectFeedback({
                    status: "error",
                    message:
                      "视频无法播放。请检查它是否为可直接访问的 HTTPS 媒体文件，以及链接是否过期或受登录、防盗链限制。",
                  });
                }}
              >
                当前浏览器不支持 HTML5 视频播放。
              </video>
            ) : (
              <div className="together-stage-empty">
                <Link2 aria-hidden="true" />
                <strong>等待 HTTPS 视频直链</strong>
                <span>先在右侧粘贴并载入媒体直链，视频将在这里播放。</span>
              </div>
            )
          ) : preview?.src ? (
            <img src={preview.src} alt="上次用于共看回应的屏幕画面" />
          ) : (
            <div className="together-stage-empty">
              <MonitorPlay aria-hidden="true" />
              <strong>等待外部 App 画面</strong>
              <span>回到 DengTa 后，这里只保留最近一次临时预览。</span>
            </div>
          )}
          <div className="together-stage-caption">
            <span>{stageTitle}</span>
            <time>
              {selectedMode === "music"
                ? `${formatMediaTime(musicPositionSeconds)} · 前台播放器`
                : selectedMode === "direct"
                ? `${formatMediaTime(directPositionSeconds)} / ${
                    directDurationSeconds
                      ? formatMediaTime(directDurationSeconds)
                      : "等待媒体信息"
                  }`
                : formatMoment(preview?.capturedAt)}
            </time>
          </div>
        </div>

        <div className="together-controls">
          {selectedMode === "music" ? (
            <TogetherMusic
              session={musicActive ? session : null}
              busy={busy}
              onStart={onStartMusic}
              onEnd={onStopMusic}
              onPlaybackChange={onMusicPlaybackChange}
              onPositionChange={setMusicPositionSeconds}
            />
          ) : selectedMode === "direct" ? (
            <div className="together-setup together-direct-setup">
              {!directActive && (
                <>
                  <label>
                    <span>正在看什么（可选）</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={180}
                      placeholder="电影、剧集或视频标题"
                    />
                  </label>
                  <label>
                    <span>HTTPS 视频直链</span>
                    <input
                      type="url"
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={directUrlInput}
                      onChange={(event) => setDirectUrlInput(event.target.value)}
                      placeholder="https://example.com/video.mp4"
                      aria-describedby="direct-media-guidance"
                    />
                  </label>
                  <div className="together-direct-actions">
                    <button type="button" disabled={busy} onClick={loadDirectMedia}>
                      <Link2 aria-hidden="true" />
                      载入播放器
                    </button>
                    <button
                      type="button"
                      className="together-primary"
                      disabled={busy || !directMediaUrl}
                      onClick={startDirect}
                    >
                      <Play aria-hidden="true" />
                      {busy ? "正在准备…" : "开始直链共看"}
                    </button>
                  </div>
                </>
              )}
              {directActive && (
                <div className="together-now">
                  <div>
                    <Clock3 aria-hidden="true" />
                    <span>播放器进度</span>
                    <strong>{formatMediaTime(directPositionSeconds)}</strong>
                  </div>
                  <div>
                    <Play aria-hidden="true" />
                    <span>本机状态</span>
                    <strong>{directPlaying ? "正在播放" : "已暂停"}</strong>
                  </div>
                </div>
              )}
              {directActive && (
                <div className="together-session-actions">
                  <button type="button" disabled={busy} onClick={stopDirect}>
                    <CircleStop aria-hidden="true" />
                    结束本场
                  </button>
                </div>
              )}
              <p id="direct-media-guidance" className="together-device-note">
                只支持播放器可直接读取的 HTTPS 媒体地址。普通爱奇艺、哔哩哔哩网页链接不是视频直链，受平台授权与防盗链限制，不能在这里提取播放。
              </p>
              <p className="together-device-note">
                直链模式只负责本机播放，不上传视频画面。AI 只能根据你填写的标题、播放进度和你主动发送的文字陪聊；如需让 AI 观察画面，请使用 Android 的“外部 App 屏幕共看”。
              </p>
              {directActive && <section className="together-cast" aria-label="电视接收">
                <header><strong>在电视上接收</strong><span>{castReceiver?.status === "online" ? "接收端在线" : castReceiver?.status || "等待接收端"}</span></header>
                <p>在电视浏览器打开 <strong>{globalThis.location?.origin || ""}/receive</strong>，再输入短期配对码。这里不会显示媒体 URL 或接收端凭据。</p>
                {castPairing?.pairingCode ? <div className="together-pairing-code"><b>{castPairing.pairingCode}</b><small>会话编号：{castPairing.sessionId}</small><small>有效期至 {castPairing.expiresAt ? new Date(castPairing.expiresAt).toLocaleTimeString("zh-CN") : "短期有效"}</small></div> : <button type="button" disabled={busy} onClick={onGenerateCastPairing}>生成配对码</button>}
                {castReceiver?.lastAckAt && <small>最近确认：{formatMoment(castReceiver.lastAckAt)}</small>}
                <div className="cast-provider-list">{castProviders.map((provider) => <span key={provider.id}><b>{provider.label}</b><small>{provider.status === "ready" ? "可用" : `计划中${provider.detected ? " · 检测到浏览器能力" : ""}`}</small></span>)}</div>
              </section>}
            </div>
          ) : !active ? (
            <div className="together-setup">
              <label>
                <span>正在看什么（可选）</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={180}
                  placeholder="电影、剧集或视频标题"
                />
              </label>
              <div className="together-time-inputs">
                <label>
                  <span>总时长 / 分钟</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </label>
                <label>
                  <span>当前位置 / 分钟</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={positionMinutes}
                    onChange={(event) => setPositionMinutes(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>查看间隔 · 1–180 分钟</span>
                <input
                  type="number"
                  min="1"
                  max="180"
                  step="0.5"
                  inputMode="decimal"
                  value={cadenceMinutes}
                  onChange={(event) => setCadenceMinutes(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="together-primary"
                disabled={busy || !screenState.supported}
                onClick={startExternal}
              >
                <Play aria-hidden="true" />
                {busy ? "正在准备…" : "开始一起看"}
              </button>
              {!screenState.supported && (
                <p className="together-device-note">
                  屏幕共看需要 DengTa Android 客户端；网页端仍可查看会话回执。
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="together-now">
                <div>
                  <Clock3 aria-hidden="true" />
                  <span>上次回应</span>
                  <strong>
                    {formatMoment(screenState.lastReactionAt, "还在一起看")}
                  </strong>
                </div>
                <div>
                  <RefreshCw aria-hidden="true" />
                  <span>下次观察</span>
                  <strong>
                    {screenState.paused
                      ? "暂停中"
                      : formatMoment(screenState.nextWatchCaptureAt, "约 90 秒")}
                  </strong>
                </div>
              </div>
              <div className="together-session-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPause?.(!screenState.paused)}
                >
                  {screenState.paused ? <Play /> : <Pause />}
                  {screenState.paused ? "继续共看" : "暂停观察"}
                </button>
                <button type="button" disabled={busy} onClick={stopExternal}>
                  <CircleStop />
                  结束本场
                </button>
              </div>
            </>
          )}

          <p
            className={`together-feedback is-${currentFeedback?.status || "idle"}`}
            role="status"
          >
            {currentFeedback?.message || "等待开始。"}
          </p>
          {selectedMode === "external" && (
            <p className="together-cadence">
              默认每 90 秒检查一次，也可在开始前设为 1–180 分钟；每次检查只在画面有明显变化时回应。默认节奏最长 8 分钟会再次检查，自定义超过 8 分钟时按设定间隔。模型生成时间另计。
            </p>
          )}
        </div>
      </div>

      {session && (
        <section className="together-progress" aria-label="共看进度">
          <div>
            <strong>{session.title || "这一场共看"}</strong>
            <span>
              {formatMediaTime(session.mediaPositionSeconds)} / {session.mediaDurationSeconds
                ? formatMediaTime(session.mediaDurationSeconds)
                : "未填写"}
            </span>
          </div>
          <i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i>
          <small>{session.frameCount} 次观察 · {session.reactionCount} 次回应</small>
        </section>
      )}

      <section className="together-dialog" aria-label="本场回应">
        <header>
          <MessageCircleMore aria-hidden="true" />
          <div><strong>本场回应</strong><span>{selectedMode === "music" ? `和${aiName}围绕当前歌曲聊聊` : `${aiName} 看到有意思的地方会主动说话`}</span></div>
          <button type="button" onClick={onRefresh} disabled={busy} aria-label="刷新本场状态">
            <RefreshCw aria-hidden="true" />
          </button>
        </header>
        {visibleDialog.length ? visibleDialog.map((item) => (
          <article key={item.key}>
            <span>{item.role === "user" ? "我" : aiName}</span>
            <p>{item.text}</p>
            <time>{formatMoment(item.at, "刚刚")}</time>
          </article>
        )) : (
          <p className="together-dialog-empty">
            {selectedMode === "music"
              ? "开始后可在这里复用本场回复区聊歌曲；曲名和歌词不会在前端过滤。"
              : selectedMode === "direct"
              ? "开始后，可以按标题和当前进度手动聊天；AI 不会自动读取视频画面，视频地址也不会随消息发送。"
              : "开始后，主动回应会出现在这里，也会以声音和振动提醒你。"}
          </p>
        )}
        {session?.status === "active" && (
          <form className="together-reply" onSubmit={submitReply}>
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              maxLength={500}
              placeholder={selectedMode === "music" ? `和${aiName}聊聊当前歌曲` : `和${aiName}聊聊正在看的内容`}
              aria-label="共看消息"
            />
            <button type="submit" disabled={busy || !reply.trim()}>
              发送
            </button>
          </form>
        )}
      </section>

      {receipt?.status === "ended" && (
        <section className="together-receipt" aria-label="本场回执">
          <small>SESSION RECEIPT</small>
          <strong>这一场已经结束</strong>
          <span>{receipt.frameCount} 次观察 · {receipt.reactionCount} 次回应</span>
          <time>{formatMoment(receipt.endedAt, "刚刚结束")}</time>
        </section>
      )}
    </section>
  );
}
