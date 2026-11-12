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

新 Mac 没有 checkout 时，先 clone 到一个不存在的新目录；使用正常 GitHub 登录方式，不把 PAT 放在 URL：

```bash
git clone --branch feat/ios-import-75ad3da --single-branch \
  https://github.com/DengTaHome/dengta-home-frontend.git dengta-home-frontend-ios
cd dengta-home-frontend-ios
```

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
IOS_LOCAL_DERIVED="$(mktemp -d "${TMPDIR:-/tmp}/dengta-ios-derived.XXXXXX")"
IOS_LOCAL_EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/dengta-ios-evidence.XXXXXX")"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$IOS_LOCAL_DERIVED" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
bash scripts/ios-simulator-smoke.sh \
  "$IOS_LOCAL_DERIVED/Build/Products/Debug-iphonesimulator/App.app" \
  "$IOS_LOCAL_EVIDENCE" "$(git rev-parse HEAD)"
npx --no-install cap open ios
```

上述 derived-data/evidence 使用 mktemp 新建独立目录；保留证据，不要删除别人的已有目录。交互式 Xcode 中选择 App scheme 和 iPhone Simulator，保持 `home.dengta.app`。当前不填写虚构 Team，不做设备签名，不手工重新签整个 `.app`。

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

### 本地 Mac 业务验收记录

用 Xcode 正常运行 App 后手动输入私人账号。CI smoke 会创建并删除它自己的匿名设备，不能当作保留私人会话的交互流程。正常业务验收不添加 CI diagnostics 启动参数，不传密码到 xcodebuild settings/测试环境或 Actions secrets。

先记录源码 SHA、Xcode/iOS 版本、设备型号与测试时间。人格字段的原值只留本地，两个字段分开保存、退出页面重新读取，再恢复原值并复读；失败时优先恢复原值。记忆验收先读页面，不点清空、批量删除或历史导入。聊天用新的 SFW 测试会话和无害短句，避免把既有私人内容截入证据。

| 项目 | 通过条件 | 只记录的安全证据 |
|---|---|---|
| 登录/重启恢复 | 首次登录成功；终止后重开恢复同一账号与伴侣 | 时间、pass/fail、重启次数；不记录账号/token |
| 真实 SSE | 一次提交，观察多次正文增量及结束；取消不再追加，重试不重复提交 | 增量次数、首增量/结束时间、错误 enum；不导出 headers/body |
| 人格两个字段 | 测试值可复读，恢复原值后也可复读 | 两个独立 pass/fail，恢复完成布尔值；不复制原值 |
| 记忆/设置 | 页面可打开、加载结束、导航返回正常 | 页面枚举/pass/fail；不导出记忆正文 |
| 聊天键盘 | 邮箱/密码/聊天框聚焦与收起、短屏与横屏能看到输入框和发送按钮 | 屏幕/安全区/键盘矩形及经确认的 SFW 截图 |
| 平台与退出 | 已登录界面无 APK 操作；退出后重开匿名，清理失败有解锁重试 | APK 入口数量、状态枚举、清理 pass/fail |

不要把 Safari Web Inspector 的完整 Network/HAR、Authorization headers、回跳 URL 或真实表单值放进报告。可在本地查看分块时序，但交付只保留上述计数/状态和主动选择的 SFW 图。完成后恢复测试字段、退出账号并确认重开匿名；未完成的项目继续标为未验证。

## 独立合成 WKWebView 传输测试

CI 另建 `home.dengta.transport-fixture` 临时 UIKit/WKWebView 宿主，编译当前 `src/api.js`，使用显式虚构认证上下文和仅监听 `127.0.0.1` 的 Node 服务。它不进入产品 bundle，不改产品 ATS/Keychain/Capacitor 配置，不使用私人账号。

在已安装上述工具链的 Mac，从 feature checkout 执行：

```bash
node scripts/ios-webkit-transport.mjs "$TMPDIR/dengta-transport-evidence" "$(git rev-parse HEAD)"
```

真实 text 回调须先发 ACK，服务端才发送 done/EOF；另测 UTF-8 正文、POST multipart/虚构 headers、缺失 done 拒绝、取消后无后续事件且服务端响应提前关闭。TCP 可能合并写入，因此不声称每次服务端写入对应独立 reader chunk。产出绑定 nonce/source SHA 的原生 receipt 和 server 计数；finally 尝试清理自建 Simulator。首次原生运行已在0745558的完整run43286170878通过。

该宿主只证明合成 loopback WKWebView 传输；不覆盖产品 capacitor origin、生产 TLS/CORS/上游缓冲、真实认证、聊天 UI 或业务验收。

原生邮件回跳先在隔离 SDK 内验证服务端身份，再通过异步页面对话框显示账号/恢复密码用途。只有明确确认才替换会话；取消/60秒超时/退出/销毁保留当前状态或明确退出结果。对话框不可用则拒绝，底层 App 与未保存草稿保持挂载；这不等于 PKCE 绑定。实际 Mac 验收还需测试真实邮件、冷/热启动以及打开原生文件选择器时的确认/取消；不得把真实回跳 URL 或邮箱截图上传 CI。

## 失败处理

- `-34018`：保留原始受限探针状态，检查 Xcode 产生的签名/entitlements 与嵌入框架；不要虚构 Team/access group。
- 启动失败：核对源 SHA、Simulator 平台、实际 bundle、签名、PID 与 launch 错误；编译成功不能代替启动成功。
- 清理失败：保持原租约关闭，解锁后显式重试。不能降级至 Preferences/localStorage，也不能把旧凭据复制回明文。
- CORS/认证 allowlist 需要生产配置变更时，只报告依赖，不在此分支修改生产。
