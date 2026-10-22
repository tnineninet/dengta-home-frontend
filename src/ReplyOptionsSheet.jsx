import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import "./reply-options-sheet.css";

export default function ReplyOptionsSheet({
  open,
  options = [],
  loading = false,
  error = "",
  onClose,
  onSubmit,
  onRetry,
}) {
  const [selected, setSelected] = useState("");
  const [custom, setCustom] = useState("");
  const safeOptions = useMemo(
    () => (Array.isArray(options) ? options.filter(Boolean).slice(0, 6) : []),
    [options],
  );

  useEffect(() => {
    if (!open) return;
    setSelected("");
    setCustom("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const answer = custom.trim() || selected.trim();
  const submit = () => {
    if (!answer) return;
    onSubmit?.(answer);
  };

  return (
    <div className="reply-options-backdrop" role="presentation" onClick={onClose}>
      <section
        className="reply-options-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="回复选项"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="reply-options-header">
          <div>
            <span className="reply-options-kicker">DengTa 帮你选</span>
            <h2>这一句，想怎么回？</h2>
          </div>
          <button type="button" className="reply-options-close" aria-label="关闭回复选项" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="reply-options-body">
          {loading ? (
            <div className="reply-options-loading" role="status">
              <span className="reply-options-thinking" aria-hidden="true" />
              <p>正在按你们的语境想几句……</p>
            </div>
          ) : error ? (
            <div className="reply-options-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={onRetry}>再试一次</button>
            </div>
          ) : (
            <>
              <div className="reply-options-list" role="listbox" aria-label="AI 生成的回复">
                {safeOptions.map((option, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === option}
                    className={`reply-options-item${selected === option ? " is-selected" : ""}`}
                    key={`${index}-${option}`}
                    onClick={() => {
                      setSelected(option);
                      setCustom("");
                    }}
                  >
                    <span className="reply-options-index">{String.fromCharCode(65 + index)}</span>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
              <label className="reply-options-custom">
                <span>或者自己写一句</span>
                <input
                  value={custom}
                  onChange={(event) => {
                    setCustom(event.target.value);
                    setSelected("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Type your answer..."
                  maxLength={240}
                />
              </label>
            </>
          )}
        </div>

        <footer className="reply-options-footer">
          <button type="button" className="reply-options-skip" onClick={onClose}>跳过</button>
          <button type="button" className="reply-options-submit" disabled={!answer || loading} onClick={submit}>
            发送
          </button>
        </footer>
      </section>
    </div>
  );
}
