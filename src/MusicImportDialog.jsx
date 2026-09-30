import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function MusicImportDialog({ children, onClose, busy = false }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector("button")?.focus();
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) closeRef.current?.(); }
      if (event.key !== "Tab") return;
      const buttons = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')].filter(node => node.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(<div className="music-import-backdrop"><section className="music-import-dialog" role="dialog" aria-modal="true" aria-labelledby="music-import-heading" tabIndex={-1} ref={panelRef}><header><div><small>一起听歌</small><h2 id="music-import-heading">导入想听的歌</h2>{busy && <small role="status">正在保存，请稍候…</small>}</div><button type="button" aria-label="关闭歌曲导入" disabled={busy} onClick={onClose}><X aria-hidden="true" /></button></header><div className="music-import-dialog-body">{children}</div></section></div>, document.body);
}
