# DengTa iOS 构建与验收

状态：工程已由 Capacitor CLI 8.4.3 生成。Windows Web 构建与 sync 已执行；原生构建/运行结论以 `IOS-PHASE1-REPORT.md` 的实际 CI run 为准。

## 环境与源码

- 生产基线：`f8fa26aed2bdff46505b32a0115952fa3b92c896`，产品版本 2.13.43。
- 分支：`feat/ios-import-75ad3da`，在隔离 worktree 开发；不覆盖原来的 QQ 云工作区。
- Node 24、npm lockfile、Capacitor core/android/cli/ios 均为 8.4.3。
- CI：`macos-26`，`/Applications/Xcode_26.6.app/Contents/Developer`。工具链缺失时失败并更新证据，不静默换版本。
- 无需 Apple Developer、设备证书、APNs key 或 provisioning profile 即可尝试此 Simulator 流程。真机与分发另行处理。

## 在 Mac 执行

从当前前端仓库的 feature 分支开始。以下环境变量仅为本地/CI 的公开前端配置；不使用数据库 service-role key，不复制凭据文件。

```bash
git switch feat/ios-import-75ad3da
export DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer
export VITE_API_URL=https://dengta-home-backend-rkmq.onrender.com
# 在当前 shell 安全地提供已有的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。
unset VITE_PUBLIC_AUTH_REDIRECT_URL
npm ci --no-audit --no-fund
npm run test:ios
npm run build:web
npm run verify:ios-build-policy
npx --no-install cap sync ios
bash scripts/test-ios-keychain-native.sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/dengta-ios-derived \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
bash scripts/ios-simulator-smoke.sh \
  /tmp/dengta-ios-derived/Build/Products/Debug-iphonesimulator/App.app \
  /tmp/dengta-ios-evidence "$(git rev-parse HEAD)"
npx --no-install cap open ios
```

先确认 `/tmp/dengta-ios-derived` 和 evidence 目录属于本次任务；不要删除别人的已有目录。交互式 Xcode 中选择 App scheme 和 iPhone Simulator，保持 `home.dengta.app`。当前不填写虚构 Team，不做设备签名，不手工重新签整个 `.app`。

Windows 上 `cap sync ios` 可以复制资源并生成 SPM，但 CLI 会写 Windows 分隔符。提交的 `CapApp-SPM/Package.swift` 本地依赖路径已规范为 `/`；在 Mac 上 sync 会自动生成正确路径。Windows 的 sync 成功不代表 Swift/Xcode 编译成功。

## CI 边界与证据

`.github/workflows/ios.yml` 只在指定 feature 分支 push、同仓库对应 PR 或该分支手动运行。没有 `pull_request_target`，checkout 是实际 head SHA，token 只有 contents:read。公开认证配置缺失会明确失败，不构建假配置登录页。

流水线顺序：锁定依赖 → JS 回归 → `build:web`（含 ESLint/CSP/公开认证配置验证）→ emitted API/callback literal 检查 → sync → 注入 Security 的 Swift 策略测试 → Xcode Simulator 编译 → 新建临时 Simulator → 安装/启动 → Keychain 实际探针与 DOM 就绪 → 匿名截图 → 同一临时设备上的 XCUITest 键盘/滚动。只删除本次新建的 Simulator。证据保存 7 天。原始 xcresult 保留 runner derived-data 下，不上传；仅上传受限几何 receipt 和测试日志。产物 literal 检查与 redirect 源码行为测试分别执行，均不能证明实际运行时路由、生产 allowlist 或已认证传输。

`manifest.json` 分别记录源码 SHA、构建、启动、进程存活、Keychain、登录页就绪。Keychain 必须实际 add/read/delete 成功、读回字节一致且删除后读为 item-not-found。诊断只在 Debug Simulator 且显式带随机启动标识时启用。诊断输出固定枚举、数值和布尔值，不输出 token、输入框值、页面 HTML、URL 或用户标识。

登录页就绪需要真实匿名状态、三个连续递增采样、完全位于可视 viewport/祖先裁剪区且通过 hit-test 的邮箱/密码/提交控件、无 prelude/错误/加载状态、无 Android marker/APK 入口。命令成功且新生成有效 PNG/hash 才算截图成功。未知/已认证/恢复密码状态拒绝截图；新启动不能沿用旧 nonce 的截图授权。

XCUITest 只输入固定虚构邮箱/密码，逐一检查登录邮箱/密码/提交、注册确认密码/提交、找回邮箱/提交；不按提交/Go、不发送重置邮件。必须实际执行唯一命名 test 并成功，七个阶段的完整控件 native frame 必须在实际键盘上方和启动时 native safe-area 内。启动 receipt 的实测 safe top/bottom 经 xcodebuild build settings 和明确 App MacroExpansion 的 scheme 传入；缺失或未展开即失败。键盘 accessibility frame 可以不包含底部系统区域，验证其在窗口内并以实际 keyboard.minY 判断遮挡。它不能证明私人账号登录、SSE、人格保存或聊天输入框。

CI 依次创建 iPhone 17 和 iPhone SE（第 3 代）临时设备，分别保留 `simulator/` 与 `simulator-compact/` evidence；每次都重新启动、取实测安全区并执行七阶段。手工 smoke 默认 iPhone 17，可设置 `DENGTA_SIMULATOR_DEVICE_NAME='iPhone SE (3rd generation)'` 选择小屏。设备类型缺失会失败，不静默替换屏幕尺寸。新增小屏路径是否通过以报告的实际 run 为准。

## 交互验收清单

在用户提供的 Mac 或获准的本地测试设备上使用私有账号；密码只在本地使用，不写入仓库、日志或云 CI。

1. 登录，再终止/重开，确认会话恢复与伴侣正确。
2. 发送无害文本，看到多个流式增量和结束事件；核对聊天未重复提交。
3. 人格设置的个性化指令/你的详情分别写入无害值，再恢复原值并重新读取。
4. 打开记忆、设置；检查账号/伴侣切换后缓存与请求隔离。
5. 邮箱/密码/聊天输入框键盘弹出和收起，横竖屏、刘海及 Home Indicator 无明显遮挡。
6. 退出后重开保持匿名；若 Keychain 清理失败，必须显示解锁重试并阻止登录。
7. iOS 中无 APK 下载/更新/安装入口；Android 原有入口保留。

截图仅使用 SFW 内容，避免账号信息或私人聊天。真实账号、SSE、人格保存/恢复和聊天键盘在实际执行前一律记为未验证。

## 失败处理

- `-34018`：保留原始受限探针状态，检查 Xcode 产生的签名/entitlements 与嵌入框架；不要虚构 Team/access group。
- 启动失败：核对源 SHA、Simulator 平台、实际 bundle、签名、PID 与 launch 错误；编译成功不能代替启动成功。
- 清理失败：保持原租约关闭，解锁后显式重试。不能降级至 Preferences/localStorage，也不能把旧凭据复制回明文。
- CORS/认证 allowlist 需要生产配置变更时，只报告依赖，不在此分支修改生产。
