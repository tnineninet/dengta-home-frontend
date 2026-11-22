# 2026-10-01 活动入口与网页共看审查

前端2.10.42 / versionCode90，后端维持0.29.17。本轮处理聊天活动入口的信息丢失、网页播放器空白、旧伴侣入口残留，以及误导性登录反馈。没有新增主聊天提示词或改变模型路由。

## 根因与修改

|文件位置|证据与行为变化|
|---|---|
|src/Together.jsx:627、634、641|后端services/page-embed.js:124-155返回embed_url/embed_likely_blocked/page_url，前端播放器、提示和链接用了embedUrl/embedLikelyBlocked。改用正确字段，iframe得到地址、兼容提示可见，外部链接指向原始页面。B站自身流式播放路径不变。|
|src/App.jsx:7915、7952、8040|watch和takeout忽略action.query；pendingCoWatchPage是未按伴侣区分的独立字符串。现在各模块准备带账号/伴侣的请求，发现页也复用此入口；传入关键词与页面URL同时限定作用域，新无URL请求不会继承旧的链接。|
|src/companion-activities.js:17、25|新增有界活动请求与作用域检查，接受已有活动类型及规范B站地址，不允许任意地址作为自动打开入口。没有更改后端工具契约或提示词。|
|src/Together.jsx:31-56、118、208、437、498|网页选择恢复原先只按账号区分，现在使用账号和伴侣共同的v2键。v1临时sessionStorage不删除也不推测归属，升级后需重新选择一次旧网页。数据库/历史会话不迁移。|
|src/ActivityQueryPanels.jsx:5、18与src/activity-query-panels.css|新增轻量影片搜索与外卖需求编辑区。平台关键词通过URL编码；普通一起看入口默认折叠，有本轮关键词时展开，正在共看时默认折叠。使用44px触屏操作、可换行按钮、键盘焦点和减少动态效果偏好；没有重动画或新增依赖。平台搜索打开新窗口，选中内容后用户复制分享链接到网页一起看，不伪称AI已找到/播放影片。|
|src/App.jsx:7456|外卖需求可编辑后追加到已有聊天草稿，保留既有草稿，由用户发送；不自动下单或付款。|
|src/App.jsx外卖登录状态、android/app/src/main/java/home/dengta/app/OrderBrowserPlugin.java:66|读取本机Cookie只能初步判断，原来声称登录永久有效。现在显示Cookie检测和重新登录/验证可能性，原生登录窗口标题改为外卖平台登录；不改变平台认证或Cookie存储。|
|package.json/package-lock.json、android/app/build.gradle:18、test/android-release.test.js:75|版本更新，测试入口加入新回归；依赖版本不变。|

## 测试与命令结果

新增test/activity-query-flow.test.js实际渲染React组件及Together：检查iframe真实src和外部href、内嵌提示、关键词编码和编辑、空关键词不生成搜索链接、外卖草稿追加不覆盖、入口不自动启动共看、用户明确点击后使用page_url、账号/伴侣限定请求及恢复、离开页面后迟到解析不能写入恢复记录。
更新test/together-requests.test.js：原测试没有传companionScope，增加新作用域要求及实际iframe地址断言，保留旧请求不覆盖新请求、停止清空恢复记录等断言。

|目录|实际命令|退出码|
|---|---|---|
|前端|node test/activity-query-flow.test.js|0|
|前端|node test/together-requests.test.js|0|
|前后端各自|npm test|0 / 0|
|前端|npm run lint|0|
|前端|npm run typecheck|0（项目JS/JSX静态检查，非TypeScript编译）|
|后端|npm run check|0|
|前端|npm run build:web|0|
|前端|npm run android:sync|0|
|前端|android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug|0|
|前后端各自|git diff --check|0 / 0|
|产物目录|node inventory.cjs、Python -X utf8 extract-apk.py、node verify-apk.cjs、node secret-check.cjs|均0|
|Android SDK|apksigner verify --print-certs、aapt2 dump badging、adb devices|均0；设备0台|

首次全量前端测试退出1：旧test/together-requests.test.js只提供账号，没有伴侣编号，新的作用域保护不保存其选择，断言失败。补齐虚构伴侣条件后，定向及全量均退出0，没有删掉或降低原有竞态断言。react-test-renderer有既有弃用提示；构建有既有桌宠分包563kB和Gradle弃用提示，未声称帧率已实测。
前端88、后端123个测试文件均接入入口。测试均虚构输入，不调用真实账号、真实搜索/订单或供应商模型。

