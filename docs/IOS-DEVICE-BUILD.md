# iPhoneOS 构建与 AllSign 交接

状态（2026-11-13）：**构建入口已实现并通过本地定向测试；尚未在 Mac 执行，尚无 DengTa 真机 IPA。** Windows 不能完成此编译。用户已授权在 iPhone 16e 上安装和验收，同时要求等真正需要签名时才操作 AllSign。此前跳过 GitHub 计费恢复/云端重跑的选择仍有效；本次没有触发 workflow。

## 当前证据

- Poki 实时 `status` 返回 runner running / relay ready，已实际打开手机上的 AllSign 并读取资源、已签名、下载页面，随后退出。手机控制链路已验证。
- 手机已安装应用的定向查询未发现 DengTa。AllSign 当前可见资源和已签名列表没有 DengTa，下载列表为空；没有导入、签名或安装其他文件。
- 本地任务相关源码/审计包、GitHub 最近发布和 iOS artifacts 没有可复用的真机包。GitHub 当前仓库自托管 runners 列表为空。既有二进制日志明确是 `iPhoneSimulator` / Mach-O platform 7，即使含 arm64 也不能重签转换。
- 手机原始屏幕、应用列表及签名身份不进入 Git 或公开证据。Poki 成功不等于 DengTa 已运行。

## 已实现的入口

| 文件 | 行为 |
|---|---|
| `scripts/ios-device-build.mjs` | 在真实 macOS 上从干净 checkout 的精确 SHA 导出临时源码，独立安装依赖、运行测试/Web 构建、sync、iPhoneOS Release 编译并调用打包器 |
| `scripts/ios-device-package.mjs` | 核对 App 身份、Capacitor 配置、所有已识别的 Mach-O 和 framework 主文件，生成 `Payload/App.app` IPA 与 SHA-256 receipt |
| `test/ios-device-package.test.js` | 用合成二进制与临时文件测试平台、加密、路径、配置、凭据隔离及 Windows 提前拒绝 |
| `.github/workflows/ios.yml` | 新增仅 `workflow_dispatch`、`business=device` 启用的 `device-package` job，要求 `source_sha` 等于运行提交 |
| `package.json` | `build:ios-device` 与 `test:ios-device` 命令；不新增依赖 |

入口采用 Node 24；默认 Xcode 路径 `/Applications/Xcode_26.6.app/Contents/Developer`。本地可通过 `DEVELOPER_DIR` 指向已有 Xcode，实际工具链版本会记录，兼容性以该次执行为准。输出必须是仓库外、父目录已存在的新绝对路径；不会覆盖已有输出。

构建只导出提交中的文件。忽略的 `.env`、旧 `dist`、本机 node_modules 和现有同步产物不会复制进去；发现已跟踪的实际 `.env*`（示例除外）即拒绝。子进程只接收明确列出的系统环境和三个公开前端配置。用户级/全局 npm 配置使用本次临时空文件；账号、GitHub token、Apple 签名密码和任意其他 `VITE_*` 不转发。Supabase key 必须是 publishable 格式或 legacy JWT 的 anon 角色，这只是防止误用 privileged key，不能验证 key 的真实性或服务可达性。

