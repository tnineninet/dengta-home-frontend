import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { CheckCircle2, Download, ExternalLink, LogIn, RefreshCw, Smartphone } from "lucide-react";
import {
  beginNeteaseQrLogin,
  checkNeteaseQrLogin,
  disconnectNeteaseQrLogin,
  getNeteaseQrStatus,
  importNeteaseQrPlaylist,
  listNeteaseQrPlaylists,
} from "./netease-qr-login.js";
import { readNeteaseCookieSession } from "./music-listening.js";

const POLL_INTERVAL_MS = 3_000;
const QR_STORAGE_KEY = "dengta:netease:pending_qr:v1";
const QR_MAX_AGE_MS = 4.5 * 60 * 1000;
const QR_RISK_BLOCK_CODES = new Set([-462, -460, 8820, 8821]);

function isQrRiskBlocked(result) {
  if (!result) return false;
  if (result.status === "risk_blocked") return true;
  if (result.raw_code !== undefined && QR_RISK_BLOCK_CODES.has(Number(result.raw_code))) return true;
  return /验证|风控/.test(String(result.message || ""));
}

function pickError(caught) {
  return caught?.message || "网易云扫码登录暂时失败。";
}

function readPendingQr() {
  try {
    const raw = window.sessionStorage?.getItem(QR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.key || !parsed?.qrContent || !Number.isFinite(parsed.startedAt)) return null;
    if (Date.now() - parsed.startedAt > QR_MAX_AGE_MS) {
      window.sessionStorage?.removeItem(QR_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePendingQr(entry) {
  try {
    if (!entry) window.sessionStorage?.removeItem(QR_STORAGE_KEY);
    else window.sessionStorage?.setItem(QR_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore restricted storage contexts.
  }
}

async function fetchUnifiedConnection() {
  const [qrRes, cookieRes] = await Promise.allSettled([
    getNeteaseQrStatus(),
    readNeteaseCookieSession(),
  ]);
  if (qrRes.status === "fulfilled" && qrRes.value?.connected === true) {
    return {
      connected: true,
      nickname: qrRes.value.nickname || "",
      uid: qrRes.value.uid || "",
      source: qrRes.value.source || "qr_login",
    };
  }
  const cookieSession = cookieRes.status === "fulfilled" ? cookieRes.value?.session : null;
  if (cookieSession?.connected === true) {
    return {
      connected: true,
      nickname: cookieSession.account_name || "",
      uid: cookieSession.account_id || "",
      source: "cookie_session",
    };
  }
  return { connected: false };
}

export default function NeteaseQrLogin({
  onImported = () => {},
  onConnected,
  onNativeCookieLogin = null,
  nativeCookieBusy = false,
  inline = false,
  autoStart = false,
  hidePlaylists = false,
}) {
  const canvasRef = useRef(null);
  const pollTimerRef = useRef(null);
  const pollInFlightRef = useRef(false);
  const lastResumeAtRef = useRef(0);
  const activeKeyRef = useRef("");
  const startedAtRef = useRef(0);
  const loginAttemptRef = useRef(0);
  const autoStartedRef = useRef(false);

  const [qrContent, setQrContent] = useState("");
  const [qrStatus, setQrStatus] = useState("idle"); // idle | waiting | scanned | confirmed | expired | risk_blocked | error
  const [connection, setConnection] = useState(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [nickname, setNickname] = useState("");
  const [uid, setUid] = useState("");
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [importBusy, setImportBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(inline);
  const [deviceLine, setDeviceLine] = useState("");
  const [lastPollLine, setLastPollLine] = useState("");

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applyConfirmedConnection = useCallback((next, notice = "扫码登录成功！已自动同步网易云登录态。") => {
    stopPolling();
    loginAttemptRef.current += 1;
    activeKeyRef.current = "";
    writePendingQr(null);
    setQrStatus("confirmed");
    if (!inline) setQrOpen(false);
    setQrContent("");
    setError("");
    const safeConn = next?.connected === true ? next : null;
    setConnection(safeConn);
    setNickname(safeConn?.nickname || "");
    setUid(safeConn?.uid || "");
    setFeedback(notice);
    if (safeConn && typeof onConnected === "function") {
      onConnected(safeConn);
    }
  }, [inline, onConnected, stopPolling]);

  const pollOnce = useCallback(async ({ key, attempt, manual = false } = {}) => {
    const targetKey = key || activeKeyRef.current;
    if (!targetKey) return;
    if (attempt !== undefined && attempt !== loginAttemptRef.current) return;
    if (pollInFlightRef.current && !manual) return;

    pollInFlightRef.current = true;
    if (manual) setCheckingNow(true);
    try {
      const result = await checkNeteaseQrLogin(targetKey);
      if (attempt !== undefined && attempt !== loginAttemptRef.current) return;
      const riskBlocked = isQrRiskBlocked(result);
      const effectiveStatus = riskBlocked ? "risk_blocked" : result?.status;
      const statusNames = {
        waiting: "等待扫码",
        scanned: "已扫码，请在网易云点确认",
        confirmed: "登录成功",
        expired: "二维码已过期",
        risk_blocked: "云端 IP 被网易云风控拦截",
      };
      setLastPollLine(
        `状态：${statusNames[effectiveStatus] || effectiveStatus || "检测中"}` +
          (result?.raw_code !== undefined ? ` (code ${result.raw_code})` : "") +
          (result?.message ? ` · ${result.message}` : ""),
      );

      if (effectiveStatus === "confirmed") {
        const next = result.connection || (await fetchUnifiedConnection());
        applyConfirmedConnection(next?.connected ? next : { connected: true, nickname: "", uid: "" });
        return;
      }
      if (effectiveStatus === "scanned") {
        setQrStatus("scanned");
        setFeedback("已检测到扫码！请在网易云 App 点击「确认登录」，切回灯塔会自动完成同步。");
        return;
      }
      if (effectiveStatus === "expired") {
        // 800 可能是上一轮已经确认成功导致 key 消费完毕，先核对真实登录态再判定过期！
        const liveStatus = await fetchUnifiedConnection();
        if (liveStatus.connected) {
          applyConfirmedConnection(liveStatus);
          return;
        }
        stopPolling();
        activeKeyRef.current = "";
        writePendingQr(null);
        setQrStatus("expired");
        setFeedback("二维码已过期，请点击「换一张」重新生成。");
        return;
      }
      if (effectiveStatus === "risk_blocked") {
        const liveStatus = await fetchUnifiedConnection();
        if (liveStatus.connected) {
          applyConfirmedConnection(liveStatus);
          return;
        }
        stopPolling();
        loginAttemptRef.current += 1;
        activeKeyRef.current = "";
        writePendingQr(null);
        setQrStatus("risk_blocked");
        setFeedback(
          onNativeCookieLogin
            ? `网易云风控拦截了云端服务器扫码（code ${result?.raw_code ?? -462}）。请直接点上方「App 内一键登录（免风控）」用手机本机网络登录，100% 自动同步！`
            : (result?.message || "云端扫码被网易云风控拦截（code -462）。") +
                " 请改用手机 App 内置浏览器一键登录或稍后重试。",
        );
        return;
      }
      if (manual) {
        // 用户主动点击“我已扫码”或切回前台时，同时核对已有登录态避免漏抓。
        const liveStatus = await fetchUnifiedConnection();
        if (liveStatus.connected) {
          applyConfirmedConnection(liveStatus);
          return;
        }
        setFeedback("暂未检测到确认结果，请确认已在网易云点过「确认登录」，或 2 秒后再点一次检测。");
      }
      setQrStatus("waiting");
    } catch (caught) {
      // 网络刚从后台恢复时可能短时报错，兜底查一次登录态，绝不中断轮询。
      const liveStatus = await fetchUnifiedConnection().catch(() => ({ connected: false }));
      if (liveStatus.connected) {
        applyConfirmedConnection(liveStatus);
        return;
      }
      if (caught?.code === "netease_qr_session_expired") {
        stopPolling();
        activeKeyRef.current = "";
        writePendingQr(null);
        setQrStatus("expired");
      } else if (manual) {
        setError(pickError(caught));
      }
    } finally {
      pollInFlightRef.current = false;
      if (manual) setCheckingNow(false);
    }
  }, [applyConfirmedConnection, stopPolling]);

  const beginPollingForKey = useCallback((key, attempt) => {
    activeKeyRef.current = key;
    stopPolling();
    pollTimerRef.current = window.setInterval(() => {
      if (document.hidden) return;
      void pollOnce({ key, attempt, manual: false });
    }, POLL_INTERVAL_MS);
  }, [pollOnce, stopPolling]);

  const startLogin = useCallback(async ({ reuseKey = null } = {}) => {
    const attempt = loginAttemptRef.current + 1;
    loginAttemptRef.current = attempt;
    setBusy(true);
    setError("");
    setFeedback("");
    stopPolling();
    try {
      let key = "";
      let content = "";
      let deviceUsed = null;
      if (reuseKey?.key && reuseKey?.qrContent) {
        key = reuseKey.key;
        content = reuseKey.qrContent;
        startedAtRef.current = reuseKey.startedAt || Date.now();
      } else {
        const session = await beginNeteaseQrLogin();
        if (attempt !== loginAttemptRef.current) return;
        if (!session?.key || !session.qr_content) throw new Error("没有拿到登录二维码。");
        key = session.key;
        content = String(session.qr_content).replace(/^http:\/\//i, "https://");
        deviceUsed = session.device_used === true;
        startedAtRef.current = Date.now();
        writePendingQr({ key, qrContent: content, startedAt: startedAtRef.current });
      }
      setQrStatus("waiting");
      setQrOpen(true);
      if (deviceUsed !== null) {
        setDeviceLine(
          deviceUsed
            ? "已绑定本机设备标识，支持保存二维码后切回自动同步"
            : "网页模式二维码，扫码确认后切回本页会自动检测登录态",
        );
      }
      setLastPollLine("已生成二维码，等待扫码…");
      setQrContent(content);
      beginPollingForKey(key, attempt);
      if (reuseKey) {
        void pollOnce({ key, attempt, manual: true });
      }
    } catch (caught) {
      stopPolling();
      activeKeyRef.current = "";
      setError(pickError(caught));
      setFeedback(
        caught?.code === "netease_qr_too_frequent"
          ? "短时间生成二维码次数过多，请稍等几分钟或使用 App 内登录。"
          : "二维码暂时生成失败，请点「重新生成」再试。",
      );
    } finally {
      if (attempt === loginAttemptRef.current) setBusy(false);
    }
  }, [beginPollingForKey, pollOnce, stopPolling]);

  // 初始检查登录态 + 若刚从后台切回且页面被重载，自动续查 sessionStorage 中保存的 pending QR key。
  useEffect(() => {
    let cancelled = false;
    fetchUnifiedConnection()
      .then((next) => {
        if (cancelled) return;
        setStatusChecked(true);
        if (next?.connected === true) {
          writePendingQr(null);
          setConnection(next);
          setNickname(next.nickname || "");
          setUid(next.uid || "");
          if (typeof onConnected === "function") onConnected(next);
          return;
        }
        const pending = readPendingQr();
        if (pending && (inline || autoStart)) {
          autoStartedRef.current = true;
          void startLogin({ reuseKey: pending });
        } else if (autoStart && !autoStartedRef.current) {
          autoStartedRef.current = true;
          void startLogin();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatusChecked(true);
          if (autoStart && !autoStartedRef.current) {
            autoStartedRef.current = true;
            void startLogin();
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [autoStart, inline, onConnected, startLogin]);

  // 关键修复：从网易云音乐 App 扫码切回手机浏览器 / DengTa App 时，立刻多波次补查！
  useEffect(() => {
    const onForegroundResume = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastResumeAtRef.current < 900) return;
      lastResumeAtRef.current = now;
      const key = activeKeyRef.current || readPendingQr()?.key || "";
      if (!key) {
        void fetchUnifiedConnection().then((live) => {
          if (live?.connected) applyConfirmedConnection(live);
        }).catch(() => {});
        return;
      }
      setLastPollLine("欢迎回来！正在同步网易云登录态…");
      void pollOnce({ key, manual: true });
      window.setTimeout(() => {
        if (activeKeyRef.current === key) void pollOnce({ key, manual: false });
      }, 1500);
      window.setTimeout(() => {
        if (activeKeyRef.current === key) void pollOnce({ key, manual: false });
      }, 4000);
    };
    document.addEventListener("visibilitychange", onForegroundResume);
    window.addEventListener("pageshow", onForegroundResume);
    window.addEventListener("focus", onForegroundResume);
    let capHandle = null;
    if (Capacitor?.isNativePlatform?.()) {
      Promise.resolve(
        CapacitorApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onForegroundResume();
        }),
      )
        .then((handle) => { capHandle = handle; })
        .catch(() => {});
    }
    return () => {
      document.removeEventListener("visibilitychange", onForegroundResume);
      window.removeEventListener("pageshow", onForegroundResume);
      window.removeEventListener("focus", onForegroundResume);
      capHandle?.remove?.();
    };
  }, [applyConfirmedConnection, pollOnce]);

  useEffect(() => () => {
    loginAttemptRef.current += 1;
    stopPolling();
  }, [stopPolling]);

  // 弹窗/内联挂载后绘制高清白边二维码（白边保障网易云相册识图 100% 识别）
  useEffect(() => {
    if ((!qrOpen && !inline) || !qrContent) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toCanvas(canvas, qrContent, {
          width: 248,
          margin: 3,
          color: { dark: "#171a21", light: "#ffffff" },
          errorCorrectionLevel: "M",
        }),
      )
      .catch((caught) => {
        if (cancelled) return;
        setError("二维码渲染失败，请点击「换一张」再试。" + (caught?.message ? `（${caught.message}）` : ""));
      });
    return () => { cancelled = true; };
  }, [inline, qrOpen, qrContent]);

  const saveQrImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setError("二维码尚未生成完毕，请稍等一秒再保存。");
      return;
    }
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const filename = `dengta-netease-qr-${Date.now()}.png`;
      if (typeof window !== "undefined" && typeof window.DengTaFileBridge?.saveImageToGallery === "function") {
        const ok = window.DengTaFileBridge.saveImageToGallery(dataUrl, filename);
        if (ok) {
          setFeedback("二维码已保存到手机相册（Pictures/DengTa），点下方「打开网易云扫码」即可识别！");
          return;
        }
      }
      if (typeof window !== "undefined" && typeof window.DengTaFileBridge?.saveExport === "function") {
        window.DengTaFileBridge.saveExport(dataUrl, filename);
        setFeedback("二维码已保存，请打开网易云音乐 App 扫一扫相册。");
        return;
      }
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setFeedback("已触发保存二维码图片，用网易云音乐扫一扫相册即可，扫完切回本页会自动同步。");
    } catch (caught) {
      setError("保存二维码失败，你可以直接手机截屏后用网易云相册扫码。" + (caught?.message ? `（${caught.message}）` : ""));
    }
  }, []);

  const openNeteaseApp = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.DengTaFileBridge?.openNeteaseApp === "function") {
      window.DengTaFileBridge.openNeteaseApp();
      return;
    }
    window.location.href = "orpheus://";
  }, []);

  const cancelLogin = useCallback(() => {
    loginAttemptRef.current += 1;
    activeKeyRef.current = "";
    writePendingQr(null);
    stopPolling();
    if (!inline) setQrOpen(false);
    setQrContent("");
    setQrStatus("idle");
    setFeedback("");
    setBusy(false);
  }, [inline, stopPolling]);

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
      if (typeof onConnected === "function") onConnected(null);
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, [onConnected]);

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
    idle: "点击「生成二维码」开始扫码登录。",
    waiting: "保存二维码到相册或直接用网易云音乐 App 扫码；扫完切回本页将自动同步登录态。",
    scanned: "已扫码！请在网易云 App 点击「确认登录」。",
    confirmed: "登录成功！",
    expired: "二维码已过期，请点击「换一张」。",
    risk_blocked: "登录触发网易云风控，请稍后再试或用下方 App 内登录。",
    error: "登录失败，请重试。",
  }[qrStatus] || "";

  const qrCardContent = (
    <div className={`netease-qr-card${inline ? " is-inline" : ""}`}>
      <strong>网易云音乐 · 扫码登录</strong>
      <div className="netease-qr-canvas-frame">
        {qrContent ? (
          <canvas ref={canvasRef} aria-label="网易云登录二维码" />
        ) : (
          <div className="netease-qr-placeholder">
            {busy ? "正在向网易云申请二维码…" : "点击下方按钮生成二维码"}
          </div>
        )}
      </div>
      <p className="netease-qr-status-text">{qrStatusText}</p>
      {lastPollLine && <p className="netease-qr-diag">{lastPollLine}</p>}
      {deviceLine && <p className="netease-qr-diag">{deviceLine}</p>}

      <div className="netease-qr-actions">
        {onNativeCookieLogin && (
          <button
            type="button"
            className="netease-qr-primary is-full"
            disabled={nativeCookieBusy}
            onClick={() => void onNativeCookieLogin(false)}
          >
            <Smartphone aria-hidden="true" size={15} />
            {nativeCookieBusy ? "正在同步登录态…" : "App 内一键登录（免风控 · 推荐）"}
          </button>
        )}
        <button
          type="button"
          className={onNativeCookieLogin ? "" : "netease-qr-primary"}
          disabled={!qrContent}
          onClick={() => void saveQrImage()}
        >
          <Download aria-hidden="true" size={15} />
          保存二维码到相册
        </button>
        <button type="button" disabled={!qrContent} onClick={openNeteaseApp}>
          <ExternalLink aria-hidden="true" size={15} />
          打开网易云 App
        </button>
        <button
          type="button"
          disabled={(!qrContent && qrStatus !== "risk_blocked") || checkingNow}
          onClick={() => {
            if (activeKeyRef.current) {
              void pollOnce({ manual: true });
            } else {
              setCheckingNow(true);
              void fetchUnifiedConnection()
                .then((live) => {
                  if (live?.connected) applyConfirmedConnection(live);
                  else setFeedback("暂未检测到已登录会话，请点「App 内一键登录」或重新生成二维码。");
                })
                .finally(() => setCheckingNow(false));
            }
          }}
        >
          <CheckCircle2 aria-hidden="true" size={15} />
          {checkingNow ? "检测中…" : "我已扫码，立即检测"}
        </button>
        <button type="button" disabled={busy} onClick={() => void startLogin()}>
          <RefreshCw aria-hidden="true" size={15} />
          {qrContent ? "换一张" : "生成二维码"}
        </button>
        {!inline && (
          <button type="button" onClick={cancelLogin}>取消</button>
        )}
      </div>

      <small className="netease-qr-hint">
        {onNativeCookieLogin
          ? "提示：云端扫码若遇网易云风控（code -462），请直接点「App 内一键登录」用手机本机登录，成功后自动抓回登录态。"
          : "单机扫码教程：① 保存二维码到相册 → ② 网易云扫一扫相册并确认 → ③ 切回灯塔自动捕获登录态。"}
      </small>
    </div>
  );

  if (inline) {
    return (
      <div className="netease-qr-login is-inline">
        {!statusChecked ? (
          <div className="netease-qr-loading">正在核对你的网易云登录态…</div>
        ) : connection ? (
          <div className="netease-qr-connected" role="status">
            <Smartphone aria-hidden="true" size={16} />
            <span>已登录网易云：<strong>{nickname || "网易云用户"}</strong>{uid ? `（ID ${uid}）` : ""}</span>
            {!hidePlaylists && (
              <button type="button" disabled={busy} onClick={() => void loadRemotePlaylists()}>读取我的歌单</button>
            )}
            <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "处理中…" : "退出登录"}</button>
          </div>
        ) : (
          qrCardContent
        )}
        {!hidePlaylists && remotePlaylists.length > 0 && (
          <div className="netease-qr-playlists">
            <strong>我的网易云歌单（点击导入）</strong>
            <ul>{remotePlaylists.map((row) => <li key={row.provider_playlist_id}>
              <button type="button" disabled={importBusy === row.provider_playlist_id} onClick={() => void importPlaylist(row)}>
                {row.name} · {row.item_count} 首
                {row.creator_nickname ? `（${row.creator_nickname}）` : ""}
                {importBusy === row.provider_playlist_id ? " 正在解析直链…" : ""}
              </button>
            </li>)}</ul>
          </div>
        )}
        {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
        {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
      </div>
    );
  }

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
        {qrCardContent}
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
