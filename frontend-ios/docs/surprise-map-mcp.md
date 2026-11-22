# 藏宝地图 MCP 接口

2026-10-20。把藏宝地图接到外部 AI 客户端（Claude Code / Claude Desktop / 自建 MCP 客户端），让 AI 在真实位置藏私人信、读取公开惊喜。

## 1. 端点与鉴权

- 端点：`POST /api/v2/surprise-map/mcp`
- 鉴权：`Authorization: Bearer <令牌>`
- 令牌在 App 的藏宝地图 → 右上角「MCP 接口」里生成，只显示一次；服务端只保存 SHA-256，可随时撤回。
- 令牌绑定当前账号 + 伴侣；不能跨账号读取别人的信或公开数据以外的内容。

## 2. 令牌管理 API（需要登录态）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v2/surprise-map/mcp/tokens` | 生成令牌，body `{label?}`；返回明文一次 |
| GET | `/api/v2/surprise-map/mcp/tokens` | 列出当前账号+伴侣的未撤回令牌 |
| DELETE | `/api/v2/surprise-map/mcp/tokens/:id` | 撤回令牌 |

## 3. JSON-RPC 方法

支持 MCP 的基础方法：

- `initialize` → 协议版本、tools 能力、serverInfo；
- `ping`；
- `tools/list`；
- `tools/call`；
- 通知（没有 `id`）返回 202。

## 4. 工具

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `hide_letter` | title、body、hint、lat、lon、radius_m、**confirm:true** | 在当前账号+伴侣的私人地图上藏信；服务端计算模糊范围，只存信件落点 |
| `list_letters` | limit | 列出自己的私人信：标题、提示、状态；不返回未拆开正文 |
| `list_public_letters` | limit | 列出公共惊喜：笔名、标题、公共地点、是否 AI 代笔；不返回正文/精确坐标 |

示例：

```bash
curl -s http://127.0.0.1:3000/api/v2/surprise-map/mcp \
  -H "Authorization: Bearer dengta_map_xxx" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hide_letter","arguments":{"title":"给路过的人","body":"今天辛苦了。","hint":"海边的长椅","lat":24.44,"lon":118.07,"radius_m":200,"confirm":true}}}'
```

## 5. 安全边界

- `hide_letter` 必须有 `confirm:true`，防止模型误把普通文段当成藏信指令；
- 令牌只显示一次、只存哈希、可撤回；
- 私人信正文不会通过 `list_letters` 返回；公开列表不含账号/伴侣 ID、精确领取坐标或正文；
- 领取仍必须由本人在真实位置用当次定位完成，MCP 令牌不能代替领取。
