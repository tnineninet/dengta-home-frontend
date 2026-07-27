import { useState } from "react";
import {
  formatAttachmentSize,
  normalizeMessageAttachments,
} from "./chat-attachments";
import {
  personalizedThinkingStatus,
  thinkingPanelCompleted,
  thinkingPanelVisible,
} from "./chat-thinking";
import { usePrivateMediaSource } from "./use-private-media";

function attachmentIcon(kind) {
  if (kind === "image") return "图";
  if (kind === "audio") return "声";
  if (kind === "video") return "影";
  return "文";
}

export function SelectedAttachmentStrip({ items, onRemove }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="selected-attachment-strip" aria-label="待发送附件">
      {items.map((item) => (
        <div className="selected-attachment" key={item.id}>
          {(item.kind === "image" || item.kind === "video") &&
          item.previewUrl ? (
            <img src={item.previewUrl} alt="" />
          ) : (
            <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
              {attachmentIcon(item.kind)}
            </span>
          )}
          <span className="attachment-copy">
            <strong title={item.name}>{item.name}</strong>
            <small>{formatAttachmentSize(item.size)}</small>
          </span>
          <button
            type="button"
            aria-label={`移除附件 ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function AuthenticatedAttachment({ item, onPreview }) {
  const media = usePrivateMediaSource(item.url);
  if (media.loading) {
    return (
      <div className="message-file-attachment is-loading" role="status">
        <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
          {attachmentIcon(item.kind)}
        </span>
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>正在安全读取</small>
        </span>
      </div>
    );
  }
  if (!media.url) {
    return (
      <div
        className="message-file-attachment is-error"
        role="status"
        title={media.error}
      >
        <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
          {attachmentIcon(item.kind)}
        </span>
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>暂时无法读取</small>
        </span>
      </div>
    );
  }

  if (item.kind === "image") {
    return (
      <button
        type="button"
        className="message-image-attachment"
        onClick={() => onPreview?.(media.url, item.name)}
      >
        <img src={media.url} alt={item.name} loading="lazy" />
        <span>{item.name}</span>
      </button>
    );
  }
  if (item.kind === "audio") {
    return (
      <div className="message-audio-attachment">
        <div className="message-audio-heading">
          <span className="attachment-kind audio" aria-hidden="true">
            {attachmentIcon(item.kind)}
          </span>
          <span className="attachment-copy">
            <strong>{item.name}</strong>
            <small>{formatAttachmentSize(item.size)}</small>
          </span>
        </div>
        <audio
          controls
          preload="metadata"
          src={media.url}
          aria-label={`播放语音 ${item.name}`}
        />
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <div className="message-video-attachment">
        <video
          controls
          preload="metadata"
          src={media.url}
          aria-label={`播放视频 ${item.name}`}
        />
        <span className="attachment-copy">
          <strong>{item.name}</strong>
          <small>{formatAttachmentSize(item.size)}</small>
        </span>
      </div>
    );
  }
  return (
    <a
      className="message-file-attachment"
      href={media.url}
      download={item.name}
    >
      <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
        {attachmentIcon(item.kind)}
      </span>
      <span className="attachment-copy">
        <strong>{item.name}</strong>
        <small>{formatAttachmentSize(item.size)}</small>
      </span>
    </a>
  );
}

export function MessageAttachments({ value, apiBaseUrl, onPreview }) {
  const items = normalizeMessageAttachments(value, apiBaseUrl);
  if (items.length === 0) return null;

  return (
    <div className="message-attachments" aria-label="消息附件">
      {items.map((item) => (
        <AuthenticatedAttachment
          item={item}
          onPreview={onPreview}
          key={item.id}
        />
      ))}
    </div>
  );
}

export function ThinkingPanel({ message, aiName = "小灯", companionMood = "" }) {
  const visible = thinkingPanelVisible(message);
  const completed = thinkingPanelCompleted(message);
  const [open, setOpen] = useState(!completed);

  if (!visible) return null;

  const statuses = Array.isArray(message.thinkingStatuses)
    ? message.thinkingStatuses
    : [];
  const summary =
    typeof message.thinkingSummary === "string"
      ? message.thinkingSummary.trim()
      : "";
  const displayName = String(aiName || "").trim() || "小灯";
  const mood = String(companionMood || "").trim();

  return (
    <details
      className="thinking-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          {completed ? `${displayName}刚才想了想` : `${displayName}悄悄想一会儿`}
        </span>
        <small>公开摘要 · 内部推理不会显示</small>
      </summary>
      <div className="thinking-panel-body">
        <div className="thinking-context-chip">
          <strong>{displayName}</strong>
          {mood && <span>此刻：{mood}</span>}
        </div>
        {statuses.length > 0 && (
          <ol>
            {statuses.map((status, index) => {
              const active = !completed && index === statuses.length - 1;
              return (
                <li
                  className={active ? "is-active" : "is-complete"}
                  aria-current={active ? "step" : undefined}
                  key={`${status}-${index}`}
                >
                  <span className="thinking-step-marker" aria-hidden="true">
                    {active ? "·" : "✓"}
                  </span>
                  <span>
                    {personalizedThinkingStatus(status, {
                      aiName: displayName,
                      companionMood: mood,
                    })}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {summary && <p className="thinking-summary-text">{summary}</p>}
      </div>
    </details>
  );
}
