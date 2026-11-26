import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, CheckCircle2, ExternalLink, Loader2, MessageCircle, PlugZap, RefreshCw, Search, Send, TriangleAlert, User } from "lucide-react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";
import { extractTweetId, formatXResultTimestamps, resolveXConnectionState } from "./x-hub-utils.js";
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

function formatTestedAt(iso) {
  if (!iso) return "尚未实测";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "尚未实测";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export default function XHub({ onOpenDeviceCenter, visualPreview = false }) {
  const [loading, setLoading] = useState(!visualPreview);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState({ state: "none", connection: null, reason: "" });
  const [liveCheckBusy, setLiveCheckBusy] = useState(false);
  const [liveCheckNotice, setLiveCheckNotice] = useState("");
  const [query, setQuery] = useState("");
  const [tweetLookup, setTweetLookup] = useState("");
  const [usernameLookup, setUsernameLookup] = useState("");
  const [postText, setPostText] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [action, setAction] = useState("");
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    if (visualPreview) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const manageData = await apiRequest("/api/mcp/connections/manage");
      setResolved(resolveXConnectionState(manageData?.connections || []));
    } catch (caught) {
      setResolved({ state: "none", connection: null, reason: "" });
      setError(settingsServiceErrorMessage(caught, "X 连接暂时读不到。"));
    } finally {
      setLoading(false);
    }
  }, [visualPreview]);

  useEffect(() => {
    if (visualPreview) return undefined;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, visualPreview]);

  const connection = resolved.connection;
  const connState = resolved.state; // "none" | "disabled" | "disconnected" | "connected"
  const isConnected = connState === "connected";
  const availableTools = useMemo(() => connection?.xTools || [], [connection]);
  const parsedTweetId = useMemo(() => extractTweetId(tweetLookup), [tweetLookup]);

  async function testConnectionLive() {
    if (!connection?.id || liveCheckBusy) return;
    setLiveCheckBusy(true);
    setLiveCheckNotice("");
    setActionError("");
    try {
      const data = await apiRequest(`/api/mcp/connections/manage/${connection.id}/test`, {
        method: "POST",
        timeoutMs: 30000,
      });
      const next = resolveXConnectionState(data?.connection ? [data.connection] : []);
      setResolved(next);
      setLiveCheckNotice(
        next.state === "connected"
          ? `实测连通成功：已从网关读取到 ${next.connection.xTools.length} 个可用 X 工具。`
          : `实测未就绪：${next.reason}`,
      );
    } catch (caught) {
      const msg = settingsServiceErrorMessage(caught, "无法连通 X MCP 网关，请检查你自托管的公网 HTTPS 服务是否正在运行。");
      setResolved((prev) => (prev.connection ? {
        state: "disconnected",
        connection: { ...prev.connection, last_status: "error", last_error: msg },
        reason: msg,
      } : prev));
      setLiveCheckNotice(`实测连接失败：${msg}`);
    } finally {
      setLiveCheckBusy(false);
    }
  }

  async function enableAndTestConnection() {
    if (!connection?.id || liveCheckBusy) return;
    setLiveCheckBusy(true);
    setLiveCheckNotice("");
    setActionError("");
    try {
      await apiRequest(`/api/mcp/connections/manage/${connection.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: connection.name,
          enabled: true,
          auth_type: connection.auth_type,
          auth_header: connection.auth_header,
          protocol_version: connection.protocol_version,
          provider_profile: connection.provider_profile || "",
          tool_policies: connection.tool_policies || {},
        }),
      });
      const tested = await apiRequest(`/api/mcp/connections/manage/${connection.id}/test`, {
        method: "POST",
        timeoutMs: 30000,
      });
      const next = resolveXConnectionState(tested?.connection ? [tested.connection] : []);
      setResolved(next);
      setLiveCheckNotice(
        next.state === "connected"
          ? `已启用并实测连通！可用 X 工具：${next.connection.xTools.length} 个。`
          : `已启用连接，但连通测试未通过：${next.reason}`,
      );
    } catch (caught) {
      const msg = settingsServiceErrorMessage(caught, "启用或测试 X 连接失败，请前往 MCP 插件中心检查。");
      setLiveCheckNotice(msg);
      await load();
    } finally {
      setLiveCheckBusy(false);
    }
  }

  async function callXTool(toolName, args) {
    if (!connection?.id || !isConnected) {
      setActionError("X MCP 网关尚未处于「已连接且启用」状态，请先点击「实测连通性」或前往 MCP 插件中心配置。");
      return;
    }
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
      const msg = settingsServiceErrorMessage(caught, "X 工具暂时没有响应。");
      setActionError(msg);
      if (caught?.status === 409 || caught?.status === 502 || caught?.status === 504) {
        setResolved((prev) => (prev.connection ? {
          state: caught?.status === 409 ? "disabled" : "disconnected",
          connection: { ...prev.connection, last_status: "error", last_error: msg },
          reason: msg,
        } : prev));
      }
    } finally {
      setAction("");
    }
  }

  const postDisabled = !isConnected || !availableTools.includes("post_tweet") || !postText.trim() || !confirmPost || action === "post_tweet";
  const statusBadgeClass = loading
    ? "is-warn"
    : isConnected
      ? "is-ready"
      : connState === "disabled"
        ? "is-warn"
        : "is-offline";
  const statusBadgeText = loading
    ? "检测中…"
    : isConnected
      ? "● 已连接 · 可用"
      : connState === "disabled"
        ? "◌ 已保存 · 未启用"
        : connState === "disconnected"
          ? "✕ 连接离线 / 不可用"
          : "○ 未连接";

  return (
    <section className="feature-page x-hub" aria-label="X / Twitter">
      <header className="x-hub-hero">
        <span className="x-hub-mark" aria-hidden="true"><AtSign /></span>
        <div>
          <span className="eyebrow">EXTERNAL TIMELINE</span>
          <h2>X / Twitter</h2>
          <p>在 DengTa 里直接搜索、查推文与发帖；需先接入你自托管的公网 HTTPS <code>x-twikit-mcp</code> 网关。</p>
        </div>
        <span className={`x-hub-status ${statusBadgeClass}`}>
          {statusBadgeText}
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
        <div className="x-hub-loading" role="status"><Loader2 className="spin" aria-hidden="true" />正在读取 X 连接状态…</div>
      ) : error ? (
        <div className="x-hub-error" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div><strong>X 连接暂时没有读到</strong><p>{error}</p></div>
          <div style={{ display: "flex", gap: "8px" }}>
            {error.includes("authentication_required") ? <button type="button" onClick={() => { window.location.href = "/"; }}>前往登录</button> : null}
            <button type="button" onClick={() => void load()}>重新读取</button>
          </div>
        </div>
      ) : connState === "none" ? (
        <div className="x-hub-empty">
          <MessageCircle aria-hidden="true" />
          <h3>当前未连接 X / Twitter</h3>
          <p>DengTa 不会在云端保存你的 X 账号密码或 Cookie；需要先在自己电脑/服务器部署开源 <code>yxiy171866-boop/x-twikit-mcp</code> 并通过 HTTPS 暴露，再到 MCP 插件中心添加并启用。</p>
          <ol className="x-hub-guide-steps">
            <li>在你自己的机器部署 <code>x-twikit-mcp</code>（填入自己的 <code>auth_token</code> 与 <code>ct0</code>），用 <code>supergateway</code> / <code>mcp-proxy</code> + Cloudflare Tunnel 暴露为公网 <code>https://.../mcp</code>。</li>
            <li>点下方「去 MCP 插件中心」→ 在「MCP 应用目录」选 <strong>X / Twitter · twikit MCP</strong> → 填入公网 HTTPS 地址与 Bearer 令牌并保存。</li>
            <li>点「测试并读取工具」确认读出 <code>search_tweets</code> / <code>post_tweet</code> 等工具，勾选「启用此连接」后回到本页即可使用。</li>
          </ol>
          <div>
            <button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />重新检测</button>
            {onOpenDeviceCenter ? <button type="button" className="x-hub-primary" onClick={onOpenDeviceCenter}><PlugZap aria-hidden="true" />去 MCP 插件中心连接 <ExternalLink aria-hidden="true" /></button> : null}
          </div>
        </div>
      ) : !isConnected ? (
        <div className={`x-hub-diag-card ${connState === "disabled" ? "is-warn" : "is-offline"}`} role="status">
          <div className="x-hub-card-heading">
            <div>
              <span className="eyebrow">{connState === "disabled" ? "CONNECTION DISABLED" : "GATEWAY OFFLINE"}</span>
              <h3>{connState === "disabled" ? `连接「${connection.name}」尚未启用` : `连接「${connection.name}」当前不可用`}</h3>
            </div>
            <TriangleAlert aria-hidden="true" />
          </div>
          <p className="x-hub-diag-reason">{resolved.reason}</p>
          <div className="x-hub-diag-meta">
            <span>地址：<code>{connection.endpoint || "未填写"}</code></span>
            <span>上次测试：{formatTestedAt(connection.last_tested_at)}</span>
            <span>识别到 X 工具：{availableTools.length} 个</span>
          </div>
          {liveCheckNotice ? <p className="x-hub-diag-notice">{liveCheckNotice}</p> : null}
          <div className="x-hub-diag-actions">
            {connState === "disabled" ? (
              <button type="button" className="x-hub-primary" disabled={liveCheckBusy} onClick={() => void enableAndTestConnection()}>
                {liveCheckBusy ? <Loader2 className="spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
                {liveCheckBusy ? "启用并实测中…" : "一键启用并实测连通"}
              </button>
            ) : (
              <button type="button" className="x-hub-primary" disabled={liveCheckBusy} onClick={() => void testConnectionLive()}>
                {liveCheckBusy ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                {liveCheckBusy ? "实测连通中…" : "立即实测连通性"}
              </button>
            )}
            {onOpenDeviceCenter ? (
              <button type="button" className="x-hub-secondary-btn" onClick={onOpenDeviceCenter}>
                去 MCP 插件中心修改 <ExternalLink aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="x-hub-connection-card is-verified">
            <div>
              <span className="x-hub-card-kicker">VERIFIED MCP GATEWAY · 已启用且连通</span>
              <strong>{connection.name || "X / Twitter"}</strong>
              <small>{connection.endpoint} · 最近实测：{formatTestedAt(connection.last_tested_at)}</small>
            </div>
            <div className="x-hub-conn-actions">
              <button type="button" onClick={() => void testConnectionLive()} disabled={liveCheckBusy || loading}>
                {liveCheckBusy ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                {liveCheckBusy ? "实测中…" : "实测连通性"}
              </button>
            </div>
          </div>
          {liveCheckNotice ? <div className="x-hub-diag-notice" role="status">{liveCheckNotice}</div> : null}

          {availableTools.includes("search_tweets") && (
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
          )}

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

          {(availableTools.includes("get_user_tweets") || availableTools.includes("get_user_info")) && (
            <section className="x-hub-card" aria-labelledby="x-user-title">
              <div className="x-hub-card-heading">
                <div><span className="eyebrow">PROFILE</span><h3 id="x-user-title">查用户资料或时间线</h3></div>
                <User aria-hidden="true" />
              </div>
              <div className="x-hub-inline-form">
                <input
                  value={usernameLookup}
                  onChange={(event) => setUsernameLookup(event.target.value)}
                  placeholder="输入 X 用户名（不含 @，如 openai）"
                  aria-label="X 用户名"
                  maxLength={60}
                />
                {availableTools.includes("get_user_info") && (
                  <button
                    type="button"
                    className="x-hub-secondary-btn"
                    disabled={!usernameLookup.trim() || action === "get_user_info"}
                    onClick={() => void callXTool("get_user_info", { username: usernameLookup.trim().replace(/^@/, "") })}
                  >
                    资料
                  </button>
                )}
                {availableTools.includes("get_user_tweets") && (
                  <button
                    type="button"
                    className="x-hub-primary"
                    disabled={!usernameLookup.trim() || action === "get_user_tweets"}
                    onClick={() => void callXTool("get_user_tweets", { username: usernameLookup.trim().replace(/^@/, "") })}
                  >
                    看推文
                  </button>
                )}
              </div>
            </section>
          )}

          {availableTools.includes("post_tweet") && (
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
          )}

          <section className="x-hub-card" aria-labelledby="x-tools-title">
            <div className="x-hub-card-heading">
              <div><span className="eyebrow">TOOLS</span><h3 id="x-tools-title">已发现的 X 工具</h3></div>
              <small>{availableTools.length} 个</small>
            </div>
            <div className="x-hub-tool-list">
              {availableTools.map((name) => <span key={name}>{X_TOOL_LABELS[name] || name}</span>)}
            </div>
            {onOpenDeviceCenter ? <button type="button" className="x-hub-link" onClick={onOpenDeviceCenter}>在 MCP 插件中心管理连接 <ExternalLink aria-hidden="true" /></button> : null}
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
