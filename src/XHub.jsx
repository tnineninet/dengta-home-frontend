import { useEffect, useMemo, useState } from "react";
import { AtSign, CheckCircle2, ExternalLink, Loader2, MessageCircle, RefreshCw, Search, Send, TriangleAlert } from "lucide-react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";
import { extractTweetId, formatXResultTimestamps } from "./x-hub-utils.js";
import "./x-hub.css";

const X_TOOL_LABELS = {
  post_tweet: "发帖",
  reply_tweet: "回复",
  get_tweet_replies: "查看回复",
  search_tweets: "搜索",
  get_tweet_by_id: "查看推文",
  get_user_info: "用户资料",
  get_user_tweets: "用户时间线",
  read_direct_messages: "读私信",
  send_direct_message: "发私信",
  favorite_tweet: "点赞",
  retweet: "转推",
  delete_tweet: "删帖",
};

function normalizeXConnection(connection) {
  const tools = Array.isArray(connection?.tools)
    ? connection.tools
    : Array.isArray(connection?.discovered_tools)
      ? connection.discovered_tools
      : [];
  return {
    ...connection,
    tools,
    names: tools.map((tool) => tool.name).filter(Boolean),
  };
}

export default function XHub({ onOpenDeviceCenter, visualPreview = false }) {
  const [loading, setLoading] = useState(!visualPreview);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [connection, setConnection] = useState(null);
  const [query, setQuery] = useState("");
  const [tweetLookup, setTweetLookup] = useState("");
  const [postText, setPostText] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [action, setAction] = useState("");
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState("");

  const load = async () => {
    if (visualPreview) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [statusData, manageData] = await Promise.all([
        apiRequest("/api/mcp/connections/status"),
        apiRequest("/api/mcp/connections/manage"),
      ]);
      setStatus(statusData || null);
      const connections = (manageData?.connections || []).map(normalizeXConnection);
      const x = connections.find((item) => item.names.includes("post_tweet") || item.names.includes("search_tweets"))
        || connections.find((item) => /x\s*\/?\s*twitter|twitter|\bx\b/i.test(String(item.name || "")))
        || null;
      setConnection(x);
    } catch (caught) {
      setError(settingsServiceErrorMessage(caught, "X 连接暂时读不到。"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visualPreview) return undefined;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [visualPreview]);

  const availableTools = useMemo(() => connection?.names || [], [connection]);
  const parsedTweetId = useMemo(() => extractTweetId(tweetLookup), [tweetLookup]);

  async function callXTool(toolName, args) {
    if (!connection?.id) throw new Error("还没有连接 X / Twitter。");
    setAction(toolName);
    setActionError("");
    setResult(null);
    try {
      const data = await apiRequest(`/api/mcp/connections/manage/${connection.id}/tools/${encodeURIComponent(toolName)}/call`, {
        method: "POST",
        body: JSON.stringify({ arguments: args }),
        timeoutMs: 60000,
      });
      setResult({
        tool: toolName,
        ok: data?.ok !== false && data?.isError !== true,
        text: formatXResultTimestamps(String(data?.text || "").slice(0, 6000)) || "工具已执行，但没有返回文本结果。",
      });
    } catch (caught) {
      setActionError(settingsServiceErrorMessage(caught, "X 工具暂时没有响应。"));
    } finally {
      setAction("");
    }
  }

  const postDisabled = !postText.trim() || !confirmPost || action === "post_tweet";

  return (
    <section className="feature-page x-hub" aria-label="X / Twitter">
      <header className="x-hub-hero">
        <span className="x-hub-mark" aria-hidden="true"><AtSign /></span>
        <div>
          <span className="eyebrow">EXTERNAL TIMELINE</span>
          <h2>X / Twitter</h2>
          <p>在 DengTa 里直接发帖、搜索和查看 X；连接仍由你的 MCP 网关保管。</p>
        </div>
        <span className={`x-hub-status ${connection ? "is-ready" : "is-offline"}`}>
          {loading ? "读取中" : connection ? "已连接" : "未连接"}
        </span>
      </header>

      {visualPreview ? (
        <div className="x-hub-empty" role="note">
          <MessageCircle aria-hidden="true" />
          <h3>本地预览 · X / Twitter MCP 通道</h3>
          <p>支持通过 x-twikit-mcp（MIT）搜索、发帖、按推文链接（x.com/.../status/...）或 ID 读取详情，并自动以 Asia/Shanghai (UTC+8) 展示时间。请在主入口登录后绑定你的 MCP 网关。</p>
          <div>
            <button type="button" onClick={() => { window.location.href = "/"; }}>前往主入口登录</button>
          </div>
        </div>
      ) : loading ? (
        <div className="x-hub-loading" role="status"><Loader2 className="spin" aria-hidden="true" />正在读取 X 连接…</div>
      ) : error ? (
        <div className="x-hub-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div><strong>X 连接暂时没有读到</strong><p>{error}</p></div>
          <div style={{ display: "flex", gap: "8px" }}>
            {error.includes("authentication_required") ? <button type="button" onClick={() => { window.location.href = "/"; }}>前往登录</button> : null}
            <button type="button" onClick={() => void load()}>重新读取</button>
          </div>
        </div>
      ) : !connection ? (
        <div className="x-hub-empty">
          <MessageCircle aria-hidden="true" />
          <h3>还没有接上 X</h3>
          <p>先在 MCP 设备中心连接 twikit/X MCP 网关，再回来使用发帖和搜索。</p>
          <div>
            <button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />重新读取</button>
            {onOpenDeviceCenter ? <button type="button" onClick={onOpenDeviceCenter}>去 MCP 设备中心 <ExternalLink aria-hidden="true" /></button> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="x-hub-connection-card">
            <div>
              <span className="x-hub-card-kicker">CONNECTION</span>
              <strong>{connection.name || "X / Twitter"}</strong>
              <small>{status?.message || "MCP 网关在线"}</small>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />刷新</button>
          </div>

          <section className="x-hub-card" aria-labelledby="x-search-title">
            <div className="x-hub-card-heading">
              <div><span className="eyebrow">READ</span><h3 id="x-search-title">搜索 X</h3></div>
              <Search aria-hidden="true" />
            </div>
            <div className="x-hub-inline-form">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索关键词或话题"
                aria-label="搜索 X"
                maxLength={120}
              />
              <button
                type="button"
                className="x-hub-primary"
                disabled={!query.trim() || action === "search_tweets"}
                onClick={() => void callXTool("search_tweets", { query: query.trim() })}
              >
                {action === "search_tweets" ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                搜索
              </button>
            </div>
          </section>

          {availableTools.includes("get_tweet_by_id") && (
            <section className="x-hub-card" aria-labelledby="x-lookup-title">
              <div className="x-hub-card-heading">
                <div><span className="eyebrow">TWEET URL / ID</span><h3 id="x-lookup-title">按链接或 ID 查看推文</h3></div>
                <ExternalLink aria-hidden="true" />
              </div>
              <div className="x-hub-inline-form">
                <input
                  value={tweetLookup}
                  onChange={(event) => setTweetLookup(event.target.value)}
                  placeholder="粘贴 https://x.com/.../status/123... 或数字 ID"
                  aria-label="推文链接或 ID"
                  maxLength={240}
                />
                <button
                  type="button"
                  className="x-hub-primary"
                  disabled={!parsedTweetId || action === "get_tweet_by_id"}
                  onClick={() => void callXTool("get_tweet_by_id", { tweet_id: parsedTweetId })}
                >
                  {action === "get_tweet_by_id" ? <Loader2 className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                  解析查看
                </button>
              </div>
            </section>
          )}

          <section className="x-hub-card" aria-labelledby="x-post-title">
            <div className="x-hub-card-heading">
              <div><span className="eyebrow">WRITE</span><h3 id="x-post-title">发一条帖</h3></div>
              <ButtonGlyph />
            </div>
            <textarea
              value={postText}
              onChange={(event) => setPostText(event.target.value.slice(0, 280))}
              placeholder="写点什么…"
              aria-label="X 发帖内容"
              rows={4}
            />
            <div className="x-hub-post-meta">
              <span>{postText.length}/280</span>
              <label>
                <input type="checkbox" checked={confirmPost} onChange={(event) => setConfirmPost(event.target.checked)} />
                我确认要发布到 X
              </label>
            </div>
            <button
              type="button"
              className="x-hub-primary x-hub-post"
              disabled={postDisabled}
              onClick={() => void callXTool("post_tweet", { text: postText.trim() })}
            >
              {action === "post_tweet" ? <Loader2 className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              发布
            </button>
          </section>

          <section className="x-hub-card" aria-labelledby="x-tools-title">
            <div className="x-hub-card-heading">
              <div><span className="eyebrow">TOOLS</span><h3 id="x-tools-title">已授权工具</h3></div>
              <small>{availableTools.length} 个</small>
            </div>
            <div className="x-hub-tool-list">
              {availableTools.map((name) => <span key={name}>{X_TOOL_LABELS[name] || name}</span>)}
            </div>
            {onOpenDeviceCenter ? <button type="button" className="x-hub-link" onClick={onOpenDeviceCenter}>在 MCP 设备中心管理连接 <ExternalLink aria-hidden="true" /></button> : null}
          </section>
        </>
      )}

      {actionError ? <div className="x-hub-action-error" role="alert">{actionError}</div> : null}
      {result ? (
        <section className={`x-hub-result ${result.ok ? "" : "is-error"}`} aria-live="polite">
          <header>
            {result.ok ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            <strong>{result.ok ? "动作已执行" : "动作未确认"}</strong>
            <span>{X_TOOL_LABELS[result.tool] || result.tool}</span>
          </header>
          <pre>{result.text}</pre>
        </section>
      ) : null}
    </section>
  );
}

function ButtonGlyph() {
  return <span className="x-hub-write-glyph" aria-hidden="true">𝕏</span>;
}
