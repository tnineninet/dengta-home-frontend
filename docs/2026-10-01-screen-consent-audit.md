# 2026-10-01 屏幕共享授权、会话归属与临时截图专项

本轮基线：前端 main `6bb7e9040c143dbf834052708eda12f06fc11345`（2.10.44/92），后端 main `cd26e20acda6bf696645ede6c603abf0a6c7021e`（0.29.19）。开始时两工作树干净，无更深 AGENTS.md。本轮前端 2.10.45/93；后端源码和版本不变。沿用用户在当前任务中授权的推送、部署和 APK 交付范围。

## 根因和实际变化

原 App.startScreenGlanceSession 在系统授权前创建服务器会话，并把任意 active 会话作为 nextSession；取消共享授权时结束 nextSession。普通屏幕共享也可能结束听歌/视频。stopScreenGlanceSession 同样不检查模式。异步 finally 和原生授权回执缺少操作及账号归属验证，截图/预览持久文件没有记录归属。

| 文件与位置 | 行为变化 |
| --- | --- |
| src/screen-glance-lifecycle.js:3、32、90 | 被 App 实际使用的可测试控制器；同步锁、固定账号/伴侣、取消旧请求；先取得 Android 授权再创建服务器会话。对已加载的其他模式会话返回冲突；停止只结束 screen 会话。失败只回滚本次创建的会话，回滚失败保留记录并说明重试操作。请求回执验证 ID/状态/模式，重试沿用创建 ID。 |
| src/App.jsx:1245、1644、1767、1812、6020、6320 | 接入控制器和同步共享锁；状态读取、截图转换和发送前检查范围与操作版本；切换时释放临时草稿；旧反馈不写入新范围。浏览器可结束远端屏幕会话，只有原生端能启动系统共享。启动尚在建立中显示等待，明确 native lastError 显示失败。 |
| src/screen-glance.js:176、198 | 原生预览收到后再次核对账号/伴侣 scopeKey；截图同样验证 scopeKey，拒绝归属缺失的旧临时图片。未修改 buildScreenGlanceTurn。 |
| android/.../ScreenGlancePlugin.java:21、30、63、96、205、221 | 原生授权同步门、重复授权错误码；停止或身份变化后旧授权不能启动服务；启动/配置/停止核对前端预期身份。旧范围的停止请求不能取消新范围授权。 |
| android/.../ProjectionConsentGate.java:3 | 系统授权窗口保持单一租约，取消后等原窗口返回再释放 Capacitor 回调槽；只接收正确回调与归属。 |
| android/.../ScreenCaptureScope.java:3 | 无归属和归属不同的截图不得返回。 |
| android/.../ScreenGlanceService.java:105、384、389、431、701、776、802、1049 | 手动截图请求也固定账号/伴侣；截图、预览、最近回应保存范围元数据，读取与返回再次验证。未修改上传凭据、权限和租户保护。旧版无归属的临时截图/预览在读取时清除；不删除聊天、记忆或作品库。 |
| package.json、package-lock.json、android/app/build.gradle、test/android-release.test.js | 2.10.45 / versionCode 93；新的运行测试加入 npm test。 |

上述 android/... 相对于 android/app/src/main/java/home/dengta/app；准确当前源码可直接查同名文件。没有付费操作，没有使用 release JKS；APK 沿用稳定 Android Debug 签名。

## 保护范围及错误来源

本轮未改用户数据库、个性化字段、角色档案、记忆或提示词装配顺序。后端 ai-service、provider-output-guard、persistent-memory-filter、chat-stream-contract、settings-store、chat-request、prompt-security、server 和架构检查器，以及前端 api、chat-errors、chat-idempotency 与基线源码对比；规范化 CRLF，保留其他空白。最终回执记录 12 个文件的比较结果。ScreenGlance 的画面描述模板另外与基线比较不变。

这些是本地生命周期与技术身份错误；不属于成人内容限制，不涉及修改供应商策略或拒答规则。既有提示词装配代码未变，后端 check 的提示词架构保护检查退出 0。没有提交私密正文、模型密钥或用户原图；测试采用虚构身份和模拟服务。