依次执行 `npm ci`、`test:ios-device`、`test:ios`、`build:web`、`verify:ios-build-policy`、`cap sync ios`，再执行：

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$PRIVATE_DERIVED_DATA" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CAPACITOR_DEBUG=0 build
```

`PRIVATE_DERIVED_DATA` 由脚本创建，不需用户配置。构建阶段不导入证书，不运行模拟器或触碰真实账号。

打包只接受当前构建契约内的 thin generic arm64、显式 `LC_BUILD_VERSION` iOS platform 2、未加密主程序/动态库。拒绝全部 fat/universal、legacy 无平台命令、Simulator、Catalyst、未知平台及截断命令；这不是通用 IPA 重签工具。App 必须是 `home.dengta.app`，plist 为 iPhoneOS、`CAPACITOR_DEBUG=0`，包含本地 Web 入口且没有 Capacitor `server.url`。遍历拒绝符号链接、嵌套 App/extension 和私有签名/环境文件；framework 可执行文件缺失或平台不符也会失败。平台检查不能替代 iOS 系统装载、签名验证和运行验收。

## 有可用 Mac 后执行

使用 feature 分支的干净 checkout，确认所需修订已提交。无需先在 checkout 内安装 node_modules，脚本会在隔离目录自行安装。

```bash
git switch feat/ios-import-75ad3da
git status --short
export DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer
export VITE_API_URL=https://dengta-home-backend-rkmq.onrender.com
# 在本机安全提供已有 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY；不用测试账号密码。
unset VITE_PUBLIC_AUTH_REDIRECT_URL
IOS_DEVICE_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/dengta-device-output.XXXXXX")"
npm run build:ios-device -- "$IOS_DEVICE_PARENT/result" "$(git rev-parse HEAD)"
```

成功时生成 `DengTa-<source前12位>-unsigned.ipa` 与 `manifest.json`。只把 `outcome=unsigned-candidate-created` 且 `sourceSha` 正确、SHA-256 匹配的候选交给后续签名。receipt 始终标明未安装、未进行设备签名/验收。最终 IPA 通过同一文件系统上的排他硬链接一次性发布，准备失败或目标已存在时不产生/覆盖最终文件。失败保留已完成阶段的日志和 failed/interrupted manifest。派生目录和临时源码由脚本尝试清理；清理失败记录 `workspaceCleanupComplete=false` 或 package 的 `temporaryCleanupComplete=false` 并提示残留位置，不把已核验候选改称无效或把临时文件误认为最终文件。

## GitHub Actions 手动构建

在用户恢复已有构建额度或明确允许恢复运行后，使用已有 `iOS Simulator Phase 1` workflow：分支选 `feat/ios-import-75ad3da`，`business=device`，`source_sha` 填完整的已审查 HEAD。此次模式只运行 device job，不运行模拟器或 live job。普通 push/PR 不触发 device job；当前提交继续使用 `[skip ci]`。

job 在 `macos-26` 上运行，限制 40 分钟，token 仅 `contents:read`。已有公开 Supabase 配置可继续使用，不上传用户账号或签名 secrets。成功时才上传 `DengTa-iPhoneOS-Unsigned-<run>-<attempt>`（IPA 和 manifest）；构建日志/manifest 单独上传为 `DengTa-iPhoneOS-Build-<run>-<attempt>`，均保留 7 天。启动前被 GitHub 拒绝时不会有构建结果；失败时只上传日志证据，不上传候选 IPA。

## 取得 IPA 后的真机步骤

1. 核对来源 SHA、manifest、文件 SHA-256 和 iPhoneOS 平台，确认使用本次候选。
2. 用 Poki 打开 AllSign，将候选导入后按用户给出的 Sign / 安装流程操作。只使用手机已有有效配置；是否覆盖该设备、是否过期、重签后 bundle/entitlements 是否正确，以实际结果为准。
3. 确认系统安装完成并真正启动 DengTa。Keychain 使用默认应用访问组；签名后的实际 Keychain 可用性和重启会话恢复仍需在这一步验证。
4. 验收登录/恢复、伴侣、一次 SFW 流式聊天、人格字段安全保存和恢复、记忆/设置、键盘/安全区以及 APK 入口隐藏。保留用户既有内容，不在公开报告放账号、私人聊天、记忆正文、签名身份或凭据。
5. 记录实际机型、iOS、候选 hash、重签后 bundle ID、各项结果和经过挑选的 SFW 截图；未执行项保持未验证。

目前实际阻塞是可用的 Mac/Xcode 构建执行通道。AllSign 和 USB/Poki 连接不能补出 iPhoneOS 编译结果；没有要求购买证书、创建 Apple 账号或恢复付费服务。
