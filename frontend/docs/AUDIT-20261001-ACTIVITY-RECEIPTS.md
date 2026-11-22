# DengTa 观看记录重试与照片保存回执审查

基线：前端 1f1665a550a9a4d1f6fc125d208af055482f1726 / 后端 13298600c0937a2e1178fa999cb58d0162a5ebae。新版本前端 2.10.55/code103，后端 0.29.25。

## 根因与代码变化

- 后端 services/interest-engine.js:58：原有 insert 失败仅打印原始错误并返回 false；兴趣档案写入错误被忽略，导致成功状态不准确。新流程确认观看保存回执；request_id 以账号/伴侣为作用域生成稳定主键，ON CONFLICT DO NOTHING 保留原记录，重试核对内容后复用记录，改变内容的重试返回 watch_request_conflict。没有 request_id 的旧调用仍可用，但无法保证跨请求去重。
- 后端 services/interest-engine.js:49：同一进程、同一账号/伴侣的兴趣刷新串行处理；不同作用域独立。观看已经保存而兴趣更新失败返回 recorded=true、profile_updated=false 和稳定 warning code，使用同一请求恢复，不把两阶段误报为全成功或全失败。
- 后端 services/interest-engine.js:101：兴趣档案按原有唯一 user_id/companion_id 冲突合并，确认 id 回执；不再先查是否存在再写，正常首次记录的数据库请求路径从 4 次减为 3 次（代码路径计数，不是延迟实测）。读取历史和档案分别返回准确错误。
- 后端 services/daily-shots.js:30：读取当天照片出错时停止保存，不误当新记录。更新加 id/user_id/companion_id/shot_date 条件，核对返回记录作用域与日期；并发首建的 23505 返回 daily_shots_changed，缺回执提示刷新确认，读取/保存/历史失败分别返回错误码。
- 后端 routes/co-watch.js:35：使用已保存的 session 标题、媒体地址和 session id 作为请求编号；listening 记为 music，其余 video；无标题屏幕会话不创建空记录。后台保存保持不阻塞播放器；部分失败记录技术错误码，无原始正文、Cookie、URL或令牌输出。后台 warning 暂未增加 UI 重试入口，不能宣称所有失败已直接显示在播放器。
- 后端 test/private-activity-routes.test.js:1：真实 PGlite/Express/服务/路由覆盖并发重试、内容冲突、账号/伴侣区分、缺回执恢复、兴趣部分失败、照片读取失败不写入、更新作用域及实际唯一约束冲突。PGlite DATE 在测试适配器转换为 PostgREST 日期字符串，非生产字段改写；无关成就指标使用零值夹具。
- 后端 test/co-watch-interest-delivery.test.js:1：已保存会话属性、音乐分类、空标题跳过、后台不阻塞、稳定错误码脱敏。该测试以会话服务替身隔离 HTTP 外部调用，不代表生产播放器验收。新增测试接入 test:achievements/root npm test。前端本轮仅版本与报告更新。

## 提示词和数据保护

本轮没有成人内容、模型供应商或提示词装配改动。13 个保护文件与基线一致；daily-shots 和 interest-engine 的 buildContext 函数内容分别哈希校验不变。原有用户 agents.md 装配 user_details → unified_system_prompt（或 legacy system_prompt/additional_prompt/personality）→ memory summary → knowledge 文件块，resolveGenerationPrompt 插入 systemInstructions 最前，本轮不变。没有迁移、权限改动、历史数据清理或用户个性化字段改写。

生产虚构记录验证只在随机新 user_id/companion_id 的空作用域进行：6 项实际 Supabase SDK/当前服务代码测试，包括并发一条、同 request_id 的 3 个作用域各自隔离、内容冲突不覆盖、模拟兴趣写入失败后的恢复、兴趣计数与照片替换；清理确认 3 个作用域的观看/兴趣/照片记录均为 0。真实用户数据没有读取或修改。此项是生产数据库+服务验证，尚未覆盖生产鉴权中间件、真实账号 JWT、浏览器或 Android。

## 命令与结果记录

node test/private-activity-routes.test.js、node test/co-watch-interest-delivery.test.js 定向通过。完整前端 npm test/lint/typecheck/build:web/cap sync，后端 npm test/check/typecheck、Gradle unit/assemble、APK解包/证书/秘密校验结果在 E:\chatgpt\artifacts\dengta-activity-receipts-20261001；最终退出码见 final-audit.md。首次完整任务进程中断，frontend npm test 返回 Windows 1073807364，backend 没有终态结果，未当作通过；确认原句柄不存在且无对应运行进程后才重跑。

资料：[Supabase upsert 官方文档](https://supabase.com/docs/reference/javascript/upsert)，本机 SDK 和生产实际返回值均验证了当前兼容性。Supabase 当前 changelog 200，无本轮 schema 变更。

## 局限与后续

同一稳定 request_id 的去重持久化在数据库主键，可跨后端实例；兴趣刷新串行队列仅在单进程内，跨实例并发可能暂时展示旧的派生兴趣，后续同一请求重试或新记录会刷新。当前一起看记录在会话创建/恢复时写入 watched_seconds=0，不能声称已准确采集实际观看时长或每首换歌。未来可增加专门的观看进度事件、可见的后台保存重试状态。

没有清理旧版本重复或空标题记录；同一会话若以后标题改变，旧请求编号会返回内容冲突而不覆盖原记录。旧调用不传 request_id 时仍可能重复。真机、生产真实账号/多账号登录、外部歌曲/影片实际播放及供应商聊天均未验收；Vercel 管理前轮 403 本轮未重复请求，管理 READY/logs/drains 仍未验收。APK 调试签名沿用，原生 unit 可能 UP-TO-DATE，不冒充重跑。1GB 分块上传仍待实现。

回滚：前端退回 1f1665a550a9a4d1f6fc125d208af055482f1726、后端退回 13298600c0937a2e1178fa999cb58d0162a5ebae；无需回滚数据库结构，旧版本仍能读新增记录，但会失去新错误反馈与重试去重。发布前后实际同步与回执以 final-audit.md 为准。
