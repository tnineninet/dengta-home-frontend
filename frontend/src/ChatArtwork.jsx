import { useEffect, useState } from "react";
import { apiRequest } from "./api.js";
import { AuthenticatedImage } from "./PrivateMedia";

// 聊天里的图片是后台生成的：先显示占位，再轮询作品状态，完成后加载图片。
export default function ChatArtwork({ artworkId, alt, initialState = "", isSurpriseReveal = false, onPreview }) {
  const [state, setState] = useState(initialState || "ready");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artworkId) return undefined;
    if (state !== "generating" && state !== "queued") return undefined;
    let cancelled = false;
    let timer;
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      if (attempts > 120) {
        setError("图片还在后台处理，可以稍后到画室查看。");
        return;
      }
      try {
        const data = await apiRequest(`/api/v2/creative/artworks/${encodeURIComponent(artworkId)}`, { timeoutMs: 10_000 });
        if (cancelled) return;
        const next = data?.artwork?.state;
        if (["ready", "revealed", "ready_hidden"].includes(next)) {
          setState("ready");
          return;
        }
        if (["failed", "cancelled", "deleted"].includes(next)) {
          setState("failed");
          setError("这张图没有画完，可以到画室查看详情。");
          return;
        }
        if (next === "hidden") {
          setState("hidden");
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        if (attempts >= 4) setError(cause?.message || "查询图片状态失败。");
      }
      if (!cancelled) timer = setTimeout(check, 2500);
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [artworkId, state]);

  if (!artworkId || state === "hidden") return null;
  if (state === "generating" || state === "queued") {
    return (
      <div className="message-artwork is-generating" role="status" aria-live="polite">
        <div className="message-artwork-skeleton"><span /></div>
        <small>正在画，画好会出现在这里…</small>
      </div>
    );
  }
  if (state === "failed" || error) {
    return <div className="message-artwork-error" role="note">{error || "这张图没有画完。"}</div>;
  }
  return (
    <div className="message-artwork">
      {isSurpriseReveal && <span className="message-artwork-reveal">悄悄准备的惊喜，现在揭晓</span>}
      <AuthenticatedImage
        src={`/api/v2/creative/artworks/${encodeURIComponent(artworkId)}/image`}
        alt={alt || "AI 伴侣创作的图片"}
        className="message-artwork-image"
        buttonClassName="message-artwork-preview"
        onPreview={onPreview}
      />
    </div>
  );
}
