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

认证深链：iOS native 使用 `dengta://auth`，精确校验目标/字段/重复项。Supabase 生产 redirect allowlist 及后端 CORS 对 `capacitor://localhost` 的实际允许状态需要另行只读核实/运行证据；本轮不改生产配置。APNs 后续需要真实开发者权限、key 与服务端通道；Simulator 编译无需索要这些材料。

依据：[Apple 相机说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nscamerausagedescription)、[麦克风说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)、[前台位置说明](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationwheninuseusagedescription)及已安装 Preferences README。上架前重新核对届时规范。
