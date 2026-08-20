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
import { peekPendingInvite, clearPendingInvite, fetchRoomInviteInfo } from "./room-invite";
import "./cast-player.css";

/** 帧理解失败日志节流：60 秒内最多输出一次 */
let _lastFrameWarnTs = 0;

/**
 * B站放映厅风格 — 投屏/一起看播放器。
 * 窄屏（手机）→ 播放确认页；宽屏（桌面/平板）→ 完整播放器+聊天+AI分析。
 */
export default function DlnaCastPlayer({ info, userName = "你", aiName = "伴侣", onClose }) {
  const [waiting, setWaiting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [dialog, setDialog] = useState([]);
  // 放映厅
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [roomMessages, setRoomMessages] = useState([]);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const roomRef = useRef(null);
  const roomMessagesRef = useRef([]);
  const participantsRef = useRef([]);
  const launchedRef = useRef("");
  const sessionRef = useRef("");

  // 邀请弹窗
  const [inviteCode, setInviteCode] = useState("");
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");

  // 视图切换：confirmation（播放确认）→ player（播放中）
  const [viewMode, setViewMode] = useState("confirmation");
  // 播放器控制
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState("00:00");
  const [totalTime, setTotalTime] = useState("00:00");
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const danmakuEnabledRef = useRef(true);
  useEffect(() => { danmakuEnabledRef.current = danmakuEnabled; }, [danmakuEnabled]);
  const [chatInput, setChatInput] = useState("");
  // AI 分析状态
  const [analysisState, setAnalysisState] = useState("loading"); // loading | progress | degraded | error | complete | never
  // 聊天消息
  const [messages, setMessages] = useState([]);

  // 播放器控制自动隐藏
  const controlTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const speedOptions = [0.5, 1.0, 1.5, 2.0];
  const speedIndexRef = useRef(1);

  /* ─── 构建双高亮名 ─── */
  const buildAttributedName = (participant, senderType) => {
    const dn = participant?.displayName || userName;
    const an = participant?.aiName || aiName;
    const userActive = senderType === "user";
    return { displayName: dn, aiName: an, userActive, full: `${dn}&${an}` };
  };

  /* ─── 分享邀请 ─── */
  const shareRoomInvite = async () => {
    const current = roomRef.current;
    if (!current?.joinCode) return;
    const code = current.joinCode;
    // 获取自己的显示ID
    let displayId = "";
    try {
      const resp = await apiFetch("/api/v2/co-watch/display-id", { timeoutMs: 5000 }).catch(() => null);
      if (resp) {
        const data = await resp.json().catch(() => ({}));
        displayId = data?.display_id || "";
      }
    } catch (_) {}
    const webLink = `https://dengtahome.com/room/join?room_code=${code}${displayId ? `&host_id=${displayId}` : ""}`;
    const text = `🎬 ${userName} 邀请您和您的伴侣（${aiName}）一起观影《${current.title || "影片"}》！\n\n加入放映厅：${webLink}\n邀请码：${code}`;
    try {
      if (navigator.share && navigator.canShare?.({ text })) {
        await navigator.share({ title: "灯塔放映厅邀请", text, url: webLink });
      } else {
        await navigator.clipboard.writeText(text);
        setRoomError("已复制邀请链接");
        setTimeout(() => setRoomError(""), 3000);
      }
    } catch (_) {}
  };

  /* ─── 检查待处理邀请 ─── */
  useEffect(() => {
    const pending = peekPendingInvite();
    if (!pending?.code) return;
    setInviteCode(pending.code);
    setInviteBusy(true);
    setInviteError("");
    setInviteInfo(null);
    fetchRoomInviteInfo(pending.code)
      .then((info) => { setInviteInfo(info); setInviteBusy(false); })
      .catch(() => { setInviteError("邀请信息读取失败，邀请码可能已过期。"); setInviteBusy(false); });
  }, []);

  /* ─── 接受/拒绝邀请 ─── */
  const handleAcceptInvite = async () => {
    if (!inviteCode || inviteBusy) return;
    setInviteBusy(true);
    setInviteError("");
    try {
      const joined = await joinWatchRoom(inviteCode, { displayName: userName, aiName });
      if (!joined?.id) throw new Error("join_failed");
      setRoom(joined);
      roomRef.current = joined;
      setInviteCode("");
      setInviteInfo(null);
      clearPendingInvite();
      await syncRoomData(joined.id);
      if (joined.mediaUrl) {
        DlnaReceiver.launchPlayer({ uri: joined.mediaUrl, title: joined.title || title, userName, aiName }).catch(() => {});
      }
    } catch (error) {
      setInviteError("加入失败，邀请码可能已过期或放映厅已结束。");
    } finally { setInviteBusy(false); }
  };
  const handleDeclineInvite = () => {
    setInviteCode("");
    setInviteInfo(null);
    setInviteError("");
    clearPendingInvite();
  };

  const mediaUrl = info?.uri || info?.mediaUrl || "";
  const title = info?.title || "投屏播放";
  const durationSeconds = Number(info?.durationSeconds || info?.duration || 0);
  const cover = info?.cover || info?.thumb || "";
  const sourceApp = info?.sourceApp || "DLNA 投屏";

  /* ─── 异步会话 ─── */
  const ensureSession = async () => {
    if (sessionRef.current) return sessionRef.current;
    try {
      const existing = await readActiveCoWatchSession({ sessionMode: "screen" });
      if (existing?.id) { sessionRef.current = existing.id; setSessionId(existing.id); return existing.id; }
      const created = await createCoWatchSession({ title, sourceApp, sessionMode: "screen", mediaDurationSeconds: durationSeconds, mediaPositionSeconds: 0 });
      if (!created?.id) throw new Error("no_session");
      sessionRef.current = created.id;
      setSessionId(created.id);
      return created.id;
    } catch (_) { return ""; }
  };

  /* ─── 原生聊天消息 ─── */
  const base64ToBytes = (base64) => {
    const binary = globalThis.atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const forwardToRoom = async (text, positionSeconds) => {
    const current = roomRef.current;
    if (!current?.id || !text) return;
    try { await sendRoomMessage(current.id, text, positionSeconds); } catch (_) {}
  };

  const handleCastChat = async (event) => {
    const text = String(event?.text || "").trim();
    if (!text) return;
    const positionMs = Number(event?.positionMs) || 0;
    forwardToRoom(text, Math.round(positionMs / 1000));
    try {
      const session = await ensureSession();
      if (!session) throw new Error("no_session");
      const reply = await sendCoWatchReply(session, text, Math.round(positionMs / 1000));
      const replyText = reply?.reaction || "没有获得回复。";
      DlnaReceiver.showCastReply({ text: replyText, aiName: String(event?.aiName || aiName || "伴侣") }).catch(() => {});
      if (roomRef.current?.id && replyText) {
        sendRoomAiMessage(roomRef.current.id, replyText, Math.round(positionMs / 1000), String(event?.aiName || aiName || "伴侣")).catch(() => {});
      }
    } catch (_) {
      DlnaReceiver.showCastReply({ text: "回复获取失败，请稍后再试。", aiName: String(event?.aiName || aiName || "伴侣") }).catch(() => {});
    }
  };

  /* ─── 视频帧（AI 主动互动） ─── */
  const handleCastFrame = async (event) => {
    const base64 = String(event?.frameBase64 || "");
    if (!base64) return;
    try {
      const session = await ensureSession();
      if (!session) return;
      const bytes = base64ToBytes(base64);
      const capturedAt = new Date().toISOString();
      const query = new URLSearchParams({ session_id: session, mode: "screen", epoch: "cast-renderer", sequence: String(Date.now()), captured_at: capturedAt });
      const response = await apiFetch(`/api/v2/co-watch/frame?${query.toString()}`, { method: "POST", timeoutMs: 90_000, headers: { "Content-Type": "image/jpeg" }, body: bytes, retry: false });
      const data = await response.json().catch(() => ({}));
      const reaction = String(data?.reaction || "").trim();
      if (reaction) {
        DlnaReceiver.showCastReaction({ text: reaction, aiName: String(data?.ai_name || aiName || "伴侣") }).catch(() => {});
        DlnaReceiver.showCastDanmaku({ text: reaction, senderName: String(data?.ai_name || aiName || "伴侣"), colorHex: "#FFD9A8" }).catch(() => {});
        // 添加到聊天
        addMessage("ai", reaction, String(data?.ai_name || aiName || "伴侣"));
      }
    } catch (error) {
      const now = Date.now();
      if (now - _lastFrameWarnTs > 60_000) { _lastFrameWarnTs = now; console.warn("[DlnaCastPlayer] handleCastFrame failed:", error?.message || error); }
    }
  };

  /* ─── 聊天消息管理 ─── */
  const addMessage = (type, content, sender) => {
    setMessages((prev) => {
      const next = [...prev, { type, content, sender, id: Date.now() + Math.random() }];
      if (next.length > 100) next.splice(0, next.length - 100);
      return next;
    });
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  /* ─── 发送聊天消息 ─── */
  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    addMessage("user", text, userName);
    setChatInput("");
    // 转发到原生和放映厅
    DlnaReceiver.sendChatMessage({ text, positionMs: 0 }).catch(() => {});
    forwardToRoom(text, 0);
    // 模拟AI回复（真实回复由原生回调触发）
    setAnalysisState("loading");
  };

  /* ─── 放映厅同步 ─── */
  const syncRoomData = async (roomId) => {
    if (!roomId) return;
    const data = await readWatchRoom(roomId).catch(() => null);
    if (data?.room) { setRoom(data.room); roomRef.current = data.room; }
    if (Array.isArray(data?.participants)) { setParticipants(data.participants); participantsRef.current = data.participants; }
    const msgs = await readRoomMessages(roomId, 50).catch(() => []);
    setRoomMessages(msgs);
    roomMessagesRef.current = msgs;
  };

  const handleCreateRoom = async () => {
    if (roomBusy || roomRef.current) return;
    setRoomBusy(true);
    setRoomError("");
    try {
      const created = await createWatchRoom({ title, sourceApp, mediaUrl, mediaDurationSeconds: durationSeconds, displayName: userName, aiName, session_id: sessionRef.current || undefined });
      if (!created?.id) throw new Error("no_room");
      setRoom(created);
      roomRef.current = created;
      await syncRoomData(created.id);
    } catch (_) { setRoomError("创建放映厅失败，请稍后再试。"); } finally { setRoomBusy(false); }
  };

  const handleJoinRoom = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || roomBusy || roomRef.current) return;
    setRoomBusy(true);
    setRoomError("");
    try {
      const joined = await joinWatchRoom(code, { displayName: userName, aiName });
      if (!joined?.id) throw new Error("join_failed");
      setRoom(joined);
      roomRef.current = joined;
      await syncRoomData(joined.id);
      if (joined.mediaUrl && joined.mediaUrl !== mediaUrl) {
        DlnaReceiver.launchPlayer({ uri: joined.mediaUrl, title: joined.title || title, userName, aiName }).catch(() => {});
      }
    } catch (_) { setRoomError("加入失败：邀请码可能无效或放映厅已结束。"); } finally { setRoomBusy(false); }
  };

  const handleLeaveRoom = async () => {
    const current = roomRef.current;
    if (!current) return;
    try { await leaveWatchRoom(current.id); } catch (_) {}
    roomRef.current = null;
    setRoom(null);
    setParticipants([]);
    setRoomMessages([]);
  };

  /* ─── SSE 实时事件 ─── */
  useEffect(() => {
    const onInvite = () => {
      const code = peekPendingInvite();
      if (code && code !== inviteCode) {
        setInviteCode(code);
        setInviteError("");
        setInviteInfo(null);
        fetchRoomInviteInfo(code)
          .then((info) => { setInviteInfo(info); setInviteError(""); })
          .catch((e) => { setInviteInfo(null); setInviteError(e.message || "获取邀请信息失败"); });
      }
    };
    window.addEventListener("dengta:room-invite", onInvite);

    const current = roomRef.current;
    if (!current?.id) { return () => window.removeEventListener("dengta:room-invite", onInvite); }
    const stop = subscribeRoomEvents(current.id, {
      onPlaybackSync: (updatedRoom) => {
        setRoom((prev) => ({ ...(prev || {}), ...updatedRoom }));
        roomRef.current = { ...(roomRef.current || {}), ...updatedRoom };
      },
      onMessage: (msg) => {
        const latest = participantsRef.current;
        const participant = (latest || []).find((p) => p.displayName === msg.senderName || (msg.senderUserId && p.userId === msg.senderUserId));
        const attr = participant ? buildAttributedName(participant, msg.senderType) : { displayName: msg.senderName, aiName: "", userActive: msg.senderType === "user", full: msg.senderName || "成员" };
        // 弹幕：只文字，不显示来源（用户已开启弹幕时）
        if (danmakuEnabledRef.current) {
          DlnaReceiver.showCastDanmaku({ text: String(msg.content || "").slice(0, 40), colorHex: msg.senderType === "ai" ? "#FFD9A8" : "#8BD8FF" }).catch(() => {});
        }
        const next = [...roomMessagesRef.current, msg];
        if (next.length > 100) next.splice(0, next.length - 100);
        roomMessagesRef.current = next;
        setRoomMessages(next);
        addMessage(msg.senderType === "ai" ? "ai" : "user", msg.content, msg.senderName || "成员");
      },
      onParticipantJoin: (info) => {
        setParticipants((prev) => {
          const next = [...prev, { displayName: info.displayName || "新成员", aiName: info.aiName || "", role: "member", joinedAt: new Date().toISOString() }];
          participantsRef.current = next;
          return next;
        });
      },
      onParticipantLeave: () => { syncRoomData(current.id).catch(() => {}); },
      onRoomEnded: () => { roomRef.current = null; setRoom(null); setParticipants([]); participantsRef.current = []; },
      onError: (err) => { console.warn("[DlnaCastPlayer] SSE 连接错误:", err); },
    });
    return () => { stop(); window.removeEventListener("dengta:room-invite", onInvite); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  /* ─── 生命周期监听 ─── */
  useEffect(() => {
    let chatHandle = null;
    let frameHandle = null;
    DlnaReceiver.addListener("castChat", async (event) => { try { await handleCastChat(event); } catch (_) {} }).then((l) => { chatHandle = l; }).catch(() => {});
    DlnaReceiver.addListener("castFrame", async (event) => { try { await handleCastFrame(event); } catch (_) {} }).then((l) => { frameHandle = l; }).catch(() => {});
    // 监听原生消息回调
    DlnaReceiver.addListener("castReply", (event) => {
      const reply = String(event?.text || "");
      const from = String(event?.aiName || aiName);
      if (reply) addMessage("ai", reply, from);
    }).catch(() => {});
    DlnaReceiver.addListener("castReaction", (event) => {
      const reaction = String(event?.text || "");
      const from = String(event?.aiName || aiName);
      if (reaction) addMessage("ai", "🎬 " + reaction, from);
    }).catch(() => {});
    return () => {
      chatHandle?.remove?.();
      frameHandle?.remove?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── 播放控制 ─── */
  async function handleClose() {
    try { await DlnaReceiver.stopPlayback(); } catch (_) {}
    onClose?.();
  }

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
    DlnaReceiver.sendPlaybackCommand({ action: isPlaying ? "pause" : "play" }).catch(() => {});
    showControls();
  };

  const handleToggleFullscreen = () => {
    DlnaReceiver.sendPlaybackCommand({ action: "fullscreen" }).catch(() => {});
  };

  const handleScreenshot = () => {
    DlnaReceiver.captureFrame().catch(() => {});
    setAnalysisState("loading");
    setTimeout(() => setAnalysisState("progress"), 2000);
  };

  const handleCycleSpeed = () => {
    const next = (speedIndexRef.current + 1) % speedOptions.length;
    speedIndexRef.current = next;
    setPlaybackSpeed(speedOptions[next]);
    DlnaReceiver.sendPlaybackCommand({ action: "speed", value: speedOptions[next] }).catch(() => {});
    showControls();
  };

  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(controlTimerRef.current);
    controlTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  };

  // 自动播放
  useEffect(() => {
    if (!mediaUrl) { setLaunching(false); return undefined; }
    if (launchedRef.current === mediaUrl) return undefined;
    launchedRef.current = mediaUrl;
    setWaiting(false);
    setLaunching(true);
    setViewMode("player");
    DlnaReceiver.launchPlayer({ uri: mediaUrl, title, userName, aiName })
      .then(() => { setLaunching(false); setIsPlaying(true); })
      .catch(() => { setLaunching(false); setWaiting(true); });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, title]);

  useEffect(() => {
    const onFocus = () => { if (!mediaUrl) setWaiting(true); };
    globalThis.addEventListener?.("focus", onFocus);
    return () => globalThis.removeEventListener?.("focus", onFocus);
  }, [mediaUrl]);

  async function handleExtract() {
    const url = urlInput.trim();
    if (!url) return;
    setExtracting(true);
    try {
      const { VideoExtractor } = await import("./video-extractor").catch(() => ({ VideoExtractor: null }));
      if (VideoExtractor) { await VideoExtractor.extractVideo({ url, title: url }); }
      else { await DlnaReceiver.launchPlayer({ uri: url, title: url, userName, aiName }); }
    } catch (_) {
      try { await DlnaReceiver.launchPlayer({ uri: url, title: url, userName, aiName }); } catch (e) { setWaiting(true); }
    }
    setExtracting(false);
  }

  const formatTime = (sec) => {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const showWaitingOnly = !mediaUrl && !waiting && !launching && !extracting;

  /* ================================================================
     渲染：等待页（无媒体时）
     ================================================================ */
  if (showWaitingOnly) {
    return (
      <div className="cast-root">
        <div className="cast-narrow-scroll">
          {/* 邀请弹窗 */}
          {inviteCode && (inviteInfo || inviteError) && (
            <div className="cast-invite-overlay">
              <div className="cast-invite-card">
                <div className="cast-invite-icon">🎬</div>
                {inviteInfo ? (
                  <>
                    <h3 className="cast-invite-title">
                      <span className="cast-attr-user is-active">{inviteInfo.hostName || "发起人"}</span>
                      邀请您和您的伴侣（
                      <span className="cast-attr-ai is-dim">{inviteInfo.hostAiName || "伴侣"}</span>
                      ）一起观影
                    </h3>
                    <p className="cast-invite-meta">《{inviteInfo.title || "未命名内容"}》</p>
                    <p className="cast-invite-meta">👥 {inviteInfo.participantCount || 1} 人已加入 · 最多 {inviteInfo.maxParticipants || 50} 人</p>
                    <div className="cast-invite-actions">
                      <button type="button" className="cast-invite-accept" onClick={handleAcceptInvite} disabled={inviteBusy}>
                        {inviteBusy ? "加入中…" : "接受邀请"}
                      </button>
                      <button type="button" className="cast-invite-decline" onClick={handleDeclineInvite} disabled={inviteBusy}>
                        拒绝
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="cast-invite-title">邀请信息</h3>
                    {inviteError && <p className="cast-room-error">{inviteError}</p>}
                    <div className="cast-invite-actions">
                      <button type="button" className="cast-invite-decline" onClick={handleDeclineInvite}>关闭</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="cast-status-bar">
            <span />
            <span />
          </div>

          <div className="cast-nav">
            <span className="cast-nav-back" onClick={handleClose}>← 返回</span>
            <span className="cast-nav-title">放映厅</span>
            <span className="cast-nav-right">票夹</span>
          </div>

          <div className="cast-waiting">
            <div className="cast-waiting-icon">📡</div>
            <div className="cast-waiting-title">等待投屏</div>
            <div className="cast-waiting-hint">在 B站 等视频 App 中点击投屏，选择「灯塔」。</div>

            <div className="cast-waiting-url-row">
              <input className="cast-waiting-url-input" type="url" placeholder="粘贴视频地址…" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleExtract()} />
              <button className="cast-waiting-extract-btn" type="button" onClick={handleExtract} disabled={extracting || !urlInput.trim()}>
                {extracting ? "提取中…" : "提取"}
              </button>
            </div>
          </div>

          {/* 放映厅: 创建/加入 */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "0 16px" }} />
          <div className="cast-room-actions">
            {!roomRef.current ? (
              <>
                <button type="button" className="cast-room-create-btn" onClick={handleCreateRoom} disabled={roomBusy || !mediaUrl}>
                  {roomBusy ? "创建中…" : "🎬 创建放映厅"}
                </button>
                {!mediaUrl && <p className="cast-room-error" style={{ color: "#666" }}>先投屏或粘贴视频链接，才能创建放映厅</p>}
                <div className="cast-room-join-row">
                  <input className="cast-room-join-input" type="text" maxLength={20} placeholder="输入邀请码加入…" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()} />
                  <button className="cast-room-join-btn" type="button" onClick={handleJoinRoom} disabled={roomBusy || !joinCodeInput.trim()}>
                    {roomBusy ? "加入中…" : "加入"}
                  </button>
                </div>
                {roomError && <p className="cast-room-error">{roomError}</p>}
              </>
            ) : (
              <div className="cast-room-code-area">
                <div className="cast-room-code-label">邀请码</div>
                <div className="cast-room-code">{room.joinCode}</div>
                <button type="button" className="cast-room-share-btn" onClick={shareRoomInvite}>📤 分享邀请</button>
                <p style={{ color: "#666", fontSize: 12, textAlign: "center" }}>最多 {room.maxParticipants || 50} 人</p>
                <button type="button" className="cast-room-leave-btn" onClick={handleLeaveRoom}>退出放映厅</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
     渲染：播放器页（宽屏风格）
     ================================================================ */
  return (
    <div className="cast-root">
      <div className="cast-player-body">
        {/* 顶部标题 */}
        <div className="cast-player-header">
          <span className="cast-player-header-title">{title || "当前播放内容"}</span>
          <span className="cast-player-header-more" onClick={handleClose}>结束放映</span>
        </div>

        {/* 同步标签 */}
        <div className="cast-sync-label">播放已同步</div>

        {/* 视频播放器 */}
        <div className="cast-video-container">
          {/* 视频占位 */}
          <div className="cast-video-placeholder">
            {cover ? (
              <img className="cast-video-cover" src={cover} alt="" />
            ) : (
              <span className="cast-video-placeholder-text">视频预览区域</span>
            )}
          </div>

          {/* 进度条 */}
          <div className="cast-progress-track">
            <div className="cast-progress-fill" />
          </div>

          {/* 控制栏 */}
          <div className={`cast-controls ${controlsVisible ? "" : "cast-controls-hidden"}`}>
            <div className="cast-controls-left">
              <button className="cast-control-btn" onClick={handlePlayPause} title={isPlaying ? "暂停" : "播放"}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <span className="cast-control-time">{currentTime} / {totalTime}</span>
            </div>
            <div className="cast-controls-right">
              <button className="cast-control-btn" onClick={handleScreenshot} title="截帧">
                📷
              </button>
              <span className="cast-control-speed" onClick={handleCycleSpeed} title="切换倍速">
                {playbackSpeed}x
              </span>
              <span className="cast-control-fullscreen" onClick={handleToggleFullscreen} title="全屏">
                ⛶
              </span>
            </div>
          </div>
        </div>

        {/* 分 P 信息 */}
        <div className="cast-episode">P1/1 · 00:00</div>

        {/* 内容标题 */}
        <div className="cast-content-title">{title || "内容标题"}</div>

        {/* 参与者 */}
        {participants.length > 0 && (
          <div className="cast-participants">
            {participants.slice(0, 5).map((p, i) => (
              <div
                key={i}
                className={`cast-participant-dot ${p.role === "host" || p.role === "user" ? "user" : "ai"}`}
                title={p.displayName || "成员"}
              >
                {(p.displayName || "?")[0]}
              </div>
            ))}
            {participants.length > 5 && <span className="cast-participant-count">+{participants.length - 5}</span>}
          </div>
        )}

        {/* AI 剧情分析 */}
        <div className="cast-analysis">
          {analysisState === "loading" && (
            <div className="cast-analysis-loading">
              <div className="cast-analysis-spinner" />
              <span className="cast-analysis-text">正在分析附近剧情</span>
            </div>
          )}
          {analysisState === "progress" && (
            <>
              <div className="cast-analysis-text">已提前分析部分内容</div>
              <div className="cast-analysis-progress">剧情图像仍在生成，当前暂用纯文字。</div>
            </>
          )}
          {analysisState === "degraded" && (
            <div className="cast-analysis-degraded">剧情图像仍在生成，当前暂用纯文字。</div>
          )}
          {analysisState === "error" && (
            <div className="cast-analysis-error">
              <span>连接暂时中断</span>
              <span className="cast-analysis-retry" onClick={() => setAnalysisState("loading")}>重试分析</span>
            </div>
          )}
          {analysisState === "complete" && (
            <div className="cast-analysis-complete">分析完成</div>
          )}
          {analysisState === "never" && (
            <div className="cast-analysis-never">等待分析内容</div>
          )}
        </div>

        {/* 放映厅房间信息 */}
        {roomRef.current && (
          <div className="cast-room-panel">
            <div className="cast-room-code-area" style={{ flexDirection: "row", justifyContent: "space-between", padding: "12px 16px" }}>
              <div>
                <div className="cast-room-code-label">邀请码</div>
                <div className="cast-room-code" style={{ fontSize: 18, letterSpacing: 2 }}>{room.joinCode}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="cast-room-share-btn" style={{ padding: "6px 14px", fontSize: 12 }} onClick={shareRoomInvite}>分享邀请</button>
                <button type="button" className="cast-room-leave-btn" onClick={handleLeaveRoom}>退出</button>
              </div>
            </div>
          </div>
        )}

        {/* 对话区域 */}
        <div className="cast-chat-header">
          <span className="cast-chat-title">对话区域</span>
          <span className={`cast-chat-danmaku-toggle ${danmakuEnabled ? "is-active" : ""}`} onClick={() => setDanmakuEnabled(!danmakuEnabled)}>
            {danmakuEnabled ? "弹幕已开启" : "弹幕已关闭"}
          </span>
        </div>

        {/* 聊天消息 */}
        <div className="cast-chat-messages">
          {messages.length === 0 ? (
            <div className="cast-chat-empty">暂无对话</div>
          ) : (
            messages.map((msg) => {
              const isUserMsg = msg.type === "user";
              const attr = isUserMsg
                ? { displayName: userName, aiName, userActive: true, full: `${userName}&${aiName}` }
                : { displayName: userName, aiName: msg.sender || aiName, userActive: false, full: `${userName}&${msg.sender || aiName}` };
              return (
              <div key={msg.id} className={`cast-message ${isUserMsg ? "cast-message-user" : "cast-message-ai"}`}>
                <div>
                  <div className="cast-message-sender">
                    <span className={`cast-attr-user ${isUserMsg ? "is-active" : "is-dim"}`}>{attr.displayName}</span>
                    <span className="cast-attr-amp">&</span>
                    <span className={`cast-attr-ai ${isUserMsg ? "is-dim" : "is-active"}`}>{attr.aiName}</span>
                  </div>
                  <div className="cast-message-bubble">{msg.content}</div>
                </div>
              </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 底部输入区 */}
        <div className="cast-input-area">
          <input
            className="cast-input"
            type="text"
            placeholder="输入消息…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          />
          <button className="cast-send-btn" type="button" onClick={handleSendMessage} disabled={!chatInput.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}