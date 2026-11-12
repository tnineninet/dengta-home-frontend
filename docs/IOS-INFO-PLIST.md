# iOS 权限与配置

实际配置：`ios/App/App/Info.plist`、`PrivacyInfo.xcprivacy`、`capacitor.config.json`。用途说明存在不代表启动时请求权限，也不代表对应能力已运行验证。

| Key/配置 | 当前值/用途 | 原因 |
|---|---|---|
| CFBundleIdentifier | `home.dengta.app` | 保持指定 Bundle ID |
| CFBundleURLTypes | `dengta` scheme | `dengta://auth` 登录/恢复密码及已有 room 路由 |
| NSMicrophoneUsageDescription | 用户主动语音消息录音 | 当前 getUserMedia(audio) 入口；语音只评估 |
| NSCameraUsageDescription | 用户主动拍摄聊天附件 | WebKit 的 image/video 文件选择器可能提供相机入口 |
| NSLocationWhenInUseUsageDescription | 已开启天气/主动地图位置 | 现有浏览器 geolocation 路径仍然暴露；不申请后台位置 |
| NSPrivacyAccessedAPICategoryUserDefaults | CA92.1 | Preferences 的本机偏好及旧认证迁移，按已安装插件说明配置 |
| ios.loggingBehavior | `none` | 阻止 bridge 打印认证调用载荷 |
| ios.contentInset | `never` | Web CSS 负责 safe-area，避免 native/CSS 双重 inset |
| ios.preferredContentMode | `mobile` | 保持手机布局 |

未添加：APNs entitlement、keychain access group、伪造 application identifier/Team、后台定位/音频模式、NSLocationAlways、NSSpeechRecognitionUsageDescription、照片写入权限或 ATS 任意加载例外。现有录音上传到后端，不使用 SFSpeechRecognizer；HTML 系统文件选择器不等于任意读取/写入照片库。

Keychain 使用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`、`synchronizable=false`，仅允许三个认证键，不使用共享 access group。普通私人缓存尚未纳入 AccountVault；本文件不能代替 App Store 隐私标签/数据流审计。

认证深链：iOS native 使用 `dengta://auth`，精确校验目标/字段/重复项。Supabase 生产 redirect allowlist 仍待实际邮件回跳验证。2026-11-12T17:24Z 未认证 OPTIONS `/chat/stream` 对 `capacitor://localhost` 返回 204，允许 POST 和所需 Authorization/Content-Type/X-DengTa-Companion-Id headers；GET `/health` 返回 200 与同一 allow-origin。这只证明所测预检/HTTPS，不能证明已登录 SSE 或其他所有路径。本轮不改生产配置。APNs 后续需要真实开发者权限、key 与服务端通道；Simulator 编译无需索要这些材料。

依据：[Apple 相机说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)、[麦克风说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)、[前台位置说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationwheninuseusagedescription)及已安装 Preferences README。上架前重新核对届时规范。

## 认证、CORS 与 APNs 后续清单

| 项目 | 当前已做 | 未验证/后续动作 | 是否需要本轮生产修改 |
|---|---|---|---|
| 自定义 scheme | Info.plist 注册 `dengta`；exact callback parser、冷/热去重、隔离 token 验证与安全 seed commit | 在本地 Mac 打开真正注册/恢复邮件，检查生产 redirect allowlist 与恢复语义；不把 URL/token 写日志 | 否；若 allowlist 不匹配，仅提后续变更 |
| HTTPS/API 产物 | 显式已有 API URL、cleartext=false；build literal/source redirect 分别验证 | WKWebView 已认证请求实际目的地、Authorization/伴侣 header 和多段 SSE 的延迟/终止/取消 | 否 |
| CORS | 所测 OPTIONS/health 通过，含 capacitor origin、POST 与三种请求 headers | 实际 POST/SSE 和其他 endpoint；有问题时提交独立后端配置方案 | 否 |
| 前台本地通知 | 已安装官方 LocalNotifications；iOS 启动不主动弹授权 | 真机/模拟器显式授权、banner、点击路由和退出清理验收 | 否；不使用 APNs |
| APNs 身份/签名 | 未添加 entitlement/推送插件/后台模式 | 后续开发者 Team、应用 APNs capability、环境对应的签名和服务端 APNs key 管理 | 后置，当前不索要材料 |
| APNs token 与账号 | 当前后台安装注册明确为 Android，不能直接当作 iOS token 通道 | 单独设计 iOS 注册、token 轮换/失效、账号/伴侣绑定、退出撤销、点击路由与最小通知内容；测试开发/生产环境分离 | 需要另行授权后端工作；本轮不改 |

Apple Developer、APNs key、真机签名属于后续真机/分发依赖，不阻塞当前 Simulator 构建。核心业务验收目前需要可交互的本地 Mac；私人密码继续仅在本地使用。
