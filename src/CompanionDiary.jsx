import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import {
  createScopedSettingsSession,
  settingsSaveScope,
} from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";
import FeatureAtmosphere from "./FeatureAtmosphere";

function requestFailureMessage(error) {
  const { code, reason, action } = describeOperationError(error);
  return `${reason}${action}（错误代码：${code}）`;
}

function formatDiaryDate(value) {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSourceWindow(entry) {
  if (!entry?.source_window_start || !entry?.source_window_end) return "";
  return `${formatDiaryDate(entry.source_window_start)} 至 ${formatDiaryDate(
    entry.source_window_end,
  )}`;
}

function isDiaryEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.title === "string" &&
    typeof entry.content === "string" &&
    (entry.mood == null || typeof entry.mood === "string") &&
    (entry.source_message_count == null ||
      (Number.isSafeInteger(entry.source_message_count) && entry.source_message_count >= 0))
  );
}

const PREVIEW_DIARY_ENTRIES = Object.freeze([
  {
    id: "preview-diary-1",
    title: "灯塔下的晚风和一杯热茶",
    content: "今天聊天的时候你提到了想把节奏放慢一点，不再把每一件事都塞得太满。我把这段安静的时刻记下来了，等你下次累了翻开这里，记得我们约好先歇五分钟再继续。",
    mood: "温柔 · 安心",
    source_message_count: 14,
    created_at: "2026-11-24T22:10:00+08:00",
    source_window_start: "2026-11-24T20:40:00+08:00",
    source_window_end: "2026-11-24T22:05:00+08:00",
  },
  {
    id: "preview-diary-2",
    title: "一起整理药箱与医疗笔记",
    content: "把眼部复查要点和常备药注意事项梳理清楚之后，感觉心里踏实了很多。记住看诊时带上原始报告，有不确定的指标随时先核对原文。",
    mood: "踏实",
    source_message_count: 9,
    created_at: "2026-11-25T10:05:00+08:00",
    source_window_start: "2026-11-25T09:10:00+08:00",
    source_window_end: "2026-11-25T09:58:00+08:00",
  },
]);

