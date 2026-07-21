import { useEffect, useRef, useState } from "react";
import { apiRequest, streamChat } from "./api";
import OmbreMemories from "./OmbreMemories";

const emptySettings = {
  ai_name: "小灯",
  system_prompt: "",
  personality: "",
  provider: "custom",
  api_url: "",
  model: "",
  temperature: 0.7,
  context_turns: 20,
  max_tokens: 2048,
  compression_threshold: 12000,
  compression_keep: 20,
  timezone: "Asia/Shanghai",
  push_enabled: false,
  max_push_per_day: 7,
};

const navItems = [
  { id: "chat", icon: "✦", label: "聊天" },
  { id: "moments", icon: "◌", label: "动态" },
  { id: "memories", icon: "◇", label: "记忆" },
  { id: "settings", icon: "⚙", label: "设置" },
];

function formatTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败，请换一张图片重试。"));
      },
      type,
      quality,
    );
  });
}

async function prepareMomentImage(file) {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  if (!supportedTypes.includes(file.type)) {
    throw new Error("图片只支持 JPG、PNG、WebP 或 GIF。");
  }

  if (file.type === "image/gif") {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("GIF 图片必须小于 5MB。");
    }
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: file.name,
      type: file.type,
      data: dataUrl.split(",")[1] || "",
      preview: dataUrl,
    };
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("相机原图不能超过 15MB。");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("这张大图无法压缩，请换一张较小的图片。");
    }
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: file.name,
      type: file.type,
      data: dataUrl.split(",")[1] || "",
      preview: dataUrl,
    };
  }

  const longestSide = Math.max(bitmap.width, bitmap.height);
  if (file.size <= 2 * 1024 * 1024 && longestSide <= 1800) {
    bitmap.close?.();
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: file.name,
      type: file.type,
      data: dataUrl.split(",")[1] || "",
      preview: dataUrl,
    };
  }

  const scale = Math.min(1, 1800 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("浏览器无法处理这张图片，请换一张重试。");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const compressed = await canvasToBlob(canvas, "image/jpeg", 0.82);
  if (compressed.size > 5 * 1024 * 1024) {
    throw new Error("图片压缩后仍超过 5MB，请换一张较小的图片。");
  }

  const dataUrl = await readFileAsDataUrl(compressed);
  return {
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    type: "image/jpeg",
    data: dataUrl.split(",")[1] || "",
    preview: dataUrl,
  };
}

