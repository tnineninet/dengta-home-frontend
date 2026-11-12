# Android → iOS 能力矩阵

范围 A 沿用当前业务实现；外部 2.10.74 不替换 2.13.43。这里只列源码/依赖审计结论，运行验证状态见 Phase 1 报告。

| 能力 | 当前实现 | iOS 策略 | 本轮状态 |
|---|---|---|---|
| 登录/恢复 | auth-js + 平台存储 | 自定义 Keychain + App 深链；Preferences 只迁移旧凭据 | 已实现，原生实测待 CI |
| POST SSE | `fetch` + `ReadableStream`，请求/伴侣 scope | 保持 WKWebView 的浏览器流；不启用 native HTTP interception | JS 协议回归；真实账号链路待验 |
| 人格/记忆/设置 | 当前 React/API + 保存 scope | 保留业务与大文本/退出前保存保护 | 回归测试；实机操作待验 |
| 剪贴板 | `@capacitor/clipboard` 8.0.1 | SPM 自动链接 | 原生编译已在 11b08ce/f8b8f51 通过；交互未验证，当前后续 SHA 待重建 |
| 生命周期/深链 | `@capacitor/app` 8.1.1 | 精确路由、冷/热启动去重 | JS 测试；邮件回跳待验 |
| 普通原生偏好 | `@capacitor/preferences` 8.0.1 | 保留普通偏好；认证仅读取/清理旧副本 | 已测试迁移/Proxy thenable 陷阱 |
| 语音消息 | Web getUserMedia + MediaRecorder | 评估现有 audio/mp4/.m4a 路径；显式麦克风用途说明 | 可行性评估，不是首版硬验收 |
| 语音播报 | 服务端音频，Android DeviceTts fallback | 保留网页音频；DeviceTts 有 Android guard | 未做 iOS 音频运行验证 |
| 前台本地提醒 | LocalNotifications 8.0.0 | 可使用 UNUserNotificationCenter；启动只查权限，用户主动授权 | 可行性与平台文案修正 |
| 后台主动提醒 | Android BackgroundNotifications worker | iOS 无同等周期 worker；APNs 后置 | 未接入，不承诺后台提醒 |
| Android 返回/重启 | AppNavigation | iOS 保留系统导航/网页重载回退 | 既有 guard 保留 |
| 系统活动/通知监听/位置采样 | DeviceActivity/DeviceSignals/Whereabouts | 无插件时 unsupported/default；不选择未经验证替代插件 | 后置 |
| 天气/地图定位 | 浏览器 geolocation | 保留显式能力与前台用途说明；不申请 Always/background | 可选能力未实测 |
| 相机/图片/视频附件 | WKWebView HTML file chooser | 系统选择器；相机用途说明，不新增照片写库权限 | 未实测拍摄 |
| 网易云外部播放 | Android NeteasePlayback | 缺插件明确 unsupported；iOS 不自动消费 Android 播放队列 | 已加能力 guard |
| QQ 云/AstrBot/更新 UI | 当前 2.13.x 业务 | 保留已有平台无关功能；APK 操作仅在支持平台展示 | 不回滚旧业务 |
| 屏幕感知/浏览器 Cookie/DLNA/视频提取 | 多个 Android 自定义插件 | 多数已有 guard；VideoExtractor 的非核心调用仍属后置差异 | 全量 Android 对齐未完成 |
| 分享/导出 | Web/native 混合 | 后置，未新增插件 | 不验收 |

SPM sync 已发现 App、Clipboard、LocalNotifications、Preferences 四个官方插件；自定义 Keychain 显式在 bridge 注册。不注册外部 AccountVault，不把缓存加密描述成已完成。

## 语音与前台通知可行性评估

以下是范围 A 的后续工作评估，不是本轮硬验收或已运行功能。

| 路径 | 已核对源码/能力 | 需要实际验证 | 后续选择 |
|---|---|---|---|
| 录音 | `voice.js` 探测 MediaRecorder/getUserMedia 与 MIME；含 `audio/mp4`，上传扩展名映射 `.m4a`；已有 650ms–60s 限制 | 真机麦克风授权/拒绝、AAC 音频上传与服务端解码、切后台/打断后停止 tracks | 先复用当前 WebKit 路径；失败后再评估原生录音插件 |
| 播放 | Blob/ObjectURL + Audio；play 拒绝显示触碰后重试，结束/错误释放 URL | 真机自动播放限制、静音/蓝牙/电话打断、回前台恢复 | 保留当前服务器音频；不承诺后台播放，不添加后台音频模式 |
| 本机 TTS | Android DeviceTts 使用平台 guard | iOS 没有原生 DeviceTts 替代方案实测 | 当前保持服务器音频；原生 TTS 后置 |
| 前台本地提醒 | LocalNotifications 已链接；iOS 启动仅 checkPermissions，用户点按钮才 requestPermissions；安装包 handler 的 willPresent 支持 badge/sound/alert | 授权/拒绝后恢复、前台实际 banner、点击路由及账号切换；当前 schedule 未提供 iOS sound 文件，不能承诺有声音 | 不需要 APNs；保持可选能力，补真实 iOS 交互后再验收 |
| 退出清理 | 外部 P1 线索需独立复现；本轮未完成 iOS pending/delivered 通知统一清理验收 | 调度后退出/切账号/杀进程重启，检查 pending 与 delivered；排查迟到轮询结果 | 后续按账号/会话记录通知 ID，清除 pending/delivered 并封闭旧调度；不能从匿名 CI 推断清理通过 |

WebKit 的[原始 MediaRecorder/WKWebView 说明](https://webkit.org/blog/11353/mediarecorder-api/)说明了 MP4/AAC 与原生采集能力/用户授权前提；这是历史官方能力依据。当前实现仍用运行时 MIME 探测，iOS 26 的录制/播放成功必须另取实际证据。官方页面在 2026-11-12T18:25Z 读取为 HTTP 200，缓存位于仓库外 `webkit-mediarecorder.html`。LocalNotifications 能力以锁定的 8.0.0 README/Swift handler 为本次源码依据。

依据：本仓库 `src/`、Android 插件与 npm 包 Swift 源；[Capacitor Preferences](https://capacitorjs.com/docs/apis/preferences)、[WebKit MediaRecorder](https://webkit.org/blog/11353/mediarecorder-api/)、[WebKit iOS 文件选择器](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm)。具体依赖锁定于 package-lock.json。
