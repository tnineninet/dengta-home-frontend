# DengTa 2.10.53 / code101：自动点歌交接

## 根因和修改

旧版本GET待播放列表后直接打开网易云，再POST结果。sessionStorage只在当前设备去重，另一台设备仍能读到同一条pending请求；领取租约若在原生打开后失效也会产生重复启动。本轮把副作用前的独占领取及交接确认放在服务器事务中。

前端src/ai-music-consumer.js:7 增加claim/commit两步，:15读入v1已有结果和v2分阶段技术记录；:34结果带同一delivery_token；:44先领取，记录commit后确认，只有fresh提交回执授权调用原生。opening阶段恢复或提交回执丢失只回传music_ai_open_unconfirmed，不自动再次打开；:70原生返回后保存旧身份结果，再检查scope，避免写到新账号。:74终止/过期请求不阻塞后续歌曲；:87先恢复未确认记录再拉列表。记录仅有请求/歌曲ID、随机交接ID、阶段、时间与固定技术结果，不存歌曲标题、聊天正文或原生异常。旧v1结果仍防止本设备重开。

src/music-listening.js:236要求claim-v1协议，:243/251新增领取/提交适配器；读写保留既有认证、伴侣作用域、取消信号和超时，写请求不自动重试，校验回执ID及明确状态。src/App.jsx:17/1079接入真实适配器和消费者。android/app/build.gradle:18/19为code101/name2.10.53；package.json和package-lock.json版本同步，test/android-release.test.js:75同步断言。

后端routes/v2/music-cookie.js:71拒绝旧协议自动播放（空列表、update_required），:90提供claim/commit/result；services/request-scope.js:158仅新增一个允许RPC，服务端强制注入账号/伴侣ID，客户端请求体不能改变租户。routes:113调用事务函数；:119映射固定原因、错误码、HTTP状态。未修改AI生成工具、提示词或其他音乐接口。

supabase/migrations/20261001064300_ai_music_delivery_claim.sql:1事务与5秒锁等待/30秒语句截止，:4新增3个nullable技术字段，:10收紧authenticated为只读，:13新增security invoker函数，固定空search_path；:28先按id+账号+伴侣锁定一行。领取60秒；尚未交接可过期重新领取，确认交接后永远不被另一个交接编号重领。重复提交返回replayed=true，重复结果不改processed_at；失败仅存两个固定技术码。:93函数仅service_role可执行。没有重写、删除既有请求或触碰其他业务表。

## 验证与数据保护

基线前端c243883bf6985c7b52127982f94e55d6f15a27dc/2.10.52，后端7bd54da3d6fd1fba3c8ac9532281bf3e1f8e78b1/0.29.22，开始时干净；新后端0.29.23。证据目录E:/chatgpt/artifacts/dengta-ai-music-claim-20261001。

test/music-delivery.test.js运行真实消费者/作用域，模拟服务回执和原生桥接，覆盖独立设备争抢、领取ACK丢失、交接ACK丢失、opening恢复、作用域切换、结果重传及终止请求。test/music-request-scope.test.js通过生产适配器验证32个接口方法认证/取消和回执；test/music-ai-results.test.js运行PGlite真实SQL+真实Express路由+真实RequestScope，验证重复迁移、原有行不改、authenticated权限收紧、并行HTTP领取、交接重放、过期领取、跨账号/伴侣及秘密错误正文不落库。PGlite串行化事务，不能替代真实Postgres并发测试。test/multitenant-pglite.test.mjs:1535补充整链之后两次增量迁移和人格字段原文保持断言。

生产Supabase项目nyyqizwrlmejpfdhgrnd已通过连接器应用ai_music_delivery_claim，元数据确认14列、RLS开启、客户端SELECT保留、UPDATE/TRUNCATE拒绝；函数invoker/空search_path，仅service_role允许。临时randomUUID账号/伴侣范围的一个虚构请求经真实Supabase HTTP并行领取，只有一方成功；提交重放、提交后领取过期不可接管、隔离及结果时间不重写均通过，finally限定三重ID删除并确认临时记录不存在。没有读取实际用户行，也没有修改用户聊天、提示词、记忆或个性化字段。实际登录多账号仍未验收。

