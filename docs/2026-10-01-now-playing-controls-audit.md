# 2026-10-01 歌曲卡片操作与原生回执审查

前端2.10.49/97，基线4818319a96422dc54cd9aa757d8628f8efccb906；后端0.29.20，基线c4d70ba12a316ff904637d81c2bb20f6a3721b0f，源码未修改。开始时两仓库main且干净。本轮沿用用户当前连续任务中明确授权的完整测试、构建、推送及部署；未扩大仓库访问权限，没有使用release JKS。

## 根因与修复

原App把原生播放/暂停指令放在React状态updater中，可能被重复调用；无论原生是否接受都乐观反转状态。下一首忽略布尔回执、直接删除卡片并提示成功。原生查询使用getActiveSessions(null)，通知授权路径可能SecurityException；找不到当前播放器时尝试列表第一项，可能控制另一应用。仅凭媒体通知默认isPlaying:true，暂停后仍可能假显示播放。按钮嵌套在按钮内且整体aria-hidden；收起歌曲每轮都会重新弹回。封面处理回收了通知/元数据提供的共享Bitmap，后续读取可出错。

| 实际修改位置 | 行为变化 |
| --- | --- |
| frontend/src/now-playing-controls.js:3、7 | 实际controller，固定账号/伴侣token、同步锁、等待原生回执后读取播放器；不预先修改状态/删卡。相同播放器、曲目和已知状态才确认播放/暂停，换播放器不能确认切歌。旧scope结果丢弃，错误经既有脱敏辅助函数显示。 |
| frontend/src/App.jsx:15、1070、1112、1151、1157、9413 | 指令移出updater，绑定控制器、忙碌状态；切身份清空旧卡片/忙碌。收起后同一歌曲不立即弹回，变化比较含包名；保留原独立AI点歌轮询。 |
| frontend/src/device-activity.js:102、131 | 状态标准化含sessionId/playbackStateKnown。控制桥校验操作和目标，返回submitted:true，仅表示提交；失败固定music_control_permission/session_changed/unsupported/invalid/failed/unavailable，不展示原始native错误。 |
| frontend/src/NowPlayingCard.jsx:3；src/CompanionStatus.jsx:37、385 | 将歌曲胶囊拆为非button容器，各按钮为同级可访问控件；等待期间禁用播放/切歌并显示忙碌，无包名目标时不可误控，标题按钮仍可开关动态面板。未知状态显示“播放状态待确认”。 |
| frontend/src/apple-high.css:531 | 忙碌透明度、focus-visible轮廓、标题样式、减少动态效果偏好；没有改太阳/月亮和背景。没有实际FPS提升测量。 |
| frontend/android/app/src/main/java/home/dengta/app/DeviceActivityPlugin.java:302、450、514、559 | 正确传通知监听ComponentName，通知优先查真实同应用会话；无状态只给未知。控制时重新匹配包名/标题/歌手/可用sessionId，检查PlaybackState动作支持，不任意回退到另一播放器。目标校验不生成封面；缩略图只回收自己新建的位图，不回收提供方共享位图。 |
| frontend/android/app/src/main/java/home/dengta/app/NowPlayingControlPolicy.java:3 | 可测试的曲目/应用匹配和动作支持判断；没有读取用户内容或设置新授权。 |
| frontend/test/now-playing-controls.test.js:1 | 实际controller/桥函数及真实React卡片配虚构设备端口：连点、失败/未确认、下一首保留、换播放器、跨scope迟到、私密错误、notification未知状态、按钮无嵌套/读屏可见/禁用。App绑定采用源码断言，不是假装完整App端到端。 |
| frontend/android/app/src/test/java/home/dengta/app/NowPlayingControlPolicyTest.java:3 | 2项JUnit验证错应用/错歌曲/错歌手/空目标及未支持动作。 |
| frontend/test/mobile-chat-shell.test.js:13；test/intimate-duel.test.js:100 | 更新旧源码结构断言以适配歌曲卡片；其他成人模块测试及提示词未改。 |
| frontend/package.json:4、package-lock.json:3、android/app/build.gradle:18、test/android-release.test.js:75 | 前端2.10.49/code97；新测试接入既有device-activity测试。依赖版本不变。 |

