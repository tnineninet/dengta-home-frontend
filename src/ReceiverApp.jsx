import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeCastReceiver,
  clearReceiverToken,
  pairCastReceiver,
  readCastReceiverSession,
  readReceiverToken,
  storeReceiverToken,
} from "./cast-receiver-api.js";
import {
  applyReceiverPlayback,
  normalizeReceiverSession,
  RECEIVER_ACK_INTERVAL_MS,
  RECEIVER_POLL_INTERVAL_MS,
  shouldApplyReceiverRevision,
} from "./receiver-playback.js";
import "./receiver.css";

function receiverLabel() {
  const platform = String(globalThis.navigator?.platform || "").trim();
  return platform ? `客厅屏幕 · ${platform.slice(0, 32)}` : "客厅屏幕";
}

export default function ReceiverApp() {
  const videoRef = useRef(null);
  const revisionRef = useRef(-1);
  const [token, setToken] = useState(() => readReceiverToken(globalThis.sessionStorage));
  const [pairingCode, setPairingCode] = useState("");
  const [receiverName, setReceiverName] = useState(receiverLabel);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(token ? "正在恢复接收会话…" : "在控制端生成配对码后填写到这里。");
  const sessionId = session?.id || "";

  const finish = useCallback((nextMessage = "投屏已结束，可以重新配对。") => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    clearReceiverToken(globalThis.sessionStorage);
    revisionRef.current = -1;
    setToken("");
    setSession(null);
    setReady(false);
    setMessage(nextMessage);
  }, []);

  const ack = useCallback(async (event = "heartbeat") => {
    const video = videoRef.current;
    if (!token || !video) return;
    await acknowledgeCastReceiver(token, {
      revision: revisionRef.current,
      playbackState: video.paused ? "paused" : "playing",
      mediaPositionSeconds: video.currentTime,
      event,
    }).catch(() => {});
  }, [token]);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const next = normalizeReceiverSession(await readCastReceiverSession(token));
      if (next.status === "ended") {
        finish();
        return;
      }
      setSession(next);
      if (!next.mediaUrl) {
        setMessage(next.mediaError || "控制端尚未提供可播放的视频直链。");
        return;
      }
      setMessage(ready ? "已连接，播放状态会自动同步。" : "已连接。请在电视上确认一次“准备播放”。");
      if (!ready || !shouldApplyReceiverRevision(revisionRef.current, next.revision)) return;
      revisionRef.current = next.revision;
      const result = await applyReceiverPlayback(videoRef.current, next);
      if (result.autoplayBlocked) {
        setMessage("电视浏览器阻止了自动播放，请在电视上再次确认播放。");
      }
      void ack(result.seeked ? "seek" : next.playbackState);
    } catch (error) {
      if ([401, 403, 404, 410].includes(error?.status)) {
        finish("配对已失效，请在控制端生成新的配对码。");
      } else {
        setMessage(error?.message || "接收端暂时无法读取播放状态，将自动重试。");
      }
    }
  }, [ack, finish, ready, token]);

  useEffect(() => {
    if (!token) return undefined;
    const initialTimer = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => void poll(), RECEIVER_POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [poll, token]);

  useEffect(() => {
    if (!token || !sessionId) return undefined;
    const timer = window.setInterval(() => void ack("heartbeat"), RECEIVER_ACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ack, sessionId, token]);

  const pair = async (event) => {
    event.preventDefault();
    if (!pairingCode.trim() || !receiverName.trim() || busy) return;
    setBusy(true);
    setMessage("正在配对…");
    try {
      const data = await pairCastReceiver(pairingCode, receiverName);
      const nextToken = storeReceiverToken(globalThis.sessionStorage, data?.receiver_token);
      if (!nextToken) throw new Error("服务端没有返回有效的接收端凭据。");
      setToken(nextToken);
      setPairingCode("");
      if (data?.session) setSession(normalizeReceiverSession(data));
      setMessage("配对成功。请在电视上确认一次“准备播放”。");
    } catch (error) {
      setMessage(error?.message || "配对失败，请检查配对码是否已过期。");
    } finally {
      setBusy(false);
    }
  };

  const preparePlayback = async () => {
    setReady(true);
    const video = videoRef.current;
    if (!video || !session?.mediaUrl) return;
    revisionRef.current = session.revision;
    const result = await applyReceiverPlayback(video, session).catch((error) => {
      setMessage(error?.message || "视频无法播放，请检查媒体地址是否仍有效。");
      return null;
    });
    if (result?.autoplayBlocked) setMessage("请在电视上点击播放器的播放按钮确认播放。");
    else if (result) setMessage("电视已准备好，等待控制端操作。");
    void ack("ready");
  };

  return (
    <main className="receiver-app">
      <header><small>DENGTA CAST RECEIVER</small><h1>在这块屏幕上接收</h1><p>无需登录。配对凭据只保存在当前标签页会话中。</p></header>
      {!token ? (
        <form className="receiver-card" onSubmit={pair}>
          <label>配对码<input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\s/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus /></label>
          <label>接收端名称<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} maxLength={100} /></label>
          <button type="submit" disabled={busy || !pairingCode.trim() || !receiverName.trim()}>{busy ? "正在配对…" : "连接控制端"}</button>
        </form>
      ) : (
        <section className="receiver-stage">
          <video ref={videoRef} src={session?.mediaUrl || ""} controls playsInline preload="metadata" referrerPolicy="no-referrer" onPlay={() => void ack("play")} onPause={() => void ack("pause")} onSeeked={() => void ack("seek")} onEnded={() => void ack("ended")}>当前浏览器不支持 HTML5 视频。</video>
          <div className="receiver-overlay"><strong>{session?.title || "等待控制端的视频"}</strong>{!ready && <button type="button" onClick={() => void preparePlayback()}>准备播放</button>}</div>
        </section>
      )}
      <p className="receiver-message" role="status">{message}</p>
      <aside>只播放控制端提交的公开 HTTPS 视频直链；不支持平台网页、HTTP、私网地址，也不会绕过 DRM、登录或防盗链限制。</aside>
    </main>
  );
}
