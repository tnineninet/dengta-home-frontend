import { useEffect, useRef, useState } from "react";
import { DlnaReceiver } from "./dlna-receiver";
import { apiFetch, API_BASE_URL } from "./api.js";
import {
  createCoWatchSession,
  readActiveCoWatchSession,
  sendCoWatchReply,
} from "./co-watch";
import {
  createWatchRoom,
  joinWatchRoom,
  readWatchRoom,
  sendRoomMessage,
  sendRoomAiMessage,
  readRoomMessages,
  subscribeRoomEvents,
  leaveWatchRoom,
  endWatchRoom,
} from "./watch-room";

/**
 * 投屏放映厅（DengTa 一起看）。
 *
 * 职责：
 * 1. 接收 DLNA 投屏 / 粘贴网页链接 → 启动原生 ExoPlayer 播放
 * 2. 原生播放器聊天输入 → castChat 事件 → 已鉴权的 co-watch AI 回复 API → showCastReply 回原生
 * 3. 原生播放器周期截帧 → castFrame 事件 → /frame AI 理解接口 → showCastReaction 回原生
 * 4. 放映厅状态：票根、电影详情、观看归属
 */
export default function DlnaCastPlayer({ info, userName = "你", aiName = "伴侣", onClose }) {
  const [waiting, setWaiting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [dialog, setDialog] = useState([]);
  // 放映厅（多人联机一起看）
  const [room, setRoom] = useState(null);          // room 对象（含 joinCode）
  const [participants, setParticipants] = useState([]);
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const roomRef = useRef(null);
  const roomMessagesRef = useRef([]);
  const launchedRef = useRef("");
  const sessionRef = useRef("");

  const mediaUrl = info?.uri || info?.mediaUrl || "";
  const title = info?.title || "投屏播放";
  const durationSeconds = Number(info?.durationSeconds || info?.duration || 0);
  const cover = info?.cover || info?.thumb || "";
  const sourceApp = info?.sourceApp || "DLNA 投屏";

  /* ---------------- 异步会话（只有第一次消息/帧才真正创建，避免空会话） ---------------- */

  const ensureSession = async () => {
    if (sessionRef.current) return sessionRef.current;
    try {
      const existing = await readActiveCoWatchSession({});
      if (existing?.id) {
        sessionRef.current = existing.id;
        setSessionId(existing.id);
        return existing.id;
      }
      const created = await createCoWatchSession({
        title,
        sourceApp,
        sessionMode: "screen",
        mediaDurationSeconds: durationSeconds,
        mediaPositionSeconds: 0,
      });
      if (!created?.id) throw new Error("no_session");
      sessionRef.current = created.id;
      setSessionId(created.id);
      return created.id;
    } catch (error) {
      // 会话创建失败时仍返回空串，由调用方优雅降级
      return "";
    }
  };

  /* ---------------- 原生 → Web：聊天消息（真实 AI 回复） ---------------- */

  const base64ToBytes = (base64) => {
    const binary = globalThis.atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };

  const handleCastChat = async (event) => {
    const text = String(event?.text || "").trim();
    if (!text) return;
    const positionMs = Number(event?.positionMs) || 0;
    // 转发到放映厅群聊（远程用户也能看到）
    forwardToRoom(text, Math.round(positionMs / 1000));
    try {
      const session = await ensureSession();
      if (!session) throw new Error("no_session");
      const reply = await sendCoWatchReply(session, text, Math.round(positionMs / 1000));
      const replyText = reply?.reaction || "\u6CA1\u6709\u83B7\u5F97\u56DE\u590D\u3002";
      DlnaReceiver.showCastReply({
        text: replyText,
        aiName: String(event?.aiName || aiName || "伴侣"),
      }).catch(() => {});
      // AI 回复也进入放映厅群聊（带归属：发送者=本用户 AI 名）→ 远程成员实时可见
      if (roomRef.current?.id && replyText) {
        const roomId = roomRef.current.id;
        sendRoomAiMessage(
          roomId,
          replyText,
          Math.round(positionMs / 1000),
          String(event?.aiName || aiName || "伴侣"),
        ).catch(() => {});
      }
    } catch (error) {
      // 会话/网络不可用：不造假回复，只提示回到主界面
      DlnaReceiver.showCastReply({
        text: "\u6682\u65F6\u8FDE\u4E0D\u4E0A\u6211\uFF0C\u56DE\u5230\u4E3B\u754C\u9762\u6211\u4EEC\u518D\u804A\uFF5E",
        aiName: String(event?.aiName || aiName || "伴侣"),
      }).catch(() => {});
    }
  };

  /* ---------------- 原生 → Web：视频帧（AI 主动互动） ---------------- */

  const handleCastFrame = async (event) => {
    const base64 = String(event?.frameBase64 || "");
    if (!base64) return;
    try {
      const session = await ensureSession();
      if (!session) return;
      const bytes = base64ToBytes(base64);
      const capturedAt = new Date().toISOString();
      const query = new URLSearchParams({
        session_id: session,
        mode: "screen",
        epoch: "cast-renderer",
        sequence: String(Date.now()),
        captured_at: capturedAt,
      });
      const response = await apiFetch(`/api/v2/co-watch/frame?${query.toString()}`, {
        method: "POST",
        timeoutMs: 90_000,
        headers: { "Content-Type": "image/jpeg" },
        body: bytes,
        retry: false,
      });
      const data = await response.json().catch(() => ({}));
      const reaction = String(data?.reaction || "").trim();
      if (reaction) {
        DlnaReceiver.showCastReaction({
          text: reaction,
          aiName: String(data?.ai_name || aiName || "伴侣"),
        }).catch(() => {});
        // 同时飘一条弹幕
        DlnaReceiver.showCastDanmaku({
          text: reaction,
          senderName: String(data?.ai_name || aiName || "伴侣"),
          colorHex: "#FFD9A8",
        }).catch(() => {});
      }
    } catch (error) {
      // 帧理解失败时静默，等待下一个周期
    }
  };

  /* ---------------- 放映厅：创建 / 加入 / 离开 ---------------- */

  const syncRoomData = async (roomId) => {
    if (!roomId) return;
    const data = await readWatchRoom(roomId).catch(() => null);
    if (data?.room) {
      setRoom(data.room);
      roomRef.current = data.room;
    }
    if (Array.isArray(data?.participants)) {
      setParticipants(data.participants);
    }
    const messages = await readRoomMessages(roomId, 50).catch(() => []);
    setRoomMessages(messages);
    roomMessagesRef.current = messages;
  };

  const handleCreateRoom = async () => {
    if (roomBusy || roomRef.current) return;
    setRoomBusy(true);
    setRoomError("");
    try {
      const created = await createWatchRoom({
        title,
        sourceApp,
        mediaUrl,
        mediaDurationSeconds: durationSeconds,
        displayName: userName,
        aiName,
        session_id: sessionRef.current || undefined,
      });
      if (!created?.id) throw new Error("no_room");
      setRoom(created);
      roomRef.current = created;
      await syncRoomData(created.id);
    } catch (error) {
      setRoomError("创建放映厅失败，请稍后再试。");
    } finally {
      setRoomBusy(false);
    }
  };

  const handleJoinRoom = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || roomBusy || roomRef.current) return;
    setRoomBusy(true);
    setRoomError("");
    try {
      const joined = await joinWatchRoom(code, {
        displayName: userName,
        aiName,
      });
      if (!joined?.id) throw new Error("join_failed");
      setRoom(joined);
      roomRef.current = joined;
      await syncRoomData(joined.id);
      // 发起方已分享媒体 → 自动拉起本地播放器
      if (joined.mediaUrl && joined.mediaUrl !== mediaUrl) {
        DlnaReceiver.launchPlayer({
          uri: joined.mediaUrl,
          title: joined.title || title,
          userName,
          aiName,
        }).catch(() => {});
      }
    } catch (error) {
      setRoomError("加入失败：邀请码可能无效或放映厅已结束。");
    } finally {
      setRoomBusy(false);
    }
  };

  const handleLeaveRoom = async () => {
    const current = roomRef.current;
    if (!current) return;
    try {
      await leaveWatchRoom(current.id);
    } catch (_) {}
    roomRef.current = null;
    setRoom(null);
    setParticipants([]);
    setRoomMessages([]);
  };

  /* ---------------- 放映厅：SSE 实时事件 ---------------- */

  useEffect(() => {
    const current = roomRef.current;
    if (!current?.id) return undefined;
    const stop = subscribeRoomEvents(current.id, {
      onPlaybackSync: (updatedRoom) => {
        setRoom((prev) => ({ ...(prev || {}), ...updatedRoom }));
        roomRef.current = { ...(roomRef.current || {}), ...updatedRoom };
      },
      onMessage: (msg) => {
        // 远程消息 → 以弹幕形式飘过播放画面
        const prefix = `${msg.senderName}：`;
        DlnaReceiver.showCastDanmaku({
          text: String(msg.content || "").slice(0, 40),
          senderName: msg.senderName || "成员",
          colorHex: msg.senderType === "ai" ? "#FFD9A8" : "#8BD8FF",
        }).catch(() => {});
        const next = [...roomMessagesRef.current, msg];
        if (next.length > 100) next.splice(0, next.length - 100);
        roomMessagesRef.current = next;
        setRoomMessages(next);
      },
      onParticipantJoin: (info) => {
        setParticipants((prev) => [...prev, {
          displayName: info.displayName || "新成员",
          aiName: "",
          role: "member",
          joinedAt: new Date().toISOString(),
        }]);
      },
      onParticipantLeave: () => {
        syncRoomData(current.id).catch(() => {});
      },
      onRoomEnded: () => {
        roomRef.current = null;
        setRoom(null);
        setParticipants([]);
      },
      onError: () => {},
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  // 在聊天/帧处理中把消息转发到放映厅群聊（远程用户可见）
  const forwardToRoom = async (text, positionSeconds) => {
    const current = roomRef.current;
    if (!current?.id || !text) return;
    try {
      await sendRoomMessage(current.id, text, positionSeconds);
    } catch (_) {}
  };

  /* ---------------- 生命周期监听 ---------------- */

  useEffect(() => {
    let chatHandle = null;
    let frameHandle = null;
    DlnaReceiver.addListener("castChat", async (event) => {
      try {
        await handleCastChat(event);
      } catch (_) {}
    })
      .then((listener) => {
        chatHandle = listener;
      })
      .catch(() => {});
    DlnaReceiver.addListener("castFrame", async (event) => {
      try {
        await handleCastFrame(event);
      } catch (_) {}
    })
      .then((listener) => {
        frameHandle = listener;
      })
      .catch(() => {});
    return () => {
      chatHandle?.remove?.();
      frameHandle?.remove?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 播放 ---------------- */

  async function handleClose() {
    try {
      await DlnaReceiver.stopPlayback();
    } catch (_) {}
    onClose?.();
  }

  // 新媒体到来时自动拉起原生播放器
  useEffect(() => {
    if (!mediaUrl) {
      setLaunching(false);
      return undefined;
    }
    if (launchedRef.current === mediaUrl) return undefined;
    launchedRef.current = mediaUrl;

    setWaiting(false);
    setLaunching(true);
    DlnaReceiver.launchPlayer({ uri: mediaUrl, title, userName, aiName })
      .then(() => setLaunching(false))
      .catch(() => {
        setLaunching(false);
        setWaiting(true);
      });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, title]);

  // 回到本页面显示等待
  useEffect(() => {
    const onFocus = () => {
      if (!mediaUrl) setWaiting(true);
    };
    globalThis.addEventListener?.("focus", onFocus);
    return () => globalThis.removeEventListener?.("focus", onFocus);
  }, [mediaUrl]);

  async function handleExtract() {
    const url = urlInput.trim();
    if (!url) return;
    setExtracting(true);
    try {
      // 尝试通过 Capacitor 插件（原生 WebView 提取）
      const { VideoExtractor } = await import("./video-extractor").catch(() => ({ VideoExtractor: null }));
      if (VideoExtractor) {
        await VideoExtractor.extractVideo({ url, title: url });
      } else {
        // 非原生环境：直接尝试播放 URL（可能本身就是视频直链）
        await DlnaReceiver.launchPlayer({ uri: url, title: url, userName, aiName });
      }
    } catch (_) {
      // 降级：尝试直接播放
      try {
        await DlnaReceiver.launchPlayer({ uri: url, title: url, userName, aiName });
      } catch (e) {
        setWaiting(true);
      }
    }
    setExtracting(false);
  }

  // 仅 DLNA 等待模式（无 URL 输入时）
  const showWaitingOnly = !mediaUrl && !waiting && !launching && !extracting;

  if (showWaitingOnly) {
    return (
      <div className="dlna-cast-player">
        <header className="dlna-cast-header">
          <svg className="dlna-cast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 16v2a4 4 0 0 1 4 4h2" />
            <path d="M2 12v2a8 8 0 0 1 8 8h2" />
            <path d="M2 8v2a12 12 0 0 1 12 12h2" />
            <path d="M22 2H6a2 2 0 0 0-2 2v6" />
            <path d="M22 14h-6l-2 3h-2" />
            <path d="M22 22h-2" />
          </svg>
          <div className="dlna-cast-badge">放映厅</div>
        </header>

        <div className="dlna-cast-stage">
          <div className="dlna-cast-section">
            <h3>📡 等待投屏</h3>
            <p>在 B站 等视频 App 中点击投屏，选择「灯塔」。</p>
          </div>

          <div className="dlna-cast-divider"><span>或者</span></div>
          <div className="dlna-cast-divider"><span>多人放映厅</span></div>

          <div className="dlna-cast-section">
            {!roomRef.current ? (
              <>
                <div className="dlna-room-actions">
                  <button
                    type="button"
                    className="dlna-cast-extract-btn dlna-room-create"
                    onClick={handleCreateRoom}
                    disabled={roomBusy || !mediaUrl}
                    title={!mediaUrl ? "需要先有播放内容（投屏或粘贴链接）才能开厅" : undefined}
                  >
                    {roomBusy ? "创建中…" : "🎬 创建放映厅（邀请好友一起看）"}
                  </button>
                  {!mediaUrl && (
                    <p className="dlna-cast-hint">先在上方投屏或粘贴视频链接，才能创建放映厅</p>
                  )}
                </div>
                <div className="dlna-room-join">
                  <input
                    className="dlna-cast-url-input"
                    type="text"
                    maxLength={20}
                    placeholder="输入邀请码加入好友放映厅…"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                  />
                  <button
                    type="button"
                    className="dlna-cast-extract-btn"
                    onClick={handleJoinRoom}
                    disabled={roomBusy || !joinCodeInput.trim()}
                  >
                    {roomBusy ? "加入中…" : "加入"}
                  </button>
                </div>
                {roomError && <p className="dlna-room-error">{roomError}</p>}
              </>
            ) : (
              <div className="dlna-room-panel">
                <div className="dlna-room-code-label">邀请码</div>
                <div className="dlna-room-code">{room.joinCode}</div>
                <p className="dlna-cast-hint">
                  把邀请码发给下载了灯塔 App 的好友（最多 {room.maxParticipants || 50} 人），
                  大家在同一个放映厅一起看。
                </p>
                <button type="button" className="dlna-cast-close" onClick={handleLeaveRoom}>
                  退出放映厅
                </button>
              </div>
            )}
          </div>
        </div>

        {onClose && (
          <footer className="dlna-cast-footer">
            <button type="button" className="dlna-cast-close" onClick={handleClose}>关闭</button>
          </footer>
        )}
      </div>
    );
  }

  // 有媒体/提取中/等待状态（放映厅）
  return (
    <div className="dlna-cast-player">
      <header className="dlna-cast-header">
        <svg className="dlna-cast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 16v2a4 4 0 0 1 4 4h2" />
          <path d="M2 12v2a8 8 0 0 1 8 8h2" />
          <path d="M2 8v2a12 12 0 0 1 12 12h2" />
          <path d="M22 2H6a2 2 0 0 0-2 2v6" />
          <path d="M22 14h-6l-2 3h-2" />
          <path d="M22 22h-2" />
        </svg>
        <div className="dlna-cast-badge">
          {extracting ? "提取中" : launching ? "启动播放器" : waiting ? "等待投屏" : "放映中"}
        </div>
        <h2 className="dlna-cast-title">{title}</h2>
        {roomRef.current && (
          <span className="dlna-room-badge-code" title="邀请码">{roomRef.current.joinCode}</span>
        )}
        {onClose && (
          <button type="button" className="dlna-cast-close" onClick={handleClose}>
            结束放映
          </button>
        )}
      </header>

      <div className="dlna-cast-stage">
        {extracting ? (
          <div className="dlna-cast-waiting">
            <p>正在提取视频流…</p>
            <p className="dlna-cast-waiting-hint">WebView 加载页面中，请稍候</p>
          </div>
        ) : launching ? (
          <div className="dlna-cast-waiting">
            <p>正在启动原生播放器…</p>
            <p className="dlna-cast-waiting-hint">请稍候</p>
          </div>
        ) : waiting ? (
          <div className="dlna-cast-waiting">
            <p>请在 B站 等视频 App 中点击投屏。</p>
            <p className="dlna-cast-waiting-hint">或粘贴视频链接</p>
            <div className="dlna-cast-url-row" style={{ marginTop: 16 }}>
              <input
                className="dlna-cast-url-input"
                type="url"
                placeholder="粘贴视频地址…"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExtract()}
              />
              <button
                className="dlna-cast-extract-btn"
                type="button"
                onClick={handleExtract}
                disabled={extracting || !urlInput.trim()}
              >
                {extracting ? "提取中…" : "提取"}
              </button>
            </div>
          </div>
        ) : (
          <div className="dlna-cast-playing">
            {/* 票根 */}
            <div className="dlna-ticket">
              <div className="dlna-ticket-notch" />
              <div className="dlna-ticket-head">
                <span className="dlna-ticket-brand">DENGTA 放映厅 · 入场票</span>
                <span className="dlna-ticket-no">
                  {sessionId ? `NO.${sessionId.slice(0, 8).toUpperCase()}` : "NO.----"}
                </span>
              </div>
              <div className="dlna-ticket-title">{title}</div>
              <div className="dlna-ticket-meta">
                <span>{sourceApp}</span>
                <span>{durationSeconds ? formatDuration(durationSeconds) : ""}</span>
                <span>{userName} · {aiName}</span>
              </div>
              <div className="dlna-ticket-row">
                <span>场次：DengTa 放映厅</span>
                <span>座位：{userName}</span>
              </div>
              {cover && (
                <img className="dlna-ticket-cover" src={cover} alt="" />
              )}
            </div>

            {/* 电影详情 */}
            <dl className="dlna-movie-details">
              <dt>片名</dt><dd>{title}</dd>
              {durationSeconds > 0 && (
                <>
                  <dt>时长</dt><dd>{formatDuration(durationSeconds)}</dd>
                </>
              )}
              <dt>来源</dt><dd>{sourceApp}</dd>
              <dt>AI 陪看</dt><dd>{aiName}</dd>
            </dl>

            <p className="dlna-cast-waiting-hint">
              正在原生播放器中放映。在播放器下方输入消息，{aiName} 会结合剧情回复你；
              放映途中 {aiName} 还会主动聊聊看到的画面。
            </p>
          </div>
        )}
      </div>

      <footer className="dlna-cast-footer">
        <div className="dlna-cast-track" />
        <div className="dlna-cast-times">
          <span>正在播放</span>
          <span>{title}</span>
        </div>
      </footer>
    </div>
  );
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}