12个受保护文件与基线逐个规范化CRLF比较均一致，包括server.js、ai-service、提示词安全、记忆/供应商结果守卫、settings-store、api/auth及聊天幂等/错误模块。实际装配仍由ai-service.js:3524 resolveGenerationPrompt选择业务plan，:3638把buildUserAgentsMdPlan原文置于systemInstructions最前并移除重复个性化块；后续业务plan/性别指令、会话消息和provider适配保持原先顺序。该顺序与用户字段保持回归通过。这次是本地自动播放副作用交接修复，没有新增成人过滤，也没有证明任何外部模型的成人兼容或处理策略。

| 实际命令/操作 | 结果 |
| --- | --- |
| node test/music-delivery.test.js；node test/music-request-scope.test.js | 退出0，随后全量再次覆盖 |
| node test/music-ai-results.test.js；node test/request-scope.test.js；node test/multitenant-pglite.test.mjs | 退出0 |
| 前端npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 最终均0；101个文件均接入脚本；第一次npm test因版本断言仍100失败，更新为101后重跑通过 |
| 后端npm test、npm run check、npm run typecheck | 均0；129个测试文件均接入脚本；静态JS typecheck不是TypeScript编译 |
| .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 0，unit任务UP-TO-DATE；既有35项/11套件0失败，未宣称原生重跑 |
| extract-apk.py、verify-apk.cjs、secret-check.cjs、verify-native.py | 0；90项资源匹配；新协议/错误码存在；3个私密配置值未进入APK |
| apksigner verify --print-certs；aapt2 dump badging | 0；code101/name2.10.53/min31/target36，稳定debug证书38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6；未用release JKS |
| Supabase apply_migration + execute_sql元数据 | success=true，增量schema和权限已验证 |
| node verify-live-delivery.cjs | 首次配置名只匹配SERVICE_ROLE而本项目使用SECRET_KEY，未发送测试；使用实际既有配置名后退出0，虚构记录已清理 |
| git diff --check / git diff --cached --check | 提交前检查；发布脚本包含二者，同步回执在final-audit |

APK36,266,929字节，SHA256 4fb1da08f54764dbe1a47e20c86103182de4228d377cfe998dd62f6707a0d731。上线、GitHub/CNB、tag、APK上传digest和下载权限必须以最终artifact回执为准，此文不把计划推送写成已上线。

## 边界与后续

旧客户端无协议轮询不再自动播放，需升级2.10.53；新客户端面对旧后端也不会绕过领取。手动Together入口仍保留。升级前已开始的旧原生动作无法撤销。已commit却设备关闭/本地记录丢失的请求可能长期等待结果；保守不自动重开，用户可手动检查。不能保证外部播放器exactly-once真实播放，也不虚构自动播放成功。

内置浏览器清单可读，但灯塔页面绑定20秒超时/kernel reset；未完成页面点击验收。ADB无设备，网易云/QQ真机、实际聊天供应商、Supabase网页管理面及全部功能体验仍未验收。Vercel连接器读取部署仍403，平台READY、构建和运行日志未验收；网站资源/Render版本只能证明发布一致性。音频单曲仍20MB，1GB分块、跨会话导入恢复另待实施。

Supabase Advisors前后相同：8张其他表未启用RLS（special_dates、daily_shots、compatibility_records、achievements、user_achievements、watch_events、interest_profiles、xhs_connections），53项RLS无策略、4项函数search_path、泄漏密码防护未启用；性能32项缺外键索引、26项RLS重复函数调用、17项未使用索引。既有告警不等同已证实数据泄漏，不擅自改其他表或认证配置；下一轮优先审查8张表的字段/权限和真实使用范围。[RLS告警修复说明](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)、[RLS函数调用优化](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)。本表两个原有RLS函数调用性能告警未改动。

回滚条件与关闭自动交接的办法记录在artifact/database-release-plan.md；没有执行回滚。整体长期目标保持active，不能称全部端到端通过。
