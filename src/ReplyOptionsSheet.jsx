import { X } from "lucide-react";
import "./reply-options-sheet.css";

export default function ReplyOptionsPopover({
  open,
  options = [],
  loading = false,
  error = "",
  onClose,
  onPick,
  onRetry,
}) {
  if (!open) return null;
  const safeOptions = Array.isArray(options) ? options.filter(Boolean).slice(0, 6) : [];

  return (
    <section
      className="reply-options-popover"
      role="dialog"
      aria-modal="false"
      aria-label="回复选项"
    >
      <header className="reply-options-popover-header">
        <span>帮你选</span>
        <button type="button" aria-label="收起回复选项" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>

      {loading ? (
        <div className="reply-options-popover-loading" role="status">
          <span aria-hidden="true" />
          正在按你们的语境想几句…
        </div>
      ) : error ? (
        <div className="reply-options-popover-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>再试一次</button>
        </div>
      ) : (
        <>
          <div className="reply-options-popover-list">
            {safeOptions.map((option, index) => (
              <button
                type="button"
                key={`${index}-${option}`}
                onClick={() => onPick?.(option)}
                title={option}
              >
                <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>
                <strong>{option}</strong>
              </button>
            ))}
          </div>
          <small className="reply-options-popover-hint">
            点一句填进输入框，或者直接自己写；一开始输入就会收起
          </small>
        </>
      )}
    </section>
  );
}
