# DengTa Home Backend

DengTa Home（灯塔的家）后端服务 —— 一个围绕长期陪伴与连续对话的 AI 伴侣移动应用的服务端。基于 Express 5，数据层使用 Supabase（PostgreSQL + RLS），并转发语音分析、天气、TTS、MCP 设备等外部能力。

- **运行时**：Node.js 24.x
- **框架**：Express 5（CommonJS）
- **数据库**：Supabase（迁移 `000–041`）
- **入口**：`server.js`

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `server.js` | 服务入口 |
| `routes/` | HTTP 路由（含 `v2/`） |
| `services/` | 业务服务（聊天、语音、MCP、网易云、co-watch、world-book 等） |
| `supabase/` | 数据库迁移 `000–041`（按序执行） |
| `scripts/` | 辅助脚本 |
| `test/` | Node 原生测试套件 |

## 本地启动

```powershell
# 1. 安装依赖
npm ci

# 2. 准备环境变量（复制示例，填入真实值）
copy .env.example .env

# 3. 启动（默认端口 3000）
npm start
```

健康检查：`GET /health`（Render 用它做存活探针）。

## 环境变量

完整清单与逐项注释见 [`.env.example`](.env.example)。核心分组：

| 分组 | 关键变量 | 说明 |
| --- | --- | --- |
| Supabase | `SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_ANON_KEY` | 数据库连接与鉴权 |
| 认证 | `AUTH_REQUIRED`、`INITIAL_OWNER_EMAIL` | 全站认证开关与首任 Owner |
| 前端 | `FRONTEND_URL`、`PUSH_SECRET` | CORS 白名单与推送签名密钥 |
| 语音分析 | `HERVOICE_URL`、`HERVOICE_SECRET` | HerVoice 语音服务（只在内存转发，不落盘） |
| 天气 | `WEATHER_RATE_LIMIT_*` | 无密钥 Open-Meteo 代理 |
| 自然语音 TTS | `MINIMAX_API_KEY`、`MINIMAX_TTS_VOICE_ID` 等 | MiniMax TTS；未配置则回退系统朗读 |
| Ombre | `OMBRE_BRAIN_URL`、`OMBRE_MCP_TOKEN` 等 | 可选 Ombre Brain / MCP |
| MCP 设备中心 | `MCP_ENCRYPTION_KEY`、`MCP_DEVICE_TIMEOUT_MS` | 通用 MCP 连接（网易云等）；加密密钥 ≥32 字符 |
| 后台任务 | `BACKGROUND_JOBS_ENABLED` 等 | 默认关闭，待迁移 012–014 与租户隔离演练后启用 |

> 密钥只放部署平台环境变量，**不要提交到 GitHub**，也不要写进网页、备份 ZIP 或聊天。

## 命令

```powershell
npm start                 # 启动服务
npm run check             # 语法检查（node --check server.js）
npm test                  # 运行完整测试套件
npm run test:music-listening   # 网易云 / 音乐听歌相关测试
npm run test:co-watch          # 一起看 / 一起听相关测试
npm run test:world-book        # 世界书相关测试
npm run test:private-media     # 私密媒体相关测试
```

各子测试套件见 `package.json` 的 `scripts`。测试为 Node 原生 `node --test`，无需额外测试框架。

## 数据库迁移

迁移文件在 [`supabase/`](supabase/) 目录，按序号从 `000` 到 `041` 顺序执行：

- 新建库：从 `000_base_schema.sql` 依次执行到 `041_external_music_metadata_queue.sql`。
- 已在生产执行的迁移（如 `041`）**不要重复执行**；有 Supabase 管理权限时先只读核验历史、RLS 与 Advisor。

## 部署

部署配置在 [`render.yaml`](render.yaml)（Render Web Service）：

- `buildCommand: npm ci`，`startCommand: npm start`
- `healthCheckPath: /health`
- 敏感变量（`sync: false`）在 Render 控制台手动填写

## 安全

- 密钥（`.env`、Supabase Secret、MCP Token、TTS Key 等）一律不入库、不入聊天、不入报告。
- 网易云 Cookie 只存在于用户自托管 MCP 服务端，后端不接收、不保存、不显示 Cookie。
- 不绕过网易云版权 / DRM / 登录 / VIP / 防盗链。