错误码：screen_glance_operation_busy（等待进行中的操作）、screen_glance_scope_changed（在当前账号/伴侣重试）、co_watch_active_conflict（先结束已加载的听歌/视频）、screen_glance_identity_pending（后台身份同步后重试）、screen_glance_consent_busy（先处理原系统授权窗）、screen_glance_rollback_failed（结束并清除重试，服务器记录保留）、screen_glance_cleanup_failed（Android 常驻通知停止或再点结束并清除）、co_watch_receipt_invalid（刷新/重试，记录保留）。不通过删除正常会话掩盖失败。

## 测试与命令

前端 90 个 .test.js 测试文件全部接入 npm test；后端 125 个全部接入。新增 screen-glance-lifecycle.test.js 运行实际控制器，覆盖取消授权保留各模式、重复动作、跨范围迟到回执、创建后的配置失败、回滚失败、服务器停止失败及重试、旧停止不能清除新会话、创建 ID 复用、普通共享不继承 Together 开关、停止保留随机配置和操作顺序。原 source 检查调整到 App 的真实控制器接线，行为用运行测试验证；不是仅删除旧断言。新增 Android ProjectionConsentGateTest 与 ScreenCaptureScopeTest，共 5 个新用例。

| 目录 | 实际命令 | 最终结果 |
| --- | --- | --- |
| 前端 | node test/screen-glance-lifecycle.test.js、node test/screen-glance.test.js、node test/co-watch-experience.test.js | 各退出 0 |
| 前端 | npm test | 0 |
| 前端 | npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 各 0 |
| 后端 | npm test、npm run check、npm run typecheck | 各 0；后端没有 lint 脚本 |
| 前端 | .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 0；33 tests / 10 suites，无失败；flatDir 与 Gradle 弃用警告仍存在 |
| 前端 | git diff --check | 0 |
| artifacts/dengta-screen-consent-20261001 | python -X utf8 extract-apk.py、node verify-apk.cjs、node secret-check.cjs、python -X utf8 verify-native.py | 各 0；90 public assets 与 dist 相同，DEX 含新原生类及错误码，3 个私密配置值仅在内存比对，未发现暴露 |
| 任意 | E:/chatgpt/DengTa-production-tools/android-sdk/build-tools/35.0.0/apksigner.bat verify --verbose --print-certs E:/chatgpt/artifacts/dengta-screen-consent-20261001/DengTa-2.10.45-93.apk | 0，v2 签名有效；证书 SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6 |
| 任意 | E:/chatgpt/DengTa-production-tools/android-sdk/build-tools/35.0.0/aapt2.exe dump badging E:/chatgpt/artifacts/dengta-screen-consent-20261001/DengTa-2.10.45-93.apk | 0，home.dengta.app / 2.10.45 / 93 / min31 / target36 |
| 任意 | E:/chatgpt/DengTa-production-tools/android-sdk/platform-tools/adb.exe devices | 0，设备列表为空 |

开发过程曾出现 lint 的 cause 要求、Gradle 编译时 scopeKey 写入错误变量，以及 npm test 退出 7（旧源码断言位置/参数）；均修正并重跑对应测试及构建。没有把最初失败记录当作通过。本轮日志、辅助脚本和最终机器回执保存在 E:/chatgpt/artifacts/dengta-screen-consent-20261001。

APK 36,254,321 字节，SHA256 `653200c04cd8cd3212de1a5b7ab03304e4e2f09ce40e4e9ec83c5536d1cf2876`。Android 12+，稳定 debug 签名测试包。

## 验收与发布边界

本文件写入时：本地代码/测试/构建通过，尚未把本文件提交推送；最终 GitHub/CNB 代码与标签、APK 上传 digest、Render health 版本和网页入口 SHA 以 artifacts 目录 final-audit.md/final-state.json 的实际回执为准。不会将上传计划当成已发布。

没有数据库迁移、Supabase 管理面写入或新生产数据测试。内置浏览器 inventory 可读，但 getTab("2", browser "2") 30 秒超时并重置内核；真实账号交互未验收。无 adb 设备，Android 真机授权窗口、截屏、播放、系统通知和多账号端到端未验收。前后端自动化与 APK 静态校验不代表这些通过。

仍需后续专项：音乐会话操作的同步锁/范围与重试；后端会话替换的跨设备原子性（当前校验后退休再插入仍分两次写入）；原生配置保存/暂停的其他入口；真实 Android 设备与生产多账号测试。本轮仅阻止屏幕停止/取消误结束其他模式，不声称消除所有跨设备替换竞态。旧无归属临时截图被安全丢弃，需要重新取一帧；后台身份尚未同步会明确要求重试。整体长期目标保持进行中。
