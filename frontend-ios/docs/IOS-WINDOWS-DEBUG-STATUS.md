# Windows 真机调试包续接记录（2026-11-18）

iPhone 16e 已安装 `DengTa 调试` **0.1.2（2026111801）**，bundle ID 为 `home.dengta.debug`。设备在 2026-11-18 17:37（北京时间）通过 USB 定向查询返回了这个版本，无需再安装 0.1.1。该版本为 Windows 独立 WKWebView 调试包；完整 Capacitor 的设备构建和原生插件验收仍待完成。用户选择跳过的云端重跑未恢复。

## 11 月 18 日更新包：修复、签名和安装

本次网页源码为 `554a536b178ec7fe5cc6407074e6ca804b140741`。相对 0.1.1 只修改 `src/android-compat.css` 的记忆卡片标题布局：窄屏空间不足时，标题与“打开记忆页”按钮可以分行；按钮保持文字所需宽度。网页从该提交的 `git archive` 在隔离目录重新构建，未读取工作区 `.env`，也未打入工作区里未提交的记忆业务改动。宿主沿用 0.1.1 的 arm64 iPhoneOS 可执行文件。

以下路径相对于仓库外审计目录 `D:/GZdeepseek/_audit/ios-windows-debug-20261113/`。IPA、签名材料和私人截图不提交 Git。

| 产物或回执 | 结果 |
|---|---|
| `revision-0.1.2-2026111801/DengTa-Debug-554a536-unsigned.ipa` | AllSign 的输入候选，19,723,317 字节；SHA-256 `905fcaa66d277524401689ef663b35df84a1951e0e25bd79a8b5b96e051d9659` |
| 同目录 `web-build-receipt.json`、`ipa-manifest.json`、`usb-transfer-receipt.json` | Vite 生产构建成功；17:14 经 USB 传入 AllSign Documents，整文件读回哈希与本地一致 |
| `resume-20261118/DengTa-Debug-554a536-allsign.ipa` | 设备 AllSign 签名包，19,712,770 字节；SHA-256 `c7144dceea0824fff020708ecac0639d1de48acd4b24a03102235f52dea52c1f` |
| 同目录 `signed-verification-554a536.json` | ZIP 完整，签名结构存在，包 ID 和版本符合预期；与候选逐字节比对，156 个网页文件（含 90 个 JS、17 个 CSS）、19 个宿主文件段和 6 项系统库依赖均一致 |
| 同目录 `installed-version-554a536-check.json` | 独立于文件比对，iPhone 的安装服务返回 `home.dengta.debug` / `0.1.2` / `2026111801` |

安装服务回执证明手机已更新；签名包静态核对不证明页面表现或真实业务通过。下方 0.1.1 的输入框、键盘和页面检查均按当时的实际版本列出。

## 11 月 13–15 日：0.1.0 与 0.1.1

| 对象 | 已确认的结果 | 证据边界 |
|---|---|---|
| `47eb2aa` 首包 | 2026-11-13 19:32（北京时间）USB 安装返回 `InstallComplete`，随后成功启动 | 来自当时的安装和启动记录 |
| 首包页面 | 用户已进入聊天页；原记录检查了键盘展开/收起、设置、个性化和记忆页面 | 页面打开不证明人格保存/恢复、完整聊天 SSE 或原生插件通过 |
| `004616d` 更新包 | 已用 AllSign 签名并开启 **Install After Signing**，系统安装完成；设备读取版本 `0.1.1`、build `2026111302`、bundle ID `home.dengta.debug` | 2026-11-15 真机启动与页面检查完成，不代表完整 Capacitor 验收 |
| 更新包传输 | 2026-11-13 19:47 已传入 AllSign Documents，读回哈希一致 | 不需重复打包或重复传输；传输不等于签名或安装 |
| 0.1.1 本地检查 | 更新包 SHA-256、ZIP 完整性、161 个文件、版本及补丁资源核对通过；定向回归 13 项通过、0 失败 | 不替代 iPhone 上后续版本的验收 |
| 0.1.1 连接 | 用户重新连接并解锁 iPhone 16e，USB 控制及安装版本读取成功 | 2026-11-14 的未连接状态已解除，此次 USB 操作不需要 Poki relay |

本地审计目录：`D:/GZdeepseek/_audit/ios-windows-debug-20261113/`。更新包及其 `ipa-manifest.json`、`usb-transfer-receipt.json` 位于 `revision-004616d/`。原始设备截图、签名包和私人内容保留在仓库外。

更新包 SHA-256：`3242b0f44b057fc82d41bf83a854a5bdeb2a8f2ef266819f7e497cb07592b03a`，大小 19,723,213 字节。完整网页源码提交为 `004616dc63d1a5321212d49d71cda67e88cf4a18`。

## 0.1.1 的具体修复

- 输入框为空时，长占位提示保持单行，避免下方露出半行文字。
- 登录/注册切换区域使用最小高度容纳内容，避免按钮溢出。
- `capacitor://localhost` 宿主不再显示网页安装提示。

0.1.1 对应的定向检查：

```text
node --test test/pwa-install.test.js test/composer-resize.test.js test/mobile-layout.test.js test/visual-viewport.test.js
```

## 11 月 15 日真机结果

- 登录状态和已有聊天恢复；没有为测试退出真实账号。
- 空输入框长提示单行省略；键盘展开时输入框位于键盘上方，四个操作按钮同排；收起后回到底部，没有原先约 84px 空白。
- 输入 120 位数字草稿观察多行增长与限高滚动，随后逐字清空，没有发送聊天。
- 设置首页不再显示网页安装提示；已打开个性化与记忆页面。
- 在 0.1.1 上观察到“打开记忆页”按钮文字溢出，后续 0.1.2 调整了该布局；登录/注册切换未自然出现，未做这项真机复测。
- 没有新增真实聊天/SSE 回合，也没有保存或覆盖真人设字段。

证据在仓库外 `D:/GZdeepseek/_audit/ios-windows-debug-20261113/resume-20261115/`：`installed-version.json`、`signed-verification.json`。签名包 `DengTa-Debug-004616d-allsign.ipa` 为 19,712,657 字节，SHA-256 为 `4e0fb3c1fbdaf61924d12574c1ab4b0425711eda6468b1e135af6d110e720c30`；ZIP 检查通过，156 个网页文件与未签名候选一致。私人截图和签名包不提交 Git。

## 调试包边界

该包由 Windows 上的 LLVM 构建独立 arm64 iPhoneOS WKWebView 宿主，内置已构建网页；没有包含 Capacitor 原生插件，认证存储使用 WKWebsiteDataStore 浏览器存储，不能用它证明 Capacitor Keychain、APNs、原生语音或完整版发布能力。没有 TestFlight/App Store 提交，Phase 1 完整业务验收仍未完成。

正式 Capacitor 构建入口和历史云端证据继续见 [IOS-DEVICE-BUILD.md](IOS-DEVICE-BUILD.md) 与 [IOS-PHASE1-REPORT.md](IOS-PHASE1-REPORT.md)。
