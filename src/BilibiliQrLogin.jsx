import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogIn, RefreshCw, Smartphone } from "lucide-react";
import {
  beginBilibiliQrLogin,
  checkBilibiliQrLogin,
  disconnectBilibiliQrLogin,
  getBilibiliQrStatus,
  listBilibiliFavoriteFolders,
  listBilibiliFavoriteVideos,
} from "./bilibili-qr-login.js";
import { apiRequest } from "./api.js";
import { openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";

const POLL_INTERVAL_MS = 2_000;

function pickError(caught) {
  return caught?.message || "哔哩哔哩扫码登录暂时失败。";
}

export default function BilibiliQrLogin({ onPickVideo = () => {} }) {
  const canvasRef = useRef(null);
  const pollTimerRef = useRef(null);
  const autoRefreshCountRef = useRef(0);
  const startedAtRef = useRef(0);
  const [qrContent, setQrContent] = useState("");
  const [qrStatus, setQrStatus] = useState("idle"); // idle | waiting | scanned | confirmed | expired | risk_blocked | error
  const [connection, setConnection] = useState(null);
  const [nickname, setNickname] = useState("");
  const [faceUrl, setFaceUrl] = useState("");
  const [folders, setFolders] = useState([]);
  const [folderVideos, setFolderVideos] = useState([]);
  const [folderTitle, setFolderTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(false);

    const settledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // 弹窗挂载后再绘制:修复第一次点击时画布还没渲染导致二维码空白的问题。
  useEffect(() => {
    if (!qrOpen || !qrContent) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) => QRCode.toCanvas(canvas, qrContent, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      }))
      .catch(() => {
        if (!cancelled) setError("二维码渲染失败，请点击“重新生成”再试。");
      });
    return () => { cancelled = true; };
  }, [qrOpen, qrContent]);

  useEffect(() => {
    let cancelled = false;
    getBilibiliQrStatus()
      .then((next) => {
        if (cancelled) return;
        setConnection(next?.connected === true ? next : null);
        setNickname(next?.nickname || "");
        setFaceUrl(next?.face_url || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const startLogin = useCallback(async () => {
    if (settledRef.current) return; // 已登录成功后不再重开二维码
    autoRefreshCountRef.current = 0;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const session = await beginBilibiliQrLogin();
      if (!session?.key || !session.qr_content) throw new Error("没有拿到登录二维码。");
      startedAtRef.current = Date.now();
      setQrStatus("waiting");
      setQrOpen(true);
      setQrContent(session.qr_content);
      stopPolling();
      const key = session.key;
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          // 扫码时用户切到哔哩 App,WebView 被节流;回到前台后下个周期立即补查。
          if (document.hidden) return;
          try {
            const result = await checkBilibiliQrLogin(key);
            if (result?.status === "confirmed") {
              settledRef.current = true;
              stopPolling();
              setQrStatus("confirmed");
              setQrOpen(false);
              setQrContent("");
              const next = result.connection;
              setConnection(next?.connected === true ? next : null);
              setNickname(next?.nickname || "");
              setFaceUrl(next?.face_url || "");
              setFeedback("扫码登录成功，可以读取你的收藏夹了。");
              return; // 已成功：不再执行下面的 75 秒换新逻辑
            } else if (result?.status === "scanned") {
              setQrStatus("scanned");
              setFeedback("已扫码，请在手机上点击确认登录。");
              return; // 已扫码待确认：不要换新二维码
            } else if (result?.status === "expired") {
              stopPolling();
              if (autoRefreshCountRef.current < 6) {
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
              setFeedback(result.message || "登录被哔哩哔哩风控拦截，请稍后再试。");
              return;
            } else if (result?.status === "waiting") {
              setQrStatus("waiting");
            }
            // 主动换新:哔哩二维码约2分钟失效,每75秒自动换一张。
            if (Date.now() - startedAtRef.current > 75_000 && autoRefreshCountRef.current < 6) {
              autoRefreshCountRef.current += 1;
              setFeedback("已为你换上新鲜二维码,请扫当前这张。");
              void startLogin();
            }
          } catch (caught) {
            if (caught?.code === "bilibili_qr_session_expired") {
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
  }, [stopPolling]);

  const cancelLogin = useCallback(() => {
    stopPolling();
    setQrOpen(false);
    setQrContent("");
    setQrStatus("idle");
    setFeedback("");
  }, [stopPolling]);

  // 内置浏览器登录：扫码不方便或二维码无反应时，用内置浏览器打开 B 站网页，
  // 登录一次后点"提取登录态"，Cookie 直接保存给 AI 使用。
  const connectWithBrowser = useCallback(async () => {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const opened = await openBuiltInBrowser({
        url: "https://www.bilibili.com/",
        title: "哔哩哔哩（内置浏览器）",
        site: "bilibili",
      });
      if (!opened.ok) {
        setError(opened.error || "无法打开内置浏览器。");
        return;
      }
      const saved = await readBrowserCookie("bilibili");
      if (!saved.cookie) {
        setFeedback("内置浏览器已关闭，但没有提取到登录态。请重新打开、登录后在页面点「提取登录态」再返回。");
        return;
      }
      const imported = await apiRequest("/api/v2/co-watch/bilibili-qr/cookie", {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({ cookie: saved.cookie }),
      }).catch(() => null);
      if (imported?.connection?.connected === true || imported?.connected === true) {
        settledRef.current = true;
        setConnection(imported.connection || null);
        setNickname(imported.connection?.nickname || "");
        setFaceUrl(imported.connection?.face_url || "");
        setFeedback("内置浏览器登录成功，登录态已保存，可以读取收藏夹了。");
      } else {
        setError(imported?.message || "登录态已提取，但保存失败，请重试。");
      }
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectBilibiliQrLogin();
      settledRef.current = false;
      setConnection(null);
      setNickname("");
      setFaceUrl("");
      setFolders([]);
      setFolderVideos([]);
      setFolderTitle("");
      setFeedback("已退出哔哩哔哩登录。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const rows = await listBilibiliFavoriteFolders();
      setFolders(rows);
      setFeedback(rows.length ? `共读取到 ${rows.length} 个收藏夹。` : "没有读取到收藏夹。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadFolderVideos = useCallback(async (folder) => {
    setVideoBusy(folder.media_id);
    setError("");
    try {
      const rows = await listBilibiliFavoriteVideos(folder.media_id, 1);
      setFolderVideos(rows);
      setFolderTitle(folder.title);
      setFeedback(rows.length ? `“${folder.title}”前 20 个视频已载入。` : "这个收藏夹没有可读取的视频。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setVideoBusy("");
    }
  }, []);

  const qrStatusText = {
    idle: "点击“扫码登录”开始。",
    waiting: "请用手机哔哩哔哩 App 扫描二维码。",
    scanned: "已扫码，请在手机上点击确认登录。",
    confirmed: "登录成功。",
    expired: "二维码已过期，请重新生成。",
    risk_blocked: "登录被风控拦截，请稍后再试。",
    error: "登录失败，请重试。",
  }[qrStatus] || "";

  return <div className="bilibili-qr-login">
    <div className="music-provider-connect-body">
      {connection ? <div className="netease-qr-connected" role="status">
        {faceUrl ? <img className="bilibili-avatar" src={faceUrl} alt="" /> : <Smartphone aria-hidden="true" />}
        <span>已登录哔哩哔哩：<strong>{nickname || "哔哩用户"}</strong></span>
        <button type="button" disabled={busy} onClick={() => void loadFolders()}>读取收藏夹</button>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "处理中…" : "退出登录"}</button>
      </div> : <div className="netease-qr-disconnected">
        <p>用手机哔哩哔哩 App 扫码登录后，DengTa 可以读取你的收藏夹，并把收藏的视频一键载入网页一起看。密码不会经过 DengTa，登录凭据加密保存在你的账号下。</p>
        <button type="button" className="together-primary" disabled={busy} onClick={() => void startLogin()}><LogIn aria-hidden="true" />{busy ? "正在生成…" : "扫码登录哔哩哔哩"}</button>
        <button type="button" disabled={busy} onClick={() => void connectWithBrowser()} title="用内置浏览器打开 B 站网页登录，登录后点页面上的「提取登录态」">
          内置浏览器登录（登录态长期有效）
        </button>
      </div>}
      {qrOpen && createPortal(<div className="netease-qr-modal" role="dialog" aria-label="哔哩哔哩扫码登录">
        <div className="netease-qr-card">
          <strong>用手机哔哩哔哩 App 扫码</strong>
          <canvas ref={canvasRef} aria-label="登录二维码" />
          <p>{qrStatusText}</p>
          <small className="netease-qr-hint">二维码过期后会自动刷新，无需手动操作。</small>
          <div className="netease-qr-actions">
            <button type="button" disabled={busy} onClick={() => void startLogin()}><RefreshCw aria-hidden="true" />重新生成</button>
            <button type="button" onClick={cancelLogin}>取消</button>
          </div>
          <small className="netease-qr-hint">
            推荐:用你手机上的哔哩哔哩 App 扫上面的码,App 里点确认即完成(凭证自动回到灯塔)。
            不想扫码的话,点下面按钮,在打开的网页里直接用账号密码或验证码登录——登录成功后本页会自动完成绑定,无需跳转任何 App。
          </small>
          {qrContent && (
            <a
              className="netease-qr-fallback-button"
              href={qrContent}
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 改用网页账号密码登录
            </a>
          )}
        </div>
      </div>, document.body)}
      {folders.length > 0 && <div className="netease-qr-playlists">
        <strong>我的收藏夹（点击查看视频）</strong>
        <ul>{folders.map((folder) => <li key={folder.media_id}>
          <button type="button" disabled={videoBusy === folder.media_id} onClick={() => void loadFolderVideos(folder)}>
            {folder.title} · {folder.media_count} 个
            {videoBusy === folder.media_id ? " 正在读取…" : ""}
          </button>
        </li>)}</ul>
      </div>}
      {folderVideos.length > 0 && <div className="netease-qr-playlists">
        <strong>{folderTitle || "收藏视频"}（点击载入一起看）</strong>
        <ul>{folderVideos.map((video) => <li key={video.bvid}>
          <button type="button" onClick={() => void onPickVideo(video.page_url, video.title)}>
            {video.title || video.bvid}
          </button>
        </li>)}</ul>
      </div>}
      {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
      {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
    </div>
  </div>;
}
