# 2026-10-01 听歌导入与聊天活动入口审查

版本：前端 2.10.39 / Android 87；后端 0.29.16。基线前端 9d0e21887d2b706591f43f7f52c793fa0c746a69，后端 1f1205dbe150e961b744f7f5f3665b3cc8a6a650。

## 根因与行为

嵌入式 MusicSettings 原先保存后只刷新自己的列表，没有把新歌单传给 TogetherMusic；活动入口元数据还需要穿过 publicMessage 的字段白名单，否则模型调用成功后前端也看不到。现有 BILI_RECOMMEND 是灯塔兴趣搜索，不能代表当前 B站账号首页。本版为首页推荐新增独立、认证的读取路径，失败不会伪造推荐。

- frontend `src/MusicSettings.jsx:32`：导入保存后通知播放器；同一时刻重复提交只保存一次；播放器刷新失败不冒充保存失败；简洁导入面板隐藏已保存歌单的大量音频预览。
- frontend `src/MusicImportDialog.jsx:5`：Portal 弹窗、焦点恢复、背景滚动锁定、Tab 循环、Escape 关闭与保存期间关闭保护。
- frontend `src/TogetherMusic.jsx:683`：导入成功立即选中新歌单；网易云已连接时按聊天活动提供的歌名自动搜索一次；搜索晚回执忽略。删除外部播放器的模拟进度，改为明确手动同步。
- frontend `src/App.jsx:4773`：仅当前成功保存的聊天完成回执打开活动；历史消息只显示可点击卡片。音乐请求绑定账号和伴侣。
- frontend `src/ChatMessage.jsx:351`：聊天展示音乐、一起看、外卖和 B站视频入口。
- frontend `src/Together.jsx:100`：活动音乐请求传递给播放器，新请求以 id 区分。
- frontend `src/companion-activities.js:3`：入口类型白名单、数量和文字长度限制、BVID 去重并重建官方链接。
- frontend `src/companion-activities.css:1`：简洁活动卡片、触控按钮和键盘焦点样式。
- frontend `src/together.css:532`：响应式导入面板，只用位移和透明度入场；遵守减少动画偏好。
- backend `services/companion-activities.js:5`：新增应用活动工具；每轮独立、两项上限、并发去重；只准备入口，不执行订单或付款。
- backend `server.js:2752`：正文/语音工具注册和成功回复保存活动回执。语音界面的自动跳转未实现，本版不宣称语音自动进入模块。
- backend `services/chat-attachments.js:769`：修复公共消息字段白名单遗漏，保留经过净化的 assistant 活动回执；不公开凭据或未知字段。
- backend `services/bilibili-qr-login.js:457`：读取当前账号、伴侣保存的加密 Cookie，用 WBI 签名读取首页推荐；规范视频链接、12 秒请求超时、过期/风控/签名错误分类。
- backend `routes/co-watch.js:272`：新增需要真实认证作用域的推荐读取路由，private,no-store；不读其他账号连接。

## 提示词与数据边界

未改动用户保存的字段、数据库、长期记忆和 Kiwi 服务。未新增成人主题限制。services/ai-service.js、settings-store.js、persistent-memory-filter.js、provider-output-guard.js 等相对基线内容校验均 unchanged=true；原有提示词装配顺序、角色和优先级保持不变。仍为原有最高应用级个性化指令与用户详情、原有角色/记忆与历史、运行时上下文及工具结果、当前用户消息的各自装配路径，工具定义增加不改变这些字段顺序。未逐条读取用户私密内容。外部模型是否选择工具、B站登录/风控/版权能力由供应商决定；本地测试不代表供应商策略改变。

## 验证命令与结果

所有下列必要命令退出码 0：

- 前端 npm test（86 个已接入测试文件）、npm run lint、npm run typecheck、npm run build:web、npm run android:sync、git diff --check。
- 后端 npm test（122 个已接入测试文件）、npm run check、npm run typecheck、git diff --check。最终错误文案修改后定向 npm run test:companion-activities 再次通过；新增 HTTP 路由认证测试后该套件 5 组通过。
- 前端新增组件导入/保存后通知/刷新失败/立即选中/保存期 Escape 保护/自动搜索去重测试；最终 npm run test:companion-activities 与 lint 通过。
- Android .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug。
- apksigner verify --verbose --print-certs、aapt2 dump badging；home.dengta.app，versionName 2.10.39，versionCode 87，minSDK31、targetSDK36，稳定 debug 签名。
- extract-apk.py、verify-apk.cjs、secret-check.cjs、inventory.cjs：89 个 assets/public 与最终 dist 无差异，3 个配置私密值未暴露，全部新增测试已接入 npm test。

一次误在后端运行 npm run build:web 退出 1，原因是后端没有这个脚本；后端不需要 Web 构建，已运行真实 check/typecheck/全量测试。Web 构建在前端执行并通过。Web 构建仍有原有大于 500 kB 的分包警告，Gradle 有原有弃用警告；不能据此宣称无任何警告。日志保存于 E:\chatgpt\artifacts\dengta-music-activities-20261001。

## 验收限制与发布

已连接 Android 设备 0；真机安装、音频播放、动画帧率、多人观影未验证。CUA 接入已有登录标签再次 30 秒超时，真实账号模型调用、B站个性化推荐和浏览器布局未验证。数据库迁移 0；Supabase 管理面、真实多账号端到端未验证。自动化用虚构数据覆盖租户隔离，未改用户数据。外卖仅现有模块入口，用户自行选餐下单；不自动付款。一起看入口不提供电影版权来源；B站视频网页由现有一起看处理。活动卡片等待完整成功回复保存后出现，正文沿用现有流式链路；本版不宣称消除了上游首字延迟。

APK SHA256：e281a1e20f3d6a157816a695bd8c8f73f5ee8945a0670f48a56429352ef103f0；大小 36243025 字节。GitHub/CNB、生产探测与发布结果由本轮 external receipt 文件记录；提交前此报告不将尚未推送/上线写为已完成。无需数据库回滚；代码回滚使用上述对应基线正常新提交，不能强制推送或清理用户数据。
