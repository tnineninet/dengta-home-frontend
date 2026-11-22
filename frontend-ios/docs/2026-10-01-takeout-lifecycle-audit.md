# 2026-10-01 外卖执行与回执可靠性审查

本轮前端2.10.41 / versionCode89，后端0.29.17。任务：继续优化一起听歌、聊天模块调用与外卖体验，定位执行链路中的真实问题。代码修复和本地验证通过，生产状态以 artifacts 下最终报告的实时回执为准。不得把本报告等同真机、实际订单或整个软件全部验收。

## 根因与改动位置

- 后端 services/takeout-channel.js:105：领取之前先读状态、更新时仅按id；执行中状态也可再次领取。现在UPDATE同时限定命令id、用户、伴侣和pending状态，只有一条调用能变为executing，其余返回409/takeout_command_not_pending。
- 后端同文件:129、147、177、200：进度、成功、失败、取消原来没有原子状态约束。现在每次更新都限定账号和伴侣；成功/进度/失败只接收executing，取消只接收pending/executing。完成结果重复上报保持原结果；迟到的失败、取消、进度不能覆盖终态。失败回执不能结束未经领取的命令。没有修改数据库结构。
- 前端 src/takeout-executor.js:78、86：原生调用和结果POST原先共用catch，导致加购成功但上报网络失败时被改报执行失败。现在分开处理，结果同步失败返回takeout_result_sync_failed，不重复原生加购，不再发送失败回执。原生logged_out、verification、shop_not_found、over_limit、error、loading及无效返回分别显示固定原因/恢复操作，不回显原始错误文本。
- 前端同文件:170：轮询上锁原先发生在pending读取之后。现在读取之前上锁，停止时AbortController终止请求，领取后/原生返回后再检查是否仍属于当前作用域。本地尝试标记按账号/伴侣隔离。崩溃护栏恢复时先独占领取，不发送可能覆盖另一设备执行的失败回执。
- 前端 src/App.jsx:5398：执行器由账号和伴侣共同管理生命周期，停止旧轮询并清空旧操作反馈；显示结果已同步或具体原因与代码。
- 前端 src/operation-diagnostics.js:5、src/LocalDiagnostics.jsx:11：新增DT-TAKEOUT操作入口及白名单具体代码，外卖原生失败也记录账号/伴侣限定的本机诊断。仅技术代码、时间、位置、HTTP状态，不写输入、购物车、原始错误或凭据。
- package.json/package-lock.json、android/app/build.gradle:18、test/android-release.test.js:75：版本和测试入口更新，不改变依赖版本。

## 回归与实际命令

新增后端test/takeout-channel.test.js：PGlite真实SQL查询验证并发领取唯一、重复领取409、终态不被覆盖、取消和完成竞态、账号/伴侣隔离和成功结果幂等。
新增前端test/takeout-executor.test.js：真实执行器配合虚构API/原生返回，验证结果网络失败不误报执行失败、原生错误原因、无效指令/结果、慢轮询不重叠、领取后停止不打开页面、迟到原生回调不串作用域、标记隔离、跨设备护栏及诊断不存私密正文。

|目录|命令|退出码|
|---|---|---|
|后端|node --test test/takeout-channel.test.js|0|
|前端|node test/takeout-executor.test.js|0|
|前后端各自|npm test|0 / 0|
|前端|npm run lint|0|
|前后端各自|npm run typecheck|0 / 0|
|后端|npm run check|0|
|前端|npm run build:web|0|
|前端|npm run android:sync|0|
|前端|android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug|0|
|前后端各自|git diff --check|0 / 0|
|产物目录|node inventory.cjs、Python -X utf8 extract-apk.py、node verify-apk.cjs、node secret-check.cjs|均0|
|Android SDK|apksigner verify --print-certs、aapt2 dump badging、adb devices|均0；设备0台|

typecheck是项目现有JS/JSX静态检查，并非TypeScript编译。前端87、后端123个测试文件均已接入测试入口，完整测试命令退出0。构建仍提示桌宠运行时分包超过500kB及Gradle既有弃用警告，未宣称帧率已实测。

## 用户数据、提示词与安全机制

本轮未执行生产数据写入、清理或数据库迁移；没有账号真实API/外卖订单测试，全部新增样例虚构。保护文件与本轮Git基线内容相同（CRLF规范化比较，原始字节差异若存在为既有换行）：