通知监听组件的权限要求依据[Android官方MediaSessionManager文档](https://developer.android.com/reference/android/media/session/MediaSessionManager)。第三方播放器支持哪些动作由其媒体会话决定；提交成功并不保证它已经执行或有声音，App会根据随后观察到的状态区分反馈。

## 数据、提示词与外部边界

没有生产数据库读写、SQL迁移、清理、用户字段保存或聊天/记忆改写。新增测试全部为虚构样例；原始native错误不显示/保存。前端api.js/chat-errors.js/chat-idempotency.js与后端9个保护文件在最终审查按Git基线规范化CRLF逐字核对（final-state.json）。本轮不新增成人内容检查，不调用模型，没有证据推断外部供应商拒答。本轮根因是本地播放链路；外部播放器的授权、动作支持和真实播放仍由供应商/系统决定。

冻结提示词顺序保持：用户详情与统一/legacy个性化原文首块，既有附件授权/亲密表达、长期记忆与稳定记忆、运行参考数据、可见心声格式、世界书、历史及动态上下文仍按既有契约装配。没有改变角色、注入顺序、长度、选择条件或业务优先级。

## 实际验证及限制

日志和回执：E:/chatgpt/artifacts/dengta-now-playing-20261001。

| 实际命令 | 退出码/结果 |
| --- | --- |
| frontend node test/now-playing-controls.test.js | 0；真实函数/React组件配模拟设备。 |
| frontend npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 最终各0；97个test文件均接入。首次两次完整检查因两项旧结构断言失败，更新后通过；未隐藏初始失败。 |
| backend npm test、npm run check、npm run typecheck | 各0，126个test文件均接入；后端无lint脚本。提示词架构守卫通过。 |
| frontend .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 各次0；Java本轮实际编译、35用例/11suites实际执行过；最终只更新资源的构建unit UP-TO-DATE，不能称每次都重跑。 |
| Python -X utf8 extract-apk.py；node verify-apk.cjs；node secret-check.cjs；Python -X utf8 verify-native.py | 最终各0；全新apk-public-49-verified目录90资源匹配dist；最终“播放状态待确认”存在，DEX既有保护及新控制标记存在。3个私密配置值只内存扫描，未见打包暴露。 |
| apksigner verify --print-certs；aapt2 dump badging | 0；home.dengta.app，2.10.49/code97，min31/target36；稳定debug证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。 |
| 前后端 git diff --check | 最终各0；CRLF提示为环境警告。 |
| adb devices | 0，未连接设备；无真机安装或FPS测量。 |
| CUA现有灯塔tab绑定 | 35s超时、kernel reset；清单可读但页面操作未验收，无重复创建tab。 |

最终APK：DengTa-2.10.49-97.apk，36,603,927字节，SHA256 55216263050f1d8dc8b8f4ebf7a2d17c5762531cd804e8d01148916ab9686457。Android12+，稳定debug测试版，未使用release JKS。构建过程中检查尚未结束时曾生成早期包，最终在完整checks结束后重新构建；仅最终SHA可供验收。尝试移除临时解包目录被工具策略拒绝，改为新目录解包，不删任何旧文件，不影响最终产物。

GitHub/CNB推送、标签、Vercel公开资源字节与Render健康版本以最终实时回执附录为准。仓库历史为private，不更改可见性；GitHub下载需要有权限的账户。数据库管理面、实际模型工具调用/网易云播放、通知授权来回切换、Android真机、多账号生产隔离和帧率仍未验证，不能声称所有功能端到端全部通过。

兼容性：同步网页前端/新版APK；旧原生桥没有固定目标支持，网页不声称能控制外部系统播放器。没有会话/动作能力时明确失败供用户去音乐App操作。操作锁针对同App实例，不保证另一设备或第三方播放器恰好同时切歌时的全局原子性。

后续可做趣味“选歌理由/试听卡”，但尚未实现。下一步优先检查上传成功后歌单失败的恢复与幂等、跨设备点歌领取、co-watch替换原子性，以及真实权限/播放验收。整体目标继续active，本轮只完成此项可交付修复。
