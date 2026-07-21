import { useState } from "react";
import {
  formatAttachmentSize,
  normalizeMessageAttachments,
} from "./chat-attachments";
import { thinkingPanelVisible } from "./chat-thinking";

function attachmentIcon(kind) {
  if (kind === "image") return "图";
  if (kind === "audio") return "声";
  return "文";
}

export function SelectedAttachmentStrip({ items, onRemove }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="selected-attachment-strip" aria-label="待发送附件">
      {items.map((item) => (
        <div className="selected-attachment" key={item.id}>
          {item.kind === "image" && item.previewUrl ? (
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

export function MessageAttachments({ value, apiBaseUrl, onPreview }) {
  const items = normalizeMessageAttachments(value, apiBaseUrl);
  if (items.length === 0) return null;

  return (
    <div className="message-attachments" aria-label="消息附件">
      {items.map((item) =>
        item.kind === "image" && item.url ? (
          <button
            type="button"
            className="message-image-attachment"
            key={item.id}
            onClick={() => onPreview?.(item.url, item.name)}
          >
            <img src={item.url} alt={item.name} loading="lazy" />
            <span>{item.name}</span>
          </button>
        ) : (
          <a
            className="message-file-attachment"
            href={item.url || undefined}
            target={item.url ? "_blank" : undefined}
            rel={item.url ? "noreferrer" : undefined}
            aria-disabled={!item.url}
            key={item.id}
          >
            <span className={`attachment-kind ${item.kind}`} aria-hidden="true">
              {attachmentIcon(item.kind)}
            </span>
            <span className="attachment-copy">
              <strong>{item.name}</strong>
              <small>{formatAttachmentSize(item.size)}</small>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

export function ThinkingPanel({ message }) {
  const visible = thinkingPanelVisible(message);
  const completed = message?.isStreaming !== true;
  const [open, setOpen] = useState(!completed);

  if (!visible) return null;

  const statuses = Array.isArray(message.thinkingStatuses)
    ? message.thinkingStatuses
    : [];
  const reasoning = String(message.reasoningSummary || "").trim();

  return (
    <details
      className="thinking-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{completed ? "本轮处理摘要" : "正在处理"}</span>
        <small>接口返回的处理信息可能不完整</small>
      </summary>
      <div className="thinking-panel-body">
        {statuses.length > 0 && (
          <ol>
            {statuses.map((status, index) => (
              <li key={`${status}-${index}`}>{status}</li>
            ))}
          </ol>
        )}
        {reasoning && <p>{reasoning}</p>}
      </div>
    </details>
  );
}
