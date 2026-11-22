# DengTa 2.10.51 / 后端 0.29.22：歌单完整性与音乐授权刷新

## 根因与行为变化

歌单头部的 item_count 是预期数量，原列表没有查询实际保存的曲目数；详情直接返回部分曲目，播放与队列入口只核对曲目存在。这会把失败导入留下的头部误当成可用歌单。本次列表新增 saved_item_count/save_state；详情检查数量和连续位置，开始/切换一起听和新加入/替换队列前也核对完整性。错误为 music_playlist_incomplete（409）、music_playlist_positions_invalid（409）、music_playlist_receipt_invalid（502）。只有网易云零曲目且带外部歌单链接/编号的元数据歌单允许保留。不会修改、删除或补写旧歌单内容。

授权入口原来打开设置后仅等待1500ms检查一次。用户稍晚返回就错过检查；读取异常还会被当作未授权。本次用 Capacitor appStateChange 在返回前台时重新读取，提供重新检查入口、12秒截止、同步防重复打开、最新回执优先、迟到监听句柄清理。状态读取、打开设置、监听注册分别使用 music_notification_check_failed、music_notification_settings_failed、music_notification_listener_failed，提示不展示桥接原始异常。撤销授权后停止系统歌曲轮询，清除外部歌曲卡片，保留灯塔内部播放卡片。

Android 检查改用 NotificationManager.isNotificationListenerAccessGranted；读取异常调用 reject 并返回固定错误码。不再在这个入口额外请求 POST_NOTIFICATIONS；正常通知功能及 manifest 权限保持。用户仍需在系统设置自行授予通知使用权，不会自动扩大权限。

## 修改位置

| 文件与行 | 目的 |
| --- | --- |
| 前端 src/music-playlist-status.js:1 | 显示实际数量，识别不完整详情 |
| 前端 src/music-listening.js:126、404 | 保存状态兼容与详情回执核对 |
| 前端 src/MusicSettings.jsx:283 | 歌单列表显示实际保存情况 |
| 前端 src/TogetherMusic.jsx:328、889 | 精确读取错误与不可播放选项 |
| 前端 src/notification-access-monitor.js:7 | 生命周期、竞态、超时和监听清理 |
| 前端 src/use-notification-access.js:6 | React 生命周期接入 |
| 前端 src/device-activity.js:158 | 严格检查原生授权回执，旧调用保持兼容 |
| 前端 src/App.jsx:1074、1087、8589 | 实际授权/歌曲轮询/设置按钮接入 |
| 前端 android/app/src/main/java/home/dengta/app/DeviceActivityPlugin.java:488 | 系统授权检查与准确失败 |
| 后端 services/music-playlist-integrity.js:3、12 | 数量、位置与外部元数据判定 |
| 后端 services/music-listening.js:286、298 | 列表计数与详情验证 |
| 后端 services/co-watch-sessions.js:230 | 一起听选中歌曲的歌单完整性 |
| 后端 services/music-queue.js:152、171 | 加入/替换队列前验证；按唯一歌单读取位置，避免重复返回整份歌单 |
| 前端 test/music-playlist-integrity.test.js:1、test/notification-access.test.js:1 | 部分回执、旧接口、授权返回/撤销/竞态/超时等真实控制器测试 |
| 后端 test/music-playlist-integrity.test.js:1 | 真实默认列表、详情、启动和队列服务，真实租户包装器，虚构数据库结果 |
| 前后端 test/music-listening.test.js、后端 test/music-queue.test.js | 兼容新增字段；RPC合同测试显式注入空预检，完整性另由真实默认服务测试覆盖 |
| 前后端 package.json/package-lock.json、前端 android/app/build.gradle、test/android-release.test.js | 版本 2.10.51/code99、0.29.22，新增测试接入全量命令 |

## 验证与隐私边界

