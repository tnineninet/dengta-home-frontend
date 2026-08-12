import { useMemo, useState } from "react";
import {
  CircleStop,
  Clock3,
  MessageCircleMore,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { formatMediaTime } from "./co-watch";
import "./together.css";

function formatMoment(value, fallback = "等待画面") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function Together({
  aiName = "伴侣",
  session,
  receipt,
  screenState,
  preview,
  feedback,
  busy = false,
  onStart,
  onPause,
  onStop,
  onRefresh,
  dialog = [],
  onReply,
}) {
  const [title, setTitle] = useState(session?.title || "");
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
  const active =
    screenState.active &&
    screenState.watchTogetherEnabled &&
    session?.status === "active";
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

  const start = () =>
    onStart?.({
      title,
      mediaDurationSeconds: Math.round(Number(durationMinutes || 0) * 60),
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
      cadenceSeconds: Math.min(
        10_800,
        Math.max(60, Math.round(Number(cadenceMinutes || 1.5) * 60)),
      ),
    });

  const stop = () =>
    onStop?.({
      title,
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
    });

  const submitReply = (event) => {
    event.preventDefault();
    const text = reply.trim();
    if (!text || busy || !session?.id) return;
    Promise.resolve(onReply?.(text)).then((sent) => {
      if (sent !== false) setReply("");
    });
  };

  return (
    <section className="feature-page together-page" aria-label="一起看">
      <header className="together-heading">
        <div>
          <small>TOGETHER</small>
          <h2>和 {aiName} 一起看</h2>
          <p>切到任意视频 App，DengTa 会在画面有变化时陪你聊。</p>
        </div>
        <span className={`together-live${active ? " is-live" : ""}`}>
          <i aria-hidden="true" />
          {active ? (screenState.paused ? "已暂停" : "共看中") : "未开始"}
        </span>
      </header>

      <div className="together-layout">
        <div className="together-stage">
          {preview?.src ? (
            <img src={preview.src} alt="上次用于共看回应的屏幕画面" />
          ) : (
            <div className="together-stage-empty">
              <MonitorPlay aria-hidden="true" />
              <strong>等待外部 App 画面</strong>
              <span>回到 DengTa 后，这里只保留最近一次临时预览。</span>
            </div>
          )}
          <div className="together-stage-caption">
            <span>{session?.title || title || "还没有填写片名"}</span>
            <time>{formatMoment(preview?.capturedAt)}</time>
          </div>
        </div>

        <div className="together-controls">
          {!active ? (
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
                onClick={start}
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
                <button type="button" disabled={busy} onClick={stop}>
                  <CircleStop />
                  结束本场
                </button>
              </div>
            </>
          )}

          <p className={`together-feedback is-${feedback?.status || "idle"}`} role="status">
            {feedback?.message || "等待开始。"}
          </p>
          <p className="together-cadence">
            默认每 90 秒检查一次，也可在开始前设为 1–180 分钟；每次检查只在画面有明显变化时回应。默认节奏最长 8 分钟会再次检查，自定义超过 8 分钟时按设定间隔。模型生成时间另计。
          </p>
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
          <div><strong>本场回应</strong><span>{aiName} 看到有意思的地方会主动说话</span></div>
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
          <p className="together-dialog-empty">开始后，主动回应会出现在这里，也会以声音和振动提醒你。</p>
        )}
        {session?.status === "active" && (
          <form className="together-reply" onSubmit={submitReply}>
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              maxLength={500}
              placeholder={`和${aiName}聊聊正在看的内容`}
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
