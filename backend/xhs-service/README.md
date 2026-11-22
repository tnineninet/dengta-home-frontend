# 灯塔小红书服务

## 部署(Render Docker)
1. Render → New → Web Service → 连接仓库(新建 dengta-home-xhs 仓库,内容为本目录)
   或 Existing Image;Dockerfile 路径 xhs-service/Dockerfile。
2. 环境变量:
   - XHS_SERVICE_TOKEN:灯塔后端与服务的共享令牌(建议随机长串)
   - PORT:8080
3. 免费套餐选最小规格;磁盘需要持久化 /data(挂 Render Disk,约 1GB 即可)。
4. 部署后访问 /health 确认 ok:true。

## 灯塔后端接入(下一步)
- 迁移 053 建 xhs_connections 表。
- routes/v2/xhs.js:代理 /login/start、/login/status、/search、/notes/:id/comments、
  /notes/:id/like、/notes/:id/comment、/users/:uid/follow(带用户登录态,转发到本服务)。
- AI 工具:xhs_login / xhs_search / xhs_note_comments / xhs_like / xhs_comment / xhs_follow。
- 前端:扫码弹窗(复用 NeteaseQrLogin 模式,展示 base64 二维码并轮询 /login/status)。

## 已知限制与风险
- 登录二维码选择器、点赞/评论/关注按钮选择器为经验值,需要真机联调校准。
- 写操作有封号风险:限速 5 次/分,且 AI 工具设计为"必须先弹确认框"。
- xhs-api CLI 首次运行会用 uv 自举 Python 依赖(镜像已装 uv,约 1-2 分钟)。
