# 手机聊天输入区位置修复（2026-11-13）

用户在 iPhone 和其他 Android 手机上观察到输入框偏高。修复应用于共用手机布局，不依赖 iOS 专用样式。

## 原因与处理

- `force-mobile.css` 对全部手机 main-panel 强制预留 `84px + safe-area` 底部导航空间；聊天页没有这条底部导航，却仍继承预留。新增 `mobile-composer.css` 在完整样式链末尾覆盖聊天页的 padding-bottom 为 0，只在 composer-wrap 保留一次底部安全区。键盘打开时使用 6px 间距，不重复预留 Home Indicator。
- 手机网格原先只有附件、文本、回复建议、发送四列，后来增加的语音按钮没有显式位置，被排入下一行。现在显式安排五列，四个 44px 操作按钮全部贴着同一行底边；输入框占据剩余宽度。适用于窄屏及 1200px 以下的 coarse-pointer OEM viewport fallback，桌面鼠标布局不变。
- 旧手机规则用 `height:44px !important` 压过自动高度计算。移除这个约束，输入框可从 44px 向上展开，最大为 132px 或可视高度的 30%，超出后内部滚动。清空时直接恢复最小高度，避免占位文字换行让空框仍保持 88px。
- ResizeObserver 中的布局写入延至下一动画帧，释放时取消待执行任务，避免同步测量/写入造成 observer-loop 警告。
- 键盘打开或聊天框聚焦时隐藏可拖动命令按钮，避免浮动控件盖住发送键；命令面板仍可从菜单进入。

## 已执行验证

- `npm run test:mobile-layout`：布局回归与 10 项视口/相关测试通过。
- `node --test test/composer-resize.test.js`：2/2，通过清空回缩、长文限高滚动、视口高度变化重算与 observer 写入延迟检查。
- 真实产品 App/AuthGate + 原样 loopback 合成 API 的 Chromium 手机浏览器检查：20/20，通过 280/360/390/412/980px 五种宽度，各自验证空框、长文、清空和缩小视口。检查聊天页导航预留为 0、composer 距可用页面底部不超过 10px、全部按钮尺寸至少 44px、按钮不换行且中心可命中、长文增长并滚动、清空恢复 44px。该检查是浏览器仿真，不是 Android 设备实测。
- `npm run build:web`：通过 ESLint、Vite、CSP 及公开认证配置产物检查。只注入已有公开 Supabase URL/anon key，不使用真实登录密码。
- iPhone 16e（iPhone17,5，iOS 27.0.1 / 24A446，390×844pt）Safari 实际复核：原输入框 y=607，修复后空框 y=691，移除约 84px 额外留白；语音/附件/建议/发送在同一行，发送按钮 frame 为 `[333,691,44,44]`。聚焦并输入两行草稿后字段增长到 66px，发送/其他按钮仍在底边同排，未被键盘遮住。Safari 工具栏及输入辅助栏仍占系统区域，不把这些区域当作 App 内空白。
- 隔离合成登录、伴侣加载、首段 SSE 在电脑 ACK 前可见、ACK 后终段可见、刷新后恢复合成会话已实际观察。未使用真实账号、未写生产服务；不将其当作原生 Keychain/生产 SSE 通过。

本地证据位于 `D:/GZdeepseek/_audit/ios-cloud-acceptance-20261113/`：`mobile-composer-browser-results.json`、`mobile-composer-build.log`、`iphone-web-evidence/composer-iphone-after.jpg` 与 `before-stream-ack.json`。原始手机截图可能包含通知，只有已检查的合成页面截图用于审阅，不提交原始屏幕或会话凭据。

## 仍需验证

新的 Android APK、iPhoneOS IPA 和原生设备构建尚未执行，现有手机上安装的旧版 App 不会自动更新。需要新构建后在实际 Android WebView/iOS Capacitor host 再验收键盘、安全区、横屏、不同输入法和长消息。GitHub 云端重跑保持用户此前跳过的状态；AllSign 仅在有真实 iPhoneOS 候选时使用。新增审查代理此次因工具 provider 不可用未能启动，不计为独立审查完成。
