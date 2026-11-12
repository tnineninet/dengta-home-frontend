# DengTa iOS Phase 1 实施报告

状态：实施中；尚未达到 Phase 1 业务验收。本文会随真实 CI/审查证据更新，不以静态准备代替运行成功。

## 环境与变更

Windows、Node 24.22.2/npm 11.19.1，无本地 Xcode/xcrun。能够访问本机仓库与凭据目录；凭据仅内存使用，不提交。GitHub 仓库 push/Actions 权限已只读核验。未请求 Apple Developer、APNs 或设备证书。

隔离 worktree：`D:/GZdeepseek/_worktrees/ios-import-75ad3da`；分支 `feat/ios-import-75ad3da`，基于 `origin/main=f8fa26ae`。保留原 QQ 云/AstrBot 2.13.x，后端与生产配置不变。

本轮选择：新生成 iOS SPM host、依赖 ios@8.4.3、Keychain/租约、会话生命周期及请求 scope、防误判平台/精确深链、共享 viewport、iOS 用途说明与 macOS CI。详细构建命令见 `IOS-BUILD.md`，导入出处/评分见 review/matrix/plan 文档。

## 验证矩阵

| 检查 | 当前结果 | 证据/限制 |
|---|---|---|
| 外部 Raw/ZIP 核验 | 已执行 | HTTP 200、SHA-256、清单见交接核验文档 |
| CLI iOS 工程生成 | 通过（Windows） | `cap-add-ios-windows.log`；不是编译 |
| npm 锁定依赖 | 通过 | npm-ci-baseline.log / npm-install-ios.log |
| JS 认证/存储/生命周期 | 定向检查已通过，扩展回归进行中 | 含真实 SDK 的合成 adapter 检查；不是真实账号登录 |
| npm run build:web | 通过（Windows） | web-build-first.log，含 ESLint/CSP/public auth verifier |
| cap sync ios | 通过（Windows） | 四个官方 SPM 插件、精确 Capacitor 8.4.3；不是 Swift 编译 |
| Swift 策略测试 | 通过（CI，11b08ce） | 注入 mock Security，与实际探针分列 |
| Xcode Simulator 构建 | 通过（CI，11b08ce） | macOS 26.7.2 / Xcode 26.6 / SDK 26.5；修复后新 SHA 待复测 |
| Simulator 安装/启动/存活 | 通过（CI，11b08ce） | 原生 PID/launchctl 存活检查；无手工重签 |
| 实际 Keychain add/read/delete | 通过（CI，11b08ce） | 增/读/删 status 0、回读一致、删除后 -25300；本次未复现历史 -34018 |
| 匿名登录页就绪/截图 | 通过（CI，11b08ce；旧判定） | 已查看真实表单截图；第二轮收紧可见性/稳定采样/截图失败门槛，新 SHA 待跑 |
| HTTPS / capacitor origin 预检 | 通过（未认证） | 17:24Z OPTIONS /chat/stream=204、GET /health=200；不代表实际 SSE |
| 真实私有账号登录/恢复 | 未验证 | 密码不上传云 CI；需要本地 Mac |
| 伴侣加载 | 未验证 | 不由登录页截图推断 |
| 真实 POST SSE 一轮聊天 | 未验证 | JS 协议回归不代替真实 WKWebView/后端链路 |
| 人格设置保存/恢复 | 未验证（实际账号） | 合成保存/退出 scope 回归另记 |
| 记忆/设置实际页面 | 未验证（实际账号） | 当前业务保留；组件回归另记 |
| 安全区/键盘交互 | 未验证（原生交互） | viewport 单测不代替输入操作 |
| iOS 无 APK 入口 | 源码 guard 已加入；运行待验 | 匿名页面检查不代表登录后页面 |

本地运行日志目录：`D:/GZdeepseek/_audit/ios-longrun-20261113/`。凭据/构建产物/截图不提交 Git。

已执行 CI：[run 43264739171](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43264739171)，源码 `11b08ce142103d02d1879a3eb7835df04b8209bd`。Node 24.22.2/npm 11.19.1；runner image `20261102.0473.1`。全部步骤成功，包括 `test:ios`、`build:web`、原生策略、实际 Keychain 和模拟器启动。初始 run 43264424061 因 workflow env 的 runner context 语法失败；已修复，没有把它记作 Xcode 失败。43264723816 被共享并发取消。

artifact 下载位置：`ci-43264739171/DengTa-iOS-Simulator-43264739171-1.zip`，928,554 bytes，SHA-256 `1203F47D0B15F302A2C361C6D6094818EA42132D8260AAC957433CF001B46239`；GitHub job logs ZIP SHA-256 `75F0EB6ACF30433E394A1E6A82368A8E7D2017F587161D6EFF7849DA5C2AE9C4`。均位于上述本地日志目录。截图为 `ci-43264739171/artifact/simulator/login-ready.png`；工具链、Keychain/UI 受限 receipts 和 manifest 在同目录。artifact 保留 7 天，不能依赖长期可下载。

传输证据：`transport-cors-20261112-1724.json`。没有认证/POST 聊天内容或业务写入；只证明 HTTPS 和所测 origin/headers 的 CORS 预检。生产 redirect allowlist、实际 WKWebView SSE 和私人账号流程仍未验证。

## 审查与已知问题

Round 1：三名 fresh-context 审查者完成计划审查，11 个 P1 计划缺口接受修正。实现/CI 证据与后续轮次见 `IOS-REVIEW-EVIDENCE.md`。未完成三轮和 P0/P1 修复前不宣告完成。

第二轮：两名 fresh-context 审查者报告 5 个 P1、2 个 P2，均已应用修复；认证竞态已复现后修复，原生可见性/滚动/新 XCUITest 待新 SHA CI。完整逐条报告位于 `ios-reviews/round-2/goldfish_review_report.md`。不会用首次成功 run 代替新修改的原生验证。

AccountVault 未导入，普通缓存不是全面加密。外部 P0 在新工程 `11b08ce` 标准 Xcode ad hoc Simulator 流程中未复现；这不证明真机/发布签名可用。Android 私有插件、后台提醒、分享导出与全量能力对齐后置；具体差异见 `IOS-PLUGIN-MATRIX.md`。

## 下一步及分发边界

继续实际 macOS CI、失败修复、至少三轮 EGM 和文档漂移检查。真实业务与键盘缺少执行环境时如实保留未验证项。TestFlight/SFW 是将来的方案建议，当前不创建 Apple 账号、不申请证书、不提交 TestFlight/App Store、不合并 PR。上架前需另行核验内容、隐私数据流、权限与删除账号等产品要求。
