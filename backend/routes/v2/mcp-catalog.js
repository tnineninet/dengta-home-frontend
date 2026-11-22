const express = require("express");

// Static catalog of self-hosted MCP apps that can be connected to DengTa's
// existing MCP device center. No secrets belong here: each row only describes
// how a user runs the upstream project and what endpoint/auth DengTa expects.
const MCP_APPS = Object.freeze([
    {
        id: "x-twitter",
        name: "X (Twitter)",
        summary: "通过 twikit 的 12 个工具读写 X：发推、回复、搜索、私信、点赞、转推等。",
        repo: "https://github.com/yxiy171866-boop/x-twikit-mcp",
        upstream_transport: "stdio",
        dengta_transport: "http",
        auth: "由你自己的 HTTP 包装层决定；推荐 Bearer 或随机 URL 路径，不要把 Cookie 直接放进 DengTa。",
        endpoint_hint: "https://你的域名/x-mcp/mcp（由 stdio→HTTP 包装 + 反代提供）",
        tools: ["post_tweet", "reply_tweet", "get_tweet_replies", "read_direct_messages", "send_direct_message", "search_tweets", "get_tweet_by_id", "get_user_info", "get_user_tweets", "favorite_tweet", "retweet", "delete_tweet"],
        steps: [
            { title: "准备 Cookie", detail: "登录 x.com，F12 → Application → Cookies，复制 auth_token 和 ct0。只保存在你自己的机器上。" },
            { title: "运行上游 MCP", detail: "git clone 仓库 → pip install -r requirements.txt → 设置 TWITTER_AUTH_TOKEN / TWITTER_CT0。上游默认是 stdio，不能直接填给 DengTa。" },
            { title: "转成 HTTP", detail: "用 supergateway 或 mcp-proxy 把 stdio 包成 HTTP/SSE，再放到 HTTPS 反代后面；随机路径或 Bearer 锁住，不要在公网裸奔。" },
            { title: "在 DengTa 连接", detail: "设置 → MCP 连接 → 添加：填包装后的 /mcp 或 /sse 地址和鉴权头，点「发现工具」，确认能看到 12 个工具后启用。" },
            { title: "验证", detail: "先只读工具（search_tweets/get_user_info），确认正常后再用发推/私信等有副作用的工具。" }
        ],
        security_notes: [
            "X Cookie 等同于账号密码，泄漏=账号被接管；不要上传到 DengTa 或任何公网服务。",
            "发推/私信属于不可逆外部动作，建议先只启用读工具。",
            "X 对自动化有风控，控制频率，不要批量关注/发帖/私信。"
        ]
    },
    {
        id: "netease-music",
        name: "网易云音乐 (music-mcp)",
        summary: "自部署网易云播放器 + 12 个点歌 MCP：搜歌、歌词、歌曲卡、插队播放、批注、评论、共享歌单。",
        repo: "https://github.com/Anko3o/Music-Mcp-Netease",
        upstream_transport: "http",
        dengta_transport: "http",
        auth: "上游默认本机无鉴权；公网部署请用随机 URL 路径或反代认证。不要把 MUSIC_U Cookie 填进 DengTa。",
        endpoint_hint: "https://你的域名/mcp-music-<随机串>/mcp",
        tools: ["song_search", "song_share", "lyric_read", "lyric_share", "song_memo", "memo_read", "her_recent", "her_netease", "song_comments", "song_listen", "playlists", "playlist_add"],
        steps: [
            { title: "部署播放器", detail: "clone 仓库；把 MUSIC_U 写入 server/.netease_cred；python3 server/music.py（默认 :9090）。" },
            { title: "启动 MCP", detail: "python3 mcp/music_mcp.py（默认 127.0.0.1:18012，HTTP 端点 /mcp）。" },
            { title: "公网反代", detail: "Caddy/Nginx 把 /mcp-music-<随机串>/ 反代到 127.0.0.1:18012；用 curl 确认不存在的 GET 返回 405，说明 MCP 已通。" },
            { title: "在 DengTa 连接", detail: "设置 → MCP 连接 → 添加：URL 填 .../mcp，鉴权按反代方式（随机路径可无额外 header），发现并启用工具。" },
            { title: "打开播放器", detail: "播放器页面必须在前台/后台存活才能接走点歌队列；手机浏览器请允许后台运行。首次访问带 ?token=server/.secret。" }
        ],
        security_notes: [
            "MUSIC_U 是账号凭据，只保存在播放器服务器。",
            "MCP 端点必须用 HTTPS/随机路径/反代认证，不能把 18012 裸暴露公网。",
            "该项目为 CC BY-NC-SA 4.0，禁止商用；二次分发需保留署名与相同协议。"
        ]
    }
]);

function createMcpCatalogRouter() {
    const router = express.Router();
    router.get("/", (req, res) => {
        res.set("Cache-Control", "public, max-age=300");
        res.json({ ok: true, apps: MCP_APPS });
    });
    router.get("/:id", (req, res) => {
        const app = MCP_APPS.find((item) => item.id === req.params.id);
        if (!app) return res.status(404).json({ ok: false, error: "mcp_app_not_found", message: "没有这个 MCP 应用。" });
        res.set("Cache-Control", "public, max-age=300");
        res.json({ ok: true, app });
    });
    return router;
}

module.exports = { createMcpCatalogRouter, MCP_APPS };