function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState(emptySettings);
  const [draftSettings, setDraftSettings] = useState(emptySettings);
  const [activeView, setActiveView] = useState("chat");
  const [memories, setMemories] = useState([]);
  const [moments, setMoments] = useState([]);
  const [momentsAvailable, setMomentsAvailable] = useState(null);
  const [momentDraft, setMomentDraft] = useState("");
  const [momentImages, setMomentImages] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isPostingMoment, setIsPostingMoment] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const messageEndRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const streamingSessionIdRef = useRef(null);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [settingsData, sessionsData] = await Promise.all([
          apiRequest("/settings"),
          apiRequest("/sessions"),
        ]);

        if (cancelled) return;
        const nextSettings = settingsData.settings || emptySettings;
        const nextSessions = sessionsData.sessions || [];

        setSettings(nextSettings);
        setDraftSettings(nextSettings);
        setSessions(nextSessions);
        setActiveSessionId(nextSessions[0]?.id || null);
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      if (!activeSessionId) {
        setMessages([]);
        return;
      }

      if (
        isSending &&
        streamingSessionIdRef.current === activeSessionId
      ) {
        return;
      }

      try {
        const data = await apiRequest(`/sessions/${activeSessionId}/messages`);
        if (!cancelled) setMessages(data.messages || []);
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, isSending]);

  useEffect(() => {
    if (activeView === "memories") {
      apiRequest("/memories")
        .then((data) => setMemories(data.memories || []))
        .catch((error) => setNotice(error.message));
    }

    if (activeView === "moments") {
      loadMoments();
    }
  }, [activeView]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    function handleInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    let fullHeight = window.innerHeight;
    function fitViewport() {
      if (viewport.height > fullHeight - 60) {
        fullHeight = Math.max(viewport.height, window.innerHeight);
      }
      const keyboardGap = fullHeight - viewport.height;
      const height = keyboardGap > 60 ? viewport.height : fullHeight;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(height)}px`,
      );
      if (keyboardGap <= 60 && window.scrollY) window.scrollTo(0, 0);
    }

    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
    };
  }, []);

  async function refreshSessions(preferredId = activeSessionId) {
    const data = await apiRequest("/sessions");
    const nextSessions = data.sessions || [];
    setSessions(nextSessions);

    if (preferredId && nextSessions.some((item) => item.id === preferredId)) {
      setActiveSessionId(preferredId);
    } else {
      setActiveSessionId(nextSessions[0]?.id || null);
    }
  }

  async function createSession() {
    try {
      const data = await apiRequest("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "新对话" }),
      });
      setSessions((current) => [data.session, ...current]);
      activeSessionIdRef.current = data.session.id;
      setActiveSessionId(data.session.id);
      setMessages([]);
      setActiveView("chat");
      setIsSidebarOpen(false);
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  }

  function chooseSession(sessionId) {
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setActiveView("chat");
    setIsSidebarOpen(false);
  }

  async function confirmSessionDialog(event) {
    event.preventDefault();
    if (!dialog?.session) return;

    try {
      if (dialog.type === "rename") {
        const title = dialog.value.trim();
        if (!title) return;
        const data = await apiRequest(`/sessions/${dialog.session.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        setSessions((current) =>
          current.map((item) =>
            item.id === dialog.session.id ? data.session : item,
          ),
        );
      } else {
        await apiRequest(`/sessions/${dialog.session.id}`, { method: "DELETE" });
        const remaining = sessions.filter(
          (item) => item.id !== dialog.session.id,
        );
        setSessions(remaining);
        if (activeSessionId === dialog.session.id) {
          setActiveSessionId(remaining[0]?.id || null);
          setMessages([]);
        }
      }
      setDialog(null);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text || isSending) return;

    setMessage("");
    setIsSending(true);
    setNotice("");

    let sessionId = activeSessionId;
    const localUserId = `local-user-${Date.now()}`;
    const localAssistantId = `local-assistant-${Date.now()}`;

    try {
      if (!sessionId) {
        const created = await apiRequest("/sessions", {
          method: "POST",
          body: JSON.stringify({ title: text.slice(0, 30) }),
        });
        sessionId = created.session.id;
        activeSessionIdRef.current = sessionId;
        streamingSessionIdRef.current = sessionId;
        setSessions((current) => [created.session, ...current]);
        setActiveSessionId(sessionId);
      }

      streamingSessionIdRef.current = sessionId;

      setMessages((current) => [
        ...current,
        {
          id: localUserId,
          role: "user",
          content: text,
          created_at: new Date().toISOString(),
        },
        {
          id: localAssistantId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
          isStreaming: true,
        },
      ]);

      await streamChat(
        {
          session_id: sessionId,
          message: text,
          model: settings.model,
          client_time: new Date().toLocaleString("zh-CN"),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        (event) => {
          if (activeSessionIdRef.current !== sessionId) return;

          if (event.type === "meta" && event.user_message) {
            setMessages((current) =>
              current.map((item) =>
                item.id === localUserId ? event.user_message : item,
              ),
            );
          }

          if (event.type === "text") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, content: item.content + event.content }
                  : item,
              ),
            );
          }

          if (event.type === "error") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, content: event.content, isStreaming: false }
                  : item,
              ),
            );
          }

          if (event.type === "done") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? event.assistant_message || { ...item, isStreaming: false }
                  : item,
              ),
            );
          }
        },
      );

      const history = await apiRequest(`/sessions/${sessionId}/messages`);
      if (activeSessionIdRef.current === sessionId) {
        setMessages(history.messages || []);
      }
      await refreshSessions(activeSessionIdRef.current || sessionId);
    } catch (error) {
      setNotice(error.message);
      setMessages((current) =>
        current.map((item) =>
          item.id === localAssistantId
            ? {
                ...item,
                content: "连接暂时中断了，请检查后端后再试一次。",
                isStreaming: false,
              }
            : item,
        ),
      );
    } finally {
      if (streamingSessionIdRef.current === sessionId) {
        streamingSessionIdRef.current = null;
      }
      setIsSending(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setIsSavingSettings(true);

    try {
      const data = await apiRequest("/settings", {
        method: "PUT",
        body: JSON.stringify(draftSettings),
      });
      setSettings(data.settings);
      setDraftSettings(data.settings);
      setNotice("设置已保存。API 密钥仍只保存在后端环境变量中。");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setIsSavingSettings(false);
    }
  }

  function updateDraft(field, value) {
    setDraftSettings((current) => ({ ...current, [field]: value }));
  }

  async function loadMoments() {
    try {
      const data = await apiRequest("/moments");
      setMomentsAvailable(data.available);
      setMoments(data.entries || []);
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function postMoment(event) {
    event.preventDefault();
    const content = momentDraft.trim();
    if ((!content && momentImages.length === 0) || isPostingMoment) return;

    setIsPostingMoment(true);
    try {
      await apiRequest("/moments", {
        method: "POST",
        body: JSON.stringify({
          content,
          session_id: activeSessionId,
          images: momentImages.map((item) => ({
            type: item.type,
            data: item.data,
          })),
        }),
      });
      setMomentDraft("");
      setMomentImages([]);
      await loadMoments();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setIsPostingMoment(false);
    }
  }

  async function selectMomentImages(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const remaining = Math.max(0, 4 - momentImages.length);
    if (remaining === 0) {
      setNotice("一条动态最多添加 4 张图片。");
      return;
    }

    try {
      const next = [];
      for (const file of files.slice(0, remaining)) {
        const prepared = await prepareMomentImage(file);
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          ...prepared,
        });
      }

      setMomentImages((current) => [...current, ...next].slice(0, 4));
      if (files.length > remaining) {
        setNotice("一条动态最多添加 4 张图片，多余图片没有加入。");
      }
    } catch (error) {
      setNotice(error.message);
    }
  }

  function removeMomentImage(id) {
    setMomentImages((current) => current.filter((item) => item.id !== id));
  }

  async function toggleMomentLike(moment) {
    try {
      await apiRequest(`/moments/${moment.id}/like`, {
        method: "POST",
        body: JSON.stringify({ liked: !moment.user_liked }),
      });
      await loadMoments();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function postComment(momentId) {
    const content = (commentDrafts[momentId] || "").trim();
    if (!content) return;

    try {
      await apiRequest(`/moments/${momentId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setCommentDrafts((current) => ({ ...current, [momentId]: "" }));
      await loadMoments();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function installApp() {
    if (!installPrompt) {
      setNotice("如未出现安装按钮，请使用浏览器菜单里的“安装应用”或“添加到主屏幕”。");
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function changeView(view) {
    setActiveView(view);
    setIsSidebarOpen(false);
    if (view === "settings") setDraftSettings(settings);
  }

  function renderChat() {
    return (
      <>
        <section className="message-list" aria-live="polite">
          {isLoading ? (
            <div className="empty-state">正在加载 DengTa home…</div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <div className="welcome-mark">灯</div>
              <h2>欢迎回家</h2>
              <p>
                现在可以测试聊天、历史记录和流式显示。
                <br />
                {settings.model
                  ? `当前已连接真实模型：${settings.model}`
                  : "尚未填写模型时，会使用安全的演示回复。"}
              </p>
            </div>
          ) : (
            messages.map((item) => (
              <article
                key={item.id}
                className={`message-row ${item.role === "user" ? "user" : "assistant"}`}
              >
                <div className="message-bubble">
                  <div className="message-role">
                    {item.role === "user" ? "我" : settings.ai_name || "小灯"}
                  </div>
                  <div className="message-content">{item.content}</div>
                  {item.isStreaming && <span className="stream-caret">♥</span>}
                  <time>{formatTime(item.created_at)}</time>
                </div>
              </article>
            ))
          )}
          <div ref={messageEndRef} />
        </section>

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="输入消息，按 Enter 发送…"
              rows="1"
              disabled={isSending}
            />
            <button
              className="send-button"
              onClick={sendMessage}
              disabled={!message.trim() || isSending}
            >
              {isSending ? "回应中" : "发送"}
            </button>
          </div>
          <small>
            {isOnline ? "已连接" : "网络已断开，暂时不能聊天"} · 聊天记录保存在 Supabase
          </small>
        </div>
      </>
    );
  }

  function renderMoments() {
    if (momentsAvailable === false) {
      return (
        <section className="feature-page centered-feature">
          <div className="feature-symbol">◌</div>
          <h2>动态空间暂时无法加载</h2>
          <p>
            请确认后端服务器正在运行，然后重新打开这个页面。
          </p>
          <span className="status-chip pending">暂时不可用</span>
        </section>
      );
    }

    return (
      <section className="feature-page moments-page">
        <form className="moment-composer" onSubmit={postMoment}>
          <div className="avatar">我</div>
          <div className="moment-compose-main">
            <textarea
              value={momentDraft}
              onChange={(event) => setMomentDraft(event.target.value)}
              placeholder="留下一句话，或者只发图片…"
              rows="3"
            />

            {momentImages.length > 0 && (
              <div className="moment-preview-grid">
                {momentImages.map((image) => (
                  <div className="moment-preview" key={image.id}>
                    <img src={image.preview} alt={image.name} />
                    <button
                      type="button"
                      aria-label={`移除 ${image.name}`}
                      onClick={() => removeMomentImage(image.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="moment-compose-tools">
              <label className="image-picker">
                ＋ 添加图片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={selectMomentImages}
                />
              </label>
              <span>{momentImages.length}/4</span>
              <button type="button" onClick={loadMoments}>
                刷新动态
              </button>
            </div>
          </div>
          <button
            className="moment-submit"
            disabled={
              (!momentDraft.trim() && momentImages.length === 0) ||
              isPostingMoment
            }
          >
            {isPostingMoment ? "发布中" : "发布动态"}
          </button>
        </form>

        <div className="moment-list">
          {moments.length === 0 ? (
            <div className="empty-card">这里还没有动态。</div>
          ) : (
            moments.map((item) => (
              <article className="moment-card" key={item.id}>
                <header>
                  <div className="avatar">
                    {item.author === "assistant" ? "灯" : "我"}
                  </div>
                  <div>
                    <strong>
                      {item.author === "assistant"
                        ? settings.ai_name || "小灯"
                        : "我"}
                    </strong>
                    <time>{formatDateTime(item.created_at)}</time>
                  </div>
                </header>
                {item.content && <p>{item.content}</p>}
                {Array.isArray(item.images) && item.images.length > 0 && (
                  <div className={`moment-image-grid count-${item.images.length}`}>
                    {item.images.map((url, index) => (
                      <button
                        type="button"
                        className="moment-image-button"
                        aria-label={`查看动态图片 ${index + 1}`}
                        onClick={() =>
                          setImageViewer({
                            url,
                            alt: `动态图片 ${index + 1}`,
                          })
                        }
                        key={`${url}-${index}`}
                      >
                        <img
                          src={url}
                          alt={`动态图片 ${index + 1}`}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
                <div className="moment-actions">
                  {item.author === "assistant" ? (
                    <button onClick={() => toggleMomentLike(item)}>
                      {item.user_liked ? "♥ 已喜欢" : "♡ 喜欢"}
                    </button>
                  ) : (
                    <span>
                      {item.reply_status === "pending"
                        ? `等待 ${settings.ai_name || "小灯"} 路过…`
                        : ""}
                    </span>
                  )}
                </div>

                {item.liked && item.author === "user" && (
                  <div className="ai-like">
                    ♥ {settings.ai_name || "小灯"} 喜欢了这条动态
                  </div>
                )}

                {item.reply_content && (
                  <div className="comment assistant-comment">
                    <strong>{settings.ai_name || "小灯"}：</strong>
                    {item.reply_content}
                  </div>
                )}

                {(item.comments || []).map((comment) => (
                  <div
                    className={`comment ${
                      comment.author === "assistant" ? "assistant-comment" : ""
                    }`}
                    key={comment.id}
                  >
                    <strong>
                      {comment.author === "assistant"
                        ? settings.ai_name || "小灯"
                        : "我"}
                      ：
                    </strong>
                    {comment.content}
                  </div>
                ))}

                {item.author === "assistant" && (
                  <div className="comment-box">
                    <input
                      value={commentDrafts[item.id] || ""}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          postComment(item.id);
                        }
                      }}
                      placeholder="写一条评论"
                    />
                    <button onClick={() => postComment(item.id)}>发送</button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderMemories() {
    return (
      <section className="feature-page memory-page">
        <div className="section-intro">
          <span className="eyebrow">长期记忆</span>
          <h2>留在家里的事情</h2>
          <p>这些摘要会作为真实模型回复时的长期背景。</p>
        </div>
        <OmbreMemories />
        <div className="memory-source-heading local-memory-heading">
          <div>
            <span className="eyebrow">SUPABASE</span>
            <h3>对话摘要</h3>
          </div>
          <span className="local-memory-count">{memories.length} 条</span>
        </div>
        <div className="memory-grid">
          {memories.length === 0 ? (
            <div className="empty-card">
              暂时没有长期记忆。达到设置中的 token 阈值后会自动整理。
            </div>
          ) : (
            memories.map((item) => (
              <article className="memory-card" key={item.id}>
                <span>{formatDateTime(item.updated_at || item.created_at)}</span>
                <p>{item.summary}</p>
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="feature-page settings-page">
        <div className="section-intro settings-intro">
          <div>
            <span className="eyebrow">控制中心</span>
            <h2>AI 与应用设置</h2>
            <p>
              当前接口和模型可以随时更换；API Key 永远只放在后端环境变量中。
            </p>
          </div>
          <button className="install-button" onClick={installApp}>
            ⤓ 安装到手机/电脑
          </button>
        </div>

        <form className="settings-form" onSubmit={saveSettings}>
          <div className="settings-card">
            <h3>角色</h3>
            <div className="settings-grid">
              <label>
                AI 名称
                <input
                  value={draftSettings.ai_name || ""}
                  onChange={(event) =>
                    updateDraft("ai_name", event.target.value)
                  }
                />
              </label>
              <label>
                人格描述
                <input
                  value={draftSettings.personality || ""}
                  onChange={(event) =>
                    updateDraft("personality", event.target.value)
                  }
                />
              </label>
              <label className="full-width">
                系统提示词
                <textarea
                  value={draftSettings.system_prompt || ""}
                  onChange={(event) =>
                    updateDraft("system_prompt", event.target.value)
                  }
                  rows="7"
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <h3>唯一的活动接口</h3>
            <p className="card-hint">
              以后换 Gemini、Claude、GPT 或中转站，只改这里，不改聊天页面。
            </p>
            <div className="settings-grid">
              <label>
                接口格式
                <select
                  value={draftSettings.provider || "custom"}
                  onChange={(event) =>
                    updateDraft("provider", event.target.value)
                  }
                >
                  <option value="custom">自定义 / OpenAI 兼容中转</option>
                  <option value="openai-compatible">OpenAI 兼容</option>
                  <option value="gemini">Gemini 原生</option>
                  <option value="anthropic">Anthropic 原生</option>
                </select>
              </label>
              <label>
                模型名称
                <input
                  value={draftSettings.model || ""}
                  onChange={(event) => updateDraft("model", event.target.value)}
                  placeholder="暂时留空即可"
                />
              </label>
              <label className="full-width">
                API 地址
                <input
                  value={draftSettings.api_url || ""}
                  onChange={(event) =>
                    updateDraft("api_url", event.target.value)
                  }
                  placeholder="暂时留空；以后填写服务商地址"
                />
              </label>
              <label>
                温度（0–2）
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={draftSettings.temperature ?? 0.7}
                  onChange={(event) =>
                    updateDraft("temperature", event.target.value)
                  }
                />
              </label>
              <label>
                上下文保留轮数
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={draftSettings.context_turns ?? 20}
                  onChange={(event) =>
                    updateDraft("context_turns", event.target.value)
                  }
                />
              </label>
              <label>
                最大回复 Token
                <input
                  type="number"
                  min="64"
                  value={draftSettings.max_tokens ?? 2048}
                  onChange={(event) =>
                    updateDraft("max_tokens", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <h3>记忆与主动消息</h3>
            <p className="card-hint">
              记忆压缩已经启用；主动消息参数会在影子推送模块完成后使用。
            </p>
            <div className="settings-grid">
              <label>
                所在时区
                <input
                  value={draftSettings.timezone || "Asia/Shanghai"}
                  onChange={(event) =>
                    updateDraft("timezone", event.target.value)
                  }
                  placeholder="Asia/Shanghai"
                />
              </label>
              <label>
                主动消息
                <select
                  value={String(draftSettings.push_enabled === true)}
                  onChange={(event) =>
                    updateDraft("push_enabled", event.target.value === "true")
                  }
                >
                  <option value="false">关闭</option>
                  <option value="true">开启（模块完成后生效）</option>
                </select>
              </label>
              <label>
                触发记忆压缩的 token 阈值
                <input
                  type="number"
                  min="1000"
                  max="200000"
                  step="1000"
                  value={draftSettings.compression_threshold ?? 12000}
                  onChange={(event) =>
                    updateDraft("compression_threshold", event.target.value)
                  }
                />
              </label>
              <label>
                压缩后保留的近期对话轮数
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={draftSettings.compression_keep ?? 20}
                  onChange={(event) =>
                    updateDraft("compression_keep", event.target.value)
                  }
                />
              </label>
              <label>
                每日主动消息上限
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={draftSettings.max_push_per_day ?? 7}
                  onChange={(event) =>
                    updateDraft("max_push_per_day", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="save-bar">
            <span>
              {settings.model
                ? `当前模型：${settings.model}`
                : "当前未配置模型，使用演示回复"}
            </span>
            <button className="primary-button" disabled={isSavingSettings}>
              {isSavingSettings ? "保存中" : "保存设置"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  const viewTitle = {
    chat: activeSession?.title || "欢迎回家",
    moments: "动态空间",
    memories: "长期记忆",
    settings: "设置",
  }[activeView];

  return (
    <div className="app-shell">
      {isSidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭菜单"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-icon">灯</span>
          <div>
            <strong>DengTa home</strong>
            <small>给 AI 一个家</small>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要功能">
          {navItems.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => changeView(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="session-heading">
          <span>最近对话</span>
          <button onClick={createSession} title="新建对话">
            ＋
          </button>
        </div>

        <div className="session-list" aria-label="会话列表">
          {sessions.map((session) => (
            <div
              className={`session-item ${
                activeSessionId === session.id ? "active" : ""
              }`}
              key={session.id}
            >
              <button
                className="session-select"
                onClick={() => chooseSession(session.id)}
                title={session.title}
              >
                <span>⌁</span>
                <span>{session.title}</span>
              </button>
              <div className="session-actions">
                <button
                  onClick={() =>
                    setDialog({
                      type: "rename",
                      session,
                      value: session.title,
                    })
                  }
                  title="重命名"
                >
                  ✎
                </button>
                <button
                  onClick={() =>
                    setDialog({ type: "delete", session, value: "" })
                  }
                  title="删除"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className={`connection-dot ${isOnline ? "online" : ""}`} />
          {isOnline ? "服务可连接" : "网络已断开"}
        </div>
      </aside>

      <main className={`main-panel view-${activeView}`}>
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="打开菜单"
          >
            ☰
          </button>
          <div>
            <h1>{viewTitle}</h1>
            <p>
              {activeView === "chat"
                ? `${settings.ai_name || "小灯"} · ${
                    settings.model || "演示模式"
                  }`
                : "DengTa home"}
            </p>
          </div>
          <button className="new-chat-top" onClick={createSession}>
            ＋ 新对话
          </button>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        <div className="view-content">
          {activeView === "chat" && renderChat()}
          {activeView === "moments" && renderMoments()}
          {activeView === "memories" && renderMemories()}
          {activeView === "settings" && renderSettings()}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="手机底部导航">
        {navItems.map((item) => (
          <button
            className={activeView === item.id ? "active" : ""}
            key={item.id}
            onClick={() => changeView(item.id)}
          >
            <span>{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>

      {dialog && (
        <div className="dialog-backdrop" onMouseDown={() => setDialog(null)}>
          <form
            className="dialog-card"
            onSubmit={confirmSessionDialog}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {dialog.type === "rename" ? (
              <>
                <h2>重命名对话</h2>
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
              </>
            ) : (
              <>
                <h2>删除这个对话？</h2>
                <p>“{dialog.session.title}”及里面的消息会一起删除。</p>
              </>
            )}
            <div>
              <button type="button" onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="danger-button" type="submit">
                {dialog.type === "rename" ? "保存" : "删除"}
              </button>
            </div>
          </form>
        </div>
      )}

      {imageViewer && (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="动态图片预览"
          onMouseDown={() => setImageViewer(null)}
        >
          <button
            type="button"
            className="image-viewer-close"
            aria-label="关闭图片预览"
            onClick={() => setImageViewer(null)}
          >
            ×
          </button>
          <img
            src={imageViewer.url}
            alt={imageViewer.alt}
            onMouseDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default App;