- frontend/src/chat-errors.js：unchanged=true，SHA256 7ed2c188eb8f7f47e9ebbc4e57338b6b22e2adbf554ff3095fa4040eb43a249e
- frontend/src/chat-idempotency.js：unchanged=true，SHA256 6063aa575bcaa80b8936aa2b68d2aa16cffa725bbf5900addd26544ebc67816b
- backend/services/ai-service.js：unchanged=true，SHA256 e8068639957b20f51d8814421bf01516bde99752cb588b5873ba41c65202b9cd
- backend/services/persistent-memory-filter.js：unchanged=true，SHA256 550543f2f210de2cc25c26fc2f005deade4696b8c94860c2fce1472343daa3d2
- backend/services/provider-output-guard.js：unchanged=true，SHA256 35504e42507c08b7db4e957c3fb4c348f26b3dee16f64bc71fb046e218b03a2c
- backend/services/chat-stream-contract.js：unchanged=true，SHA256 b6157d1fdc895c2998e3c5756dfb7d970b4edce4f410285204f5e20606de9cd3
- backend/services/settings-store.js：unchanged=true，SHA256 1ca3e683e044df6bb7e3e052f7cf486d24688146634aed2801f7ba5835cac7f5
- backend/services/chat-request.js：unchanged=true，SHA256 11c827043119c1bf94a51f1f06ca455d602063fd8b8e5ae453e3cbd5dd9e7669
- backend/services/prompt-security.js：unchanged=true，SHA256 34d1b5f1f137ade5c613209e6468b6f349a8676b945d486ca32624f75f8a258e

实际主聊天装配以未修改的services/ai-service.js:600-690为准：unified模式user_details→unified_system_prompt→configuredParts（本轮授权附件指令等）→stableMemory.instruction→intimateExpressionInstruction→可见心声格式/本轮心声指令→世界书beforeMemoryInstruction。legacy模式configuredParts顺序为user_details→system_prompt→授权附件指令→additional_prompt→personality；之后同上。历史消息与动态参考插在最新user之前。契约dengta-prompt-contract-v8不变。这里记录现有代码，不按旧注册表概述重排提示词。

本轮问题是DengTa本地任务执行、竞态和回执呈现，不是成人内容拦截；没有更改本地内容过滤或供应商策略。外卖登录失效/验证是外部平台返回状态，DengTa只显示原因。认证、租户、工具授权与付款由用户确认的机制保留。

## APK与验收边界

- 文件DengTa-2.10.41-89.apk，36245069字节，SHA256 b88d8512571c9fe6351cfbfaa1597fdec31fd89de21d086c351f2a700916636f。
- 包名home.dengta.app，Android12+（minSDK31/targetSDK36），稳定debug签名；证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。
- APK提取89个assets/public资源，全部与本次dist一致；公有认证配置与生产后端地址存在；3个已配置私密值均未发现进入包。
- 内置浏览器getState可列出页面，绑定现有灯塔标签getTab仍30秒超时；没有创建替代标签，没有读取或修改账号私密内容。真机设备0台，真实外卖登录/搜索/加购/帧率、成人场景、Supabase管理面和生产供应商真实调用均未验证；多租户只做本地SQL回归，未做生产多账号验收。
- 已开始的原生WebView无法被当前插件从停止轮询中撤回；切换账号/伴侣后晚到回调不回传新作用域。已领取但客户端退出或网络回执丢失可能仍为executing，应先检查购物车，不能自动再次加购。本轮没有声称自动恢复全部原生执行状态。
- 外卖平台Cookie仍属于本机WebView；本轮未改变其既有登录存储设计，未声称与灯塔多账号隔离或登录永久有效。
- API兼容影响：旧客户端对executing重复领取及对pending直接失败回执会收到409，这属于重复执行保护。新客户端兼容既有takeout_commands表，无迁移。可用前端基线b05fb112cc2d43bd5ab78fa93fca86953bc87333、后端基线27e5f9f723d01f8b423039445cd72ef70c401a6e回退代码，但回退会重新引入竞态，不建议单独回退后端。
- GitHub/CNB推送、Vercel/Render生产及APK公开发布状态在最终artifact回执记录。Vercel连接器查询部署先404，按当前项目查询列表403，不能据此声明托管日志已扫描；仍可通过生产HTTP/构建文件哈希与后端版本/commit核对实际上线。

接口更新语义参照官方文档：https://supabase.com/docs/reference/javascript/update 。本轮已读当前changelog（2026-09-30最新条目），未涉及其中索引/加密扩展升级，也未变更托管配置。