## 提示词、用户数据与错误来源

无数据库迁移、生产数据更新/删除、记忆或个性化字段修改。后端所有代码本轮零diff；前端api.js、chat-errors.js、chat-idempotency.js不变。受保护的装配/过滤文件与基线一致：

- frontend/src/chat-errors.js：unchanged=true，SHA256 7ed2c188eb8f7f47e9ebbc4e57338b6b22e2adbf554ff3095fa4040eb43a249e
- frontend/src/chat-idempotency.js：unchanged=true，SHA256 6063aa575bcaa80b8936aa2b68d2aa16cffa725bbf5900addd26544ebc67816b
- backend/services/ai-service.js：unchanged=true，SHA256 e8068639957b20f51d8814421bf01516bde99752cb588b5873ba41c65202b9cd
- backend/services/persistent-memory-filter.js：unchanged=true，SHA256 550543f2f210de2cc25c26fc2f005deade4696b8c94860c2fce1472343daa3d2
- backend/services/provider-output-guard.js：unchanged=true，SHA256 35504e42507c08b7db4e957c3fb4c348f26b3dee16f64bc71fb046e218b03a2c
- backend/services/chat-stream-contract.js：unchanged=true，SHA256 b6157d1fdc895c2998e3c5756dfb7d970b4edce4f410285204f5e20606de9cd3
- backend/services/settings-store.js：unchanged=true，SHA256 1ca3e683e044df6bb7e3e052f7cf486d24688146634aed2801f7ba5835cac7f5
- backend/services/chat-request.js：unchanged=true，SHA256 11c827043119c1bf94a51f1f06ca455d602063fd8b8e5ae453e3cbd5dd9e7669
- backend/services/prompt-security.js：unchanged=true，SHA256 34d1b5f1f137ade5c613209e6468b6f349a8676b945d486ca32624f75f8a258e

主聊天顺序未改：ai-service.js:600-690 unified模式user_details→unified_system_prompt→configuredParts（本轮授权附件指令等）→stableMemory.instruction→intimateExpressionInstruction→可见心声格式/本轮指令→世界书beforeMemoryInstruction；legacy configuredParts为user_details→system_prompt→授权附件指令→additional_prompt→personality。历史与动态上下文在最新user之前；契约dengta-prompt-contract-v8不变。此前注册表概述与源码局部顺序有差异，本轮只记录源码，不重排。
本轮空白来自DengTa本地字段错误；网站自身内嵌策略、B站/爱奇艺访问或播放限制仍属外部平台。没有添加成人内容限制，未改变供应商策略。技术认证、租户、SSRF、工具授权和人工付款机制保留。

## 产物与真实验收边界

- DengTa-2.10.42-90.apk，包名home.dengta.app，Android12+，minSDK31/targetSDK36，稳定debug测试签名。
- 36247461字节；SHA256 107ab67c54b29da16addbe748fc9aed5d9ac2bdca3cbc371e5a1b59ad30c806e；证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。
- 提取90个assets/public，全与dist一致；公有认证/生产后端配置存在。3个已配置私密值未发现进入APK，无私密值写入报告。
- CUA绑定现有内置浏览器灯塔标签仍30秒超时，未创建重复标签、未读取私密账号字段。真机0台；视觉布局/真实FPS、平台搜索实际结果、内嵌播放、账号订单、Supabase管理面与生产多账号验收均未验证。
- 官方平台搜索URL当前检索：B站返回浏览器兼容页，爱奇艺页面无法由检索工具读取；因此只验收链接构造，不能声称外部搜索已实测可用。链接仍让用户以自己的浏览器和登录状态访问。平台付费/会员/地区限制不由此修改。
- 新作用域只覆盖本轮活动请求和网页选择恢复；既有视频直链临时恢复仍按账号，不能宣称所有播放器缓存均已按伴侣隔离。正在播放的会话不会因搜索自动替换。
- 外卖平台Cookie仍按本机WebView保存，本轮未改变其跨灯塔账号存储；已打开原生页面不能由切换伴侣撤回，延迟回执防护沿用2.10.41。
- 回滚基线前端8465863bdef74aadd568894a656b84cbb0ffede2、后端b5dd9db328ef11acffaa2de97b620b6b17fb1d91（后端不变）。旧网页sessionStorage保留，回滚可再读旧v1键；数据库不变。回滚前端会重新带回字段错误和旧入口残留。
- GitHub/CNB、Vercel、Render与APK实际同步状态以final-audit.md中的最终实时回执为准；本地通过不等同全软件或生产端到端通过。