前端基线 e16c2a86c1429c55fcfdae7daec73b7f290c9e86，后端基线 fffcc9fca94ab360fe192e3ad3ee4a81c81e8245；开始时两仓库 main 干净。本轮没有提示词、模型路由、输出过滤或记忆代码变更，没有修改用户字段或装配顺序。后端 check 中现有提示词架构检查通过。最终校验还逐个比对12个相关保护文件与基线（仅规范化CRLF），并确认 supabase 目录无差异；没有数据库迁移。没有新成人内容限制，也没有新的供应商兼容/拒答来源实测结论。

生产数据库仅执行带不存在的虚构 user_id/companion_id 的只读查询语法探测：嵌入计数与父歌单位置关联均 HTTP200、返回0行。没有读取真实用户行、写入用户数据或修改 Storage 配置。此证据只说明查询语法/外键可用，不等于真实账号功能验收。测试全是虚构歌单和账号；生产凭据只在本机内存中使用，不写入报告。

实际命令与回执保存在 E:/chatgpt/artifacts/dengta-music-integrity-notification-20261001：

| 命令 | 结果 |
| --- | --- |
| 前端 npm test | 退出0；100个测试文件全部接入脚本；包含控制器和模拟React/HTTP用例 |
| 前端 npm run lint、npm run typecheck、npm run build:web | 均退出0 |
| 前端 npx cap sync android | 退出0 |
| 后端 npm test、npm run check、npm run typecheck | 均退出0；129个测试文件全部接入脚本 |
| .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 退出0；原生源码调整后重新执行单元测试任务；35测试/11套件/0失败；不包含真实Android授权测试 |
| git diff --check / git diff --cached --check | 发布前必须退出0，实际发布回执另列 |
| extract-apk.py、verify-apk.cjs、secret-check.cjs、verify-native.py | 退出0；90项APK资源与构建一致，未发现本机配置的私密凭据值 |
| apksigner verify --verbose --print-certs / aapt2 dump badging | 退出0；code99/min31/target36，稳定debug签名；非release JKS |

APK：DengTa-2.10.51-99.apk，36,606,407字节；SHA256 9b5049fc81dcb947d4e0509219f5e84e0d151b3d1f56c12147e4a8e064902b9e。证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。React test-renderer弃用提示及现有Gradle提示不是测试失败。

## 未验收与兼容性

内置浏览器本轮读取页面清单10秒超时并重置；ADB devices没有设备。没有截图/点击、真机、外部音乐App控制、生产实际音频导入、真实供应商、多账号端到端或Supabase管理面验收。此前Vercel管理API403/404没有在本轮重试；不能声称平台READY或运行日志验收。发布后的HTTP/版本/静态资源核对写入最终报告。

新客户端兼容旧服务器缺少save_state，显示“选择后核对”，详情仍核对数量；新服务器对旧客户端同样阻止新选择不完整歌单。列表计数不检查连续位置，详情/播放入口会检查。既有会话启动的幂等恢复及既有队列读取不主动迁移旧数据；播放更新使用真实选曲预检。加入/替换队列增加两次作用域查询，已按唯一歌单去重；并发修改后仍由原有RPC和外键约束保护，本次没有原子化新的预检。歌单被删除/变化后重试可能给出完整性/缺失错误，不能保证所有旧操作回执仍可重放。

音频上传仍20MB。关闭导入面板会丢失v50恢复入口，重新导入原文件会创建新的导入，不保证修复同一旧歌单。没有1GB断点上传、跨设备播放领取租约、自动迁移或自动清理残留。回滚可重新部署基线提交，无数据库变更需要回滚；不要删除用户歌单或降低认证保护。

依据：[Android NotificationManager](https://developer.android.com/reference/android/app/NotificationManager#isNotificationListenerAccessGranted(android.content.ComponentName))、[Capacitor App生命周期](https://capacitorjs.com/docs/apis/app)、[Supabase外键关联](https://supabase.com/docs/guides/database/joins-and-nesting)。

本文件为本地实现/验收报告，GitHub/CNB/Render/Vercel/APK真实同步状态见artifact最终回执。整体目标仍active，后续优先真机与多设备播放租约、大文件分块导入。
