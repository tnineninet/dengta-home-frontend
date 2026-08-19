import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeviceActionReceipts from "./DeviceActionReceipts";
import { MessageAttachments, ThinkingPanel } from "./ChatMessageExtras";
import { AuthenticatedImage } from "./PrivateMedia";
import {
  longPressMovementExceeded,
  messageCanBeReferenced,
  messageReferenceFromMessage,
} from "./message-reference";
import { getStickerById } from "./sticker-catalog";
import { formatVoiceConfidence } from "./voice";
import ChatSkinOrnament from "./ChatSkinOrnament";
import { privateMediaAsset, privateMediaContentPath } from "./private-media";
import { fetchErrorLogById } from "./api";

function formatMessageTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ChatMessage({
  item,
  aiName = "伴侣",
  userName = "你",
  companionMood = "",
  skin = "classic-glass",
  skinPresentation = null,
  apiBaseUrl,
  onPreview,
  onReference,
  onDismissError,
  innerMonologue,
  innerMonologuePending = false,
  innerMonologueError = "",
  onRequestInnerMonologue,
  userAvatar = "",
  companionAvatar = "",
  privateMediaCatalog = null,
}) {
  const isUser = item.role === "user";
  const displayName = isUser ? userName : aiName;
  const quotedMessage = messageReferenceFromMessage(item);
  const canReference =
    item.chatError !== true &&
    typeof onReference === "function" &&
    messageCanBeReferenced(item);
  const longPressRef = useRef(null);
  const sticker = !isUser
    ? getStickerById(item.tool_calls?.sticker_id)
    : null;
  const customSticker = !isUser
    ? privateMediaAsset(
        privateMediaCatalog,
        String(item.tool_calls?.custom_sticker_id || ""),
        "custom_sticker",
      )
    : null;
  const avatar = isUser ? userAvatar : companionAvatar;

  // 错误日志详情（聊天页"查看日志"）
  const [logExpanded, setLogExpanded] = useState(false);
  const [logDetail, setLogDetail] = useState(null);
  const [logLoading, setLogLoading] = useState(false);

  const refusalLogId = item.tool_calls?.refusal_detected?.error_log_id || item.error_log_id;
  const toggleErrorLog = useCallback(async () => {
    if (logExpanded) {
      setLogExpanded(false);
      return;
    }
    setLogExpanded(true);
    if (logDetail || !refusalLogId) return;
    setLogLoading(true);
    try {
      const log = await fetchErrorLogById(refusalLogId);
      setLogDetail(log);
    } catch {
      setLogDetail({ fetch_failed: true });
    } finally {
      setLogLoading(false);
    }
  }, [logExpanded, logDetail, refusalLogId]);

  function formatErrorTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }
  const avatarLetter = isUser
    ? Array.from(userName || "我")[0] || "我"
    : Array.from(aiName || "伴")[0] || "伴";
  const artworkId = !isUser
    ? String(item.tool_calls?.artwork_id || "")
    : "";
  const artworkAlt =
    item.tool_calls?.artwork_alt || `${aiName}创作的图片`;
  const isGenerating = item.isStreaming === true || item.generationInProgress === true;
  const [thinkingDetailOpen, setThinkingDetailOpen] = useState(false);

  // 流式进度条：将 thinkingStatuses 映射到 0~100% + 已接收字数
  const streamProgress = useMemo(() => {
    if (!isGenerating) return null;
    const statuses = Array.isArray(item.thinkingStatuses) ? item.thinkingStatuses : [];
    const last = statuses.length > 0 ? statuses[statuses.length - 1] : "";
    const chars = Math.max(0, String(item.content || "").length);
    // 阶段 → 百分比映射
    const PHASE_WEIGHT = {
      "正在准备并发送这条消息": 3,
      "服务器已接收本轮消息": 8,
      "服务器已识别并复用先前保存的消息": 8,
      "正在读取附件": 12,
      "正在安全读取附件": 14,
      "附件已经读取完成": 16,
      "正在整理对话上下文": 22,
      "正在请求所选模型": 30,
      "模型深度推理中": 38,
      "模型深入推理中": 42,
      "模型扩展推理中": 44,
    };
    const base = PHASE_WEIGHT[last] || 0;
    // 收到首字后按字数增长（45% ~ 92%）
    const textProgress = chars > 0
      ? Math.min(45 + Math.min(chars, 2000) / 2000 * 47, 92)
      : base;
    const pct = Math.max(base, textProgress);
    return { pct: Math.min(pct, 98), chars };
  }, [isGenerating, item.thinkingStatuses, item.content]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current?.timerId) {
      window.clearTimeout(longPressRef.current.timerId);
    }
    longPressRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function beginLongPress(event) {
    if (
      !canReference ||
      (event.button !== undefined && event.button !== 0) ||
      event.target?.closest?.("button, a, input, textarea, select")
    ) {
      return;
    }
    cancelLongPress();
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false,
      timerId: null,
    };
    gesture.timerId = window.setTimeout(() => {
      if (longPressRef.current !== gesture) return;
      gesture.triggered = true;
      onReference(item);
      globalThis.navigator?.vibrate?.(8);
    }, 520);
    longPressRef.current = gesture;
  }

  function moveLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      longPressMovementExceeded(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
      )
    ) {
      cancelLongPress();
    }
  }

  function endLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.triggered) event.preventDefault();
    cancelLongPress();
  }

  function preventTriggeredContextMenu(event) {
    if (longPressRef.current?.triggered) event.preventDefault();
  }

  const quotedDisplayName =
    quotedMessage?.role === "user" ? userName : aiName;

  return (
    <article
      className={`message-row ${isUser ? "user" : "assistant"}${
        canReference ? " can-reference" : ""
      }${skin === "taotao-cream" ? " chat-skin-cream-message" : ""}${
        skinPresentation?.groupStart ? " group-start" : ""
      }${skinPresentation?.groupEnd ? " group-end" : ""}${
        item.chatError === true ? " chat-error-message" : ""
      }`}
      onPointerDown={beginLongPress}
      onPointerMove={moveLongPress}
      onPointerUp={endLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={preventTriggeredContextMenu}
    >
      {avatar ? (
        <AuthenticatedImage
          src={avatar}
          alt={`${displayName}的头像`}
          className={`message-avatar message-avatar-image ${
            isUser ? "is-user" : "is-assistant"
          }`}
          fallback={
            <span
              className={`message-avatar message-avatar-letter ${
                isUser ? "is-user" : "is-assistant"
              }`}
              role="img"
              aria-label={`${displayName}的标记`}
            >
              {avatarLetter}
            </span>
          }
        />
      ) : <span
        className={`message-avatar message-avatar-letter ${
          isUser ? "is-user" : "is-assistant"
        }`}
        role="img"
        aria-label={`${displayName}的标记`}
      >
        {avatarLetter}
      </span>}
      <div className="message-column">
        <div className="message-role">{displayName}</div>
        <div className="message-bubble">
          {skin === "taotao-cream" && skinPresentation?.showOrnament && (
            <ChatSkinOrnament
              role={item.role}
              mood={companionMood}
            />
          )}
          {!isUser && item.tool_calls?.refusal_detected && (
            <div className="chat-refusal-banner" role="alert">
              <span className="chat-refusal-badge">⚠ 拒绝回答</span>
              <span className="chat-refusal-source">
                来源: {item.tool_calls.refusal_detected.source === "upstream" ? "上游模型（DengTa 提示词已允许成人内容，为模型自身/中转站审核拦截）" : "DengTa 自身过滤"}
              </span>
              <span className="chat-refusal-code">错误码: {item.tool_calls.refusal_detected.code || "provider_boundary_residue"}</span>
              {refusalLogId ? (
                <button
                  type="button"
                  className="chat-error-log-toggle chat-refusal-log-toggle"
                  onClick={() => void toggleErrorLog()}
                >
                  {logExpanded ? "收起日志" : "查看日志"}
                </button>
              ) : null}
              {logExpanded && (
                <div className="chat-error-log-detail">
                  {logLoading && <span className="chat-error-log-loading">读取中…</span>}
                  {!logLoading && logDetail?.fetch_failed && (
                    <span className="chat-error-log-failed">日志读取失败</span>
                  )}
                  {!logLoading && logDetail && !logDetail.fetch_failed && (
                    <>
                      <p className="chat-error-log-line"><strong>时间</strong>: {formatErrorTime(logDetail.created_at)}</p>
                      <p className="chat-error-log-line"><strong>错误码</strong>: {logDetail.error_code}</p>
                      {logDetail.error_source && <p className="chat-error-log-line"><strong>来源</strong>: {logDetail.error_source}</p>}
                      {logDetail.error_location && <p className="chat-error-log-line"><strong>位置</strong>: {logDetail.error_location}</p>}
                      <p className="chat-error-log-line chat-error-log-message"><strong>消息</strong>: {logDetail.error_message || logDetail.message}</p>
                      {logDetail.stack_trace && (
                        <pre className="chat-error-log-stack">{logDetail.stack_trace}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {quotedMessage && (
            <div className="message-reference-block">
              <strong>引用 {quotedDisplayName}</strong>
              <span>
                {quotedMessage.text ||
                  `${quotedMessage.attachment_summary?.count || 0} 个附件`}
                {quotedMessage.text_truncated ? "…" : ""}
              </span>
            </div>
          )}
          {item.content && (
            <div className="message-content">{item.content}</div>
          )}
          {!isUser && streamProgress && (
            <div className="stream-progress-bar" aria-label="回复进度">
              <i className="stream-progress-track"><b style={{ width: `${streamProgress.pct}%` }} /></i>
              <span className="stream-progress-chars">{streamProgress.chars}字</span>
            </div>
          )}
          {sticker && (
            <button
              type="button"
              className="message-sticker"
              aria-label={`查看表情：${sticker.alt}`}
              onClick={() => onPreview?.(sticker.assetPath, sticker.alt)}
            >
              <img src={sticker.assetPath} alt={sticker.alt} loading="lazy" />
            </button>
          )}
          {customSticker && (
            <AuthenticatedImage
              src={privateMediaContentPath(customSticker.id)}
              alt={customSticker.alt_text || customSticker.display_name || "自定义表情"}
              className="message-sticker-image"
              buttonClassName="message-sticker"
              onPreview={onPreview}
            />
          )}
          {artworkId && (
            <div className="message-artwork">
              {item.tool_calls?.is_surprise_reveal === true && (
                <span className="message-artwork-reveal">
                  悄悄准备的惊喜，现在揭晓
                </span>
              )}
              <AuthenticatedImage
                src={`/api/v2/creative/artworks/${encodeURIComponent(
                  artworkId,
                )}/image`}
                alt={artworkAlt}
                className="message-artwork-image"
                buttonClassName="message-artwork-preview"
                onPreview={onPreview}
              />
            </div>
          )}
          <MessageAttachments
            value={item.attachments || item.files}
            apiBaseUrl={apiBaseUrl}
            onPreview={onPreview}
          />
          {isUser &&
            item.tool_calls?.attachment_instruction_mode === "system" && (
              <div className="attachment-instruction-badge">
                本轮附件已作为系统指令
              </div>
            )}
          {!isUser && (
            <>
              {isGenerating && !thinkingDetailOpen ? (
                <div className="thinking-panel-minimal">
                  <span className="typing-indicator-inline" aria-label="正在回复中">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </span>
                  <button
                    type="button"
                    className="thinking-panel-minimal-toggle"
                    onClick={() => setThinkingDetailOpen(true)}
                    title="查看当前进度"
                  >
                    <span className="chevron">▸</span>
                    详情
                  </button>
                </div>
              ) : (
                <ThinkingPanel
                  message={item}
                  aiName={aiName}
                  companionMood={companionMood}
                  innerMonologue={innerMonologue}
                  innerMonologuePending={innerMonologuePending}
                  innerMonologueError={innerMonologueError}
                  onRequestInnerMonologue={onRequestInnerMonologue}
                />
              )}
              <DeviceActionReceipts actions={item.tool_calls?.mcp_actions} />
            </>
          )}
          {item.chatError === true && (
            <div className="chat-error-panel">
              <div className="chat-error-meta-row">
                <span className="chat-error-code-badge">
                  ⚠ {item.error_code || 'ERROR'}{' '}
                  {item.error_source ? `· ${item.error_source}` : ''}
                </span>
                {item.error_location && (
                  <span className="chat-error-location" title={item.error_location}>
                    位置: {item.error_location}
                  </span>
                )}
                <time className="chat-error-time">
                  {formatErrorTime(item.error_time || item.created_at)}
                </time>
              </div>
              {item.error_log_id ? (
                <button
                  type="button"
                  className="chat-error-log-toggle"
                  onClick={() => void toggleErrorLog()}
                >
                  {logExpanded ? '收起日志' : '查看日志'}
                </button>
              ) : (
                <span className="chat-error-no-log">未生成日志记录</span>
              )}
              {logExpanded && (
                <div className="chat-error-log-detail">
                  {logLoading && <span className="chat-error-log-loading">读取中…</span>}
                  {!logLoading && logDetail?.fetch_failed && (
                    <span className="chat-error-log-failed">日志读取失败</span>
                  )}
                  {!logLoading && logDetail && !logDetail.fetch_failed && (
                    <>
                      <p className="chat-error-log-line">
                        <strong>时间</strong>: {formatErrorTime(logDetail.created_at)}
                      </p>
                      <p className="chat-error-log-line">
                        <strong>路径</strong>: {logDetail.method} {logDetail.path}
                      </p>
                      <p className="chat-error-log-line">
                        <strong>错误码</strong>: {logDetail.error_code || 'unknown'}
                      </p>
                      <p className="chat-error-log-line">
                        <strong>消息</strong>: {logDetail.message || ''}
                      </p>
                      <p className="chat-error-log-line">
                        <strong>来源/阶段</strong>: {logDetail.error_source || 'dengta'}
                        {logDetail.provider_phase ? ` / ${logDetail.provider_phase}` : ''}
                        {logDetail.provider_code ? ` / ${logDetail.provider_code}` : ''}
                        {logDetail.upstream_status ? ` / HTTP ${logDetail.upstream_status}` : ''}
                      </p>
                      <p className="chat-error-log-line">
                        <strong>会话</strong>: {logDetail.conversation_id || '-'}
                      </p>
                      {logDetail.request_summary && (
                        <p className="chat-error-log-line">
                          <strong>请求</strong>: 模型 {logDetail.request_summary.model || '-'}
                          {' · '}流式 {logDetail.request_summary.stream ? '是' : '否'}
                          {Array.isArray(logDetail.request_summary.body_keys) && logDetail.request_summary.body_keys.length > 0
                            ? ` · 字段 ${logDetail.request_summary.body_keys.join(', ')}`
                            : ''}
                        </p>
                      )}
                      {logDetail.stack_trace && (
                        <pre className="chat-error-log-stack">{logDetail.stack_trace}</pre>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {item.voiceAnalysis && (
            <div className="voice-message-meta">
              <span>语音转写</span>
              <strong>
                {item.voiceAnalysis.emotion} ·{" "}
                {formatVoiceConfidence(item.voiceAnalysis.confidence)}
              </strong>
            </div>
          )}
          {item.isStreaming && !isGenerating === false && thinkingDetailOpen && (
            <span className="stream-caret" aria-label="正在回复">
              ♥
            </span>
          )}
          <div className="message-footer">
            {item.chatError === true &&
              typeof onDismissError === "function" && (
                <button
                  type="button"
                  className="message-error-dismiss"
                  aria-label="关闭这条错误提示"
                  title="关闭错误提示"
                  onClick={() => onDismissError(item.id)}
                >
                  ×
                </button>
              )}
            {canReference && (
              <button
                type="button"
                className="message-reference-button"
                aria-label={`引用${displayName}的这条消息`}
                onClick={() => onReference(item)}
              >
                引用
              </button>
            )}
            <time>
              {item.formattedTime || formatMessageTime(item.created_at)}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}

export default memo(ChatMessage);
