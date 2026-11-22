# DengTa 私人活动数据权限与小红书登录回执审查

基线：前端 b3f0faa3a288c2671207282c356f0c4a1900a87d，后端 fd27f65f920374049d72df5cf991fb44a486e0d0。本轮不修改提示词装配顺序、角色、用户个性化字段、历史或记忆。

## 根因与改动

生产元数据及安全检查确认 special_dates、daily_shots、compatibility_records、achievements、user_achievements、watch_events、interest_profiles、xhs_connections 共 8 张用户/伴侣私人记录表未启用 RLS，anon/authenticated 原有 SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 权限。前端通过鉴权后端路由访问；后端 service_role 加 user_id、companion_id 过滤。未读取真实用户记录。检查未找到依赖这些表的视图或静态函数引用（不等同于证明不存在动态 SQL）。

- 后端 supabase/migrations/20261001072028_private_activity_rls.sql:1：单事务启用 8 表 RLS、撤销客户端权限、保留 service_role CRUD 并建立服务角色策略；不修改行内容或字段。锁超时 5 秒、语句超时 30 秒，可重复执行。service_role 绕过 RLS，后端租户过滤仍必须保留。
- 后端 routes/v2/xhs.js:20：保存前检查读取结果，更新限定 id/user_id/companion_id，确认保存回执；错误码 xhs_storage_unconfigured/read_failed/write_failed/receipt_invalid，不暴露原始上游错误或凭据。
- 后端 routes/v2/xhs.js:109：过期 Cookie 分支重新从请求取得 scope，捕获保存失败并传给错误中间件，避免作用域变量错误和未处理异步异常。
- 后端 test/private-activity-rls.test.mjs:1：真实 PGlite 角色权限、全表客户端访问拒绝、服务角色 CRUD、重复迁移及原始行不变；意外重新授予表权限时 RLS 仍拒绝客户端访问。
- 后端 test/private-activity-routes.test.js:1：Express + 实际服务/路由 + PGlite SQL；虚构账户/伴侣隔离、纪念日、照片、自定义成就、契合度、观看/兴趣和加密 Cookie 保存，读写错误及缺回执。无关成就计数表使用零值夹具，外部小红书客户端为测试替身。
- 后端 test/multitenant-pglite.test.mjs:1538：迁移链末尾重复执行新增迁移，原有个性化快照断言继续验证不变。package.json test:achievements 接入新测试；前端仅版本 2.10.54/code102，后端 0.29.24。

## 验证命令

前端 npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android；后端 npm test、npm run check、npm run typecheck；Android android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug。执行记录及退出码位于 E:\chatgpt\artifacts\dengta-private-activity-20261001 的 *-checks.json、gradle-result.json 和日志。本报告不能替代最终回执；以 final-audit.md 为准。

## 适配与限制

不新增本地成人内容限制，也未将供应商行为归因为灯塔本地策略。13 个受保护提示词/聊天/设置/服务器文件与基线一致。无用户数据迁移、清理或删改。

数据库直接调用这些私人表的非灯塔第三方客户端将收到权限错误，这是预期访问收紧。外部小红书服务是否支持多账户独立 Cookie 尚未验证；服务外部登录成功后本地保存失败会如实报错，不能撤销已经发生的外部登录。

APK 构建不等于真机或生产端到端：原生单元任务可能 UP-TO-DATE，保留其既有 35 条/11 套结果。实际小红书服务、聊天供应商、生产多账号登录和全部功能端到端均未验收。已有函数 search_path 和密码检查告警不在本轮改动范围；1GB 分块上传仍待实现。

提示词当前装配（services/ai-service.js:385）：user_details 原文 → unified_system_prompt 原文（或 legacy system_prompt / additional_prompt / personality）→ 记忆 summary 原文 → knowledge 文件块；resolveGenerationPrompt 将该 agents.md 块插入应用 systemInstructions 最前。本轮保持该代码和顺序不变。
