import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogIn, RefreshCw, Smartphone } from "lucide-react";
import {
  beginNeteaseQrLogin,
  checkNeteaseQrLogin,
  disconnectNeteaseQrLogin,
  getNeteaseQrStatus,
  importNeteaseQrPlaylist,
  listNeteaseQrPlaylists,
} from "./netease-qr-login.js";

const POLL_INTERVAL_MS = 2_000;
const QR_EXPIRY_WARNING_MS = 240_000;

function pickError(caught) {
  return caught?.message || "网易云扫码登录暂时失败。";
}

export default function NeteaseQrLogin({ onImported = () => {} }) {
  const canvasRef = useRef(null);
  const pollTimerRef = useRef(null);
  const startedAtRef = useRef(0);
  const autoRefreshCountRef = useRef(0);
  const [qrContent, setQrContent] = useState("");
  const [qrStatus, setQrStatus] = useState("idle"); // idle | waiting | scanned | confirmed | expired | risk_blocked | error
  const [connection, setConnection] = useState(null);
  const [nickname, setNickname] = useState("");
  const [uid, setUid] = useState("");
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getNeteaseQrStatus();
      setConnection(next?.connected === true ? next : null);
      setNickname(next?.nickname || "");
      setUid(next?.uid || "");
      return next;
    } catch {
      return { connected: false };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNeteaseQrStatus()
      .then((next) => {
        if (cancelled) return;
        setConnection(next?.connected === true ? next : null);
        setNickname(next?.nickname || "");
        setUid(next?.uid || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const drawQr = useCallback(async (content) => {
    setQrContent(content);
    const canvas = canvasRef.current;
    if (!canvas || !content) return;
    try {
      const QRCode = (await import("qrcode")).default;
      await QRCode.toCanvas(canvas, content, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    } catch (caught) {
      setError("二维码渲染失败，请点击“重新生成”再试。" + (caught?.message ? `（${caught.message}）` : ""));
    }
  }, []);

  const startLogin = useCallback(async () => {
    autoRefreshCountRef.current = 0;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const session = await beginNeteaseQrLogin();
      if (!session?.key || !session.qr_content) throw new Error("没有拿到登录二维码。");
      startedAtRef.current = Date.now();
      setQrStatus("waiting");
      setQrOpen(true);
      await drawQr(session.qr_content);
      stopPolling();
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          if (!session.key) return;
          if (Date.now() - startedAtRef.current > QR_EXPIRY_WARNING_MS) {
            setFeedback("二维码即将过期，若仍未登录请点击“重新生成”。");
          }
          try {
            const result = await checkNeteaseQrLogin(session.key);
            if (result?.status === "confirmed") {
              stopPolling();
              setQrStatus("confirmed");
              setQrOpen(false);
              setQrContent("");
              const next = result.connection || (await refreshStatus());
              setConnection(next?.connected === true ? next : null);
              setNickname(next?.nickname || "");
              setUid(next?.uid || "");
              setFeedback("扫码登录成功，现在可以直接导入你的网易云歌单。");
            } else if (result?.status === "scanned") {
              setQrStatus("scanned");
              setFeedback("已扫码，请在手机上确认登录。");
            } else if (result?.status === "expired") {
              stopPolling();
              if (autoRefreshCountRef.current < 3) {
                autoRefreshCountRef.current += 1;
                setFeedback("二维码已过期，正在为你自动刷新…");
                void startLogin();
              } else {
                setQrStatus("expired");
                setFeedback("二维码多次过期，请手动点击“重新生成”。");
              }
            } else if (result?.status === "risk_blocked") {
              stopPolling();
              setQrStatus("risk_blocked");
              setFeedback(result.message || "登录被网易云风控拦截，请稍后再试。");
            } else if (result?.status === "waiting") {
              setQrStatus("waiting");
            }
          } catch (caught) {
            if (caught?.code === "netease_qr_session_expired") {
              stopPolling();
              setQrStatus("expired");
            } else {
              setError(pickError(caught));
            }
          }
        })();
      }, POLL_INTERVAL_MS);
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, [drawQr, refreshStatus, stopPolling]);

  const cancelLogin = useCallback(() => {
    stopPolling();
    setQrOpen(false);
    setQrContent("");
    setQrStatus("idle");
    setFeedback("");
  }, [stopPolling]);

  const logout = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectNeteaseQrLogin();
      setConnection(null);
      setNickname("");
      setUid("");
      setRemotePlaylists([]);
      setFeedback("已退出网易云登录。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadRemotePlaylists = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const rows = await listNeteaseQrPlaylists();
      setRemotePlaylists(rows);
      setFeedback(rows.length ? `共读取到 ${rows.length} 个歌单。` : "没有读取到歌单。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const importPlaylist = useCallback(async (row) => {
    if (importBusy) return;
    setImportBusy(row.provider_playlist_id);
    setError("");
    try {
      const result = await importNeteaseQrPlaylist(row.provider_playlist_id);
      setFeedback(
        `已导入“${result.name || row.name}”：${result.total} 首，其中 ${result.playable_count} 首可直接一起听，${result.unavailable_count} 首需要会员或版权受限。`,
      );
      await onImported?.(result);
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setImportBusy("");
    }
  }, [importBusy, onImported]);

  const qrStatusText = {
    idle: "点击“扫码登录”开始。",
    waiting: "请用手机网易云音乐 App 扫描二维码。",
    scanned: "已扫码，请在手机上点击确认登录。",
    confirmed: "登录成功。",
    expired: "二维码已过期，请重新生成。",
    risk_blocked: "登录被风控拦截，请稍后再试。",
    error: "登录失败，请重试。",
  }[qrStatus] || "";

  return <div className="netease-qr-login">
    <div className="music-provider-connect-body">
      {connection ? <div className="netease-qr-connected" role="status">
        <Smartphone aria-hidden="true" />
        <span>已登录网易云：<strong>{nickname || "网易云用户"}</strong>{uid ? `（ID ${uid}）` : ""}</span>
        <button type="button" disabled={busy} onClick={() => void loadRemotePlaylists()}>读取我的歌单</button>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "处理中…" : "退出登录"}</button>
      </div> : <div className="netease-qr-disconnected">
        <p>不需要自己搭 MCP：用手机网易云音乐 App 扫码登录后，DengTa 只读取你的歌单并解析可播放直链。密码不会经过 DengTa，登录凭据加密保存在你的账号下。</p>
        <button type="button" className="together-primary" disabled={busy} onClick={() => void startLogin()}><LogIn aria-hidden="true" />{busy ? "正在生成…" : "扫码登录网易云"}</button>
      </div>}
      {qrOpen && createPortal(<div className="netease-qr-modal" role="dialog" aria-label="网易云扫码登录">
        <div className="netease-qr-card">
          <strong>用手机网易云音乐 App 扫码</strong>
          <canvas ref={canvasRef} aria-label="登录二维码" />
          <p>{qrStatusText}</p>
          <small className="netease-qr-hint">二维码过期后会自动刷新，无需手动操作。</small>
          <div className="netease-qr-actions">
            <button type="button" disabled={busy} onClick={() => void startLogin()}><RefreshCw aria-hidden="true" />重新生成</button>
            <button type="button" onClick={cancelLogin}>取消</button>
          </div>
          {qrContent && <a className="netease-qr-fallback" href={qrContent.replace(/^http:/, "https:")} target="_blank" rel="noopener noreferrer">二维码显示不出来？点这里打开网易云登录页</a>}
        </div>
      </div>, document.body)}
      {remotePlaylists.length > 0 && <div className="netease-qr-playlists">
        <strong>我的网易云歌单（点击导入）</strong>
        <ul>{remotePlaylists.map((row) => <li key={row.provider_playlist_id}>
          <button type="button" disabled={importBusy === row.provider_playlist_id} onClick={() => void importPlaylist(row)}>
            {row.name} · {row.item_count} 首
            {row.creator_nickname ? `（${row.creator_nickname}）` : ""}
            {importBusy === row.provider_playlist_id ? " 正在解析直链…" : ""}
          </button>
        </li>)}</ul>
      </div>}
      {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
      {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
    </div>
  </div>;
}