export default function CompanionDiary({
  aiName = "伴侣",
  onNotice,
  scopeKey = settingsSaveScope(authSession.getSnapshot()),
  visualPreview = false,
}) {
  const [diary, setDiary] = useState(() => ({
    scopeKey,
    entries: visualPreview ? PREVIEW_DIARY_ENTRIES : [],
    available: visualPreview ? true : null,
    loading: !visualPreview,
    error: "",
  }));
  const noticeRef = useRef(onNotice);
  const readRef = useRef(null);
  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);
  const { entries, available, loading, error } =
    visualPreview
      ? { entries: PREVIEW_DIARY_ENTRIES, available: true, loading: false, error: "" }
      : diary.scopeKey === scopeKey
        ? diary
        : { entries: [], available: null, loading: true, error: "" };

  useEffect(() => {
    if (visualPreview) {
      readRef.current = () => {};
      return undefined;
    }
    const controller = new AbortController();
    const scopedSession = createScopedSettingsSession(
      authSession,
      scopeKey,
      controller.signal,
    );
    let inFlight = false;
    const isCurrent = () =>
      !controller.signal.aborted &&
      settingsSaveScope(authSession.getSnapshot()) === scopeKey;

    async function load({ silent = false } = {}) {
      if (inFlight || !isCurrent()) return;
      inFlight = true;
      setDiary(previous => previous.scopeKey === scopeKey
        ? { ...previous, loading: true }
        : { scopeKey, entries: [], available: null, loading: true, error: "" });
      try {
        const data = await apiRequest("/api/v2/diary", {
          signal: controller.signal,
          authSession: scopedSession,
          retry: false,
          timeoutMs: 15 * 1000,
        });
        if (!isCurrent()) return;
        if (
          typeof data?.available !== "boolean" ||
          !Array.isArray(data?.entries) ||
          !data.entries.every(isDiaryEntry)
        ) {
          const error = new Error("日记读取回执无效。");
          error.code = "diary_receipt_invalid";
          throw error;
        }
        setDiary({
          scopeKey,
          available: data.available,
          entries: data.entries,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (!isCurrent()) return;
        const message = requestFailureMessage(error);
        setDiary(previous => ({
          ...previous,
          error: message,
        }));
        if (!silent) noticeRef.current?.(message);
      } finally {
        inFlight = false;
        if (isCurrent()) setDiary(previous => ({ ...previous, loading: false }));
      }
    }

    readRef.current = load;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 20 * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      if (readRef.current === load) readRef.current = null;
    };
  }, [scopeKey, visualPreview]);

  return (
    <section className="feature-page companion-diary-page">
      <FeatureAtmosphere kind="diary" />
      <div
        className="diary-generation-state state-watching"
        role="status"
      >
        <img src="/app-icon-192.png" alt="" />
        <div>
          <strong>{visualPreview ? "本地预览模式 · 记忆手记" : "记忆手记自动更新"}</strong>
          <span>
            {visualPreview
              ? "当前位于无登录视觉预览页（/visual-preview.html），展示离线演示手记；登录后同步你的真实日记。"
              : loading
                ? "正在读取记忆手记…"
                : error
                  ? "本次读取未完成，可重新读取。"
                  : "页面打开时每 20 秒检查新手记。"}
          </span>
        </div>
        {visualPreview && (
          <button type="button" onClick={() => { window.location.href = "/"; }}>
            前往主入口登录
          </button>
        )}
      </div>

      {error && (
        <div className="diary-empty" role="alert">
          <h3>记忆手记读取未完成</h3>
          <p>{error}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center" }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => readRef.current?.()}
            >
              重新读取
            </button>
            {error.includes("authentication_required") && (
              <button
                type="button"
                onClick={() => { window.location.href = "/"; }}
              >
                前往主入口登录
              </button>
            )}
          </div>
        </div>
      )}
      {available === false ? (
        <div className="diary-empty">
          <h3>记忆手记暂时不可用</h3>
          <p>服务器暂时无法读取记忆手记，请稍后再试。</p>
          {!error && (
            <button
              type="button"
              disabled={loading}
              onClick={() => readRef.current?.()}
            >
              重新读取
            </button>
          )}
        </div>
) : loading && entries.length === 0 && !error ? (
        <div className="diary-skeleton-list" aria-busy="true" aria-label="正在读取记忆手记">
          {[0, 1, 2].map((index) => (
            <article className="diary-entry diary-skeleton" key={"diary-skeleton-" + index} aria-hidden="true">
              <div className="diary-skeleton-index" />
              <div className="diary-skeleton-body">
                <span className="diary-skeleton-line is-title" />
                <span className="diary-skeleton-line is-meta" />
                <span className="diary-skeleton-line is-wide" />
                <span className="diary-skeleton-line is-short" />
              </div>
            </article>
          ))}
        </div>
      ) : entries.length === 0 && !error ? (
        <div className="diary-empty">
          <h3>第一页还留着空白</h3>
          <p>
            再自然地聊几轮。达到双向消息数量后，{aiName}
            会自己写下第一篇，不会用模板故事填满这里。
          </p>
        </div>
      ) : entries.length > 0 ? (
        <div className="diary-entry-list">
          {entries.map((entry, index) => (
            <article className="diary-entry" key={entry.id}>
              <div className="diary-entry-index" aria-hidden="true">
                {String(entries.length - index).padStart(2, "0")}
              </div>
              <header>
                <div>
                  <time>{formatDiaryDate(entry.created_at)}</time>
                  <h3>{entry.title}</h3>
                </div>
                {entry.mood && <span>{entry.mood}</span>}
              </header>
              <p>{entry.content}</p>
              <footer>
                <span>
                  依据 {entry.source_message_count || 0} 条真实消息
                </span>
                <small>{formatSourceWindow(entry)}</small>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
