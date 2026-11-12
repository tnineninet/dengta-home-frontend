# DengTa iOS 长任务报告

## 1. 结论

**部分完成；尚未通过 Phase 1 核心业务验收。** 环境 B（GitHub Actions macOS）、范围 A 保持。Windows 本地没有 Xcode；原生结论全部来自真实 CI，不把静态准备或合成账号测试算作私人账号实测。

| 环境检查 | 实际结果 |
|---|---|
| 本机 | Windows 11 Pro x64，10.0.22621；xcodebuild/xcrun 均不存在 |
| 本地源码与文件权限 | 原前端路径可读；可访问仓库外审计目录，非仅限当前仓库 |
| 原生执行环境 | Actions macOS 26.7.2 / Xcode 26.6 (17F113) / iOS SDK 26.5；以各 run toolchain.log 为证 |
| Apple Developer / App Store Connect | 本轮未使用或验证 Apple 账号权限；Simulator 无此当前阻塞，不索要账号/证书 |
| APNs / 真机签名 | 均后置；未配置、未分发 |

已完成外部包核验、逐模块选择、隔离分支、Capacitor iOS host、Keychain/认证生命周期与平台修复、八轮真实 fresh-context 审查。完整 run [43286170878](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43286170878) 在 `07455585988ead7fd7cff99d8bb638c2c52931f3` 通过 Xcode 构建，并在 iPhone 17 与 iPhone SE 3 各自通过启动、实际 Keychain、匿名就绪/截图及七阶段键盘交互；另有独立 iOS WKWebView 合成 POST SSE 传输通过。此后新增的回跳确认修复仍需新 source CI；合成传输不计为真实业务验收。

真实私有账号登录/恢复、伴侣、已认证 POST SSE、人格设置保存/恢复、记忆/设置与聊天输入框尚未执行；没有把密码上传 CI。这些缺项使 Phase 1 保持未完成。

## 2. 外部交接包

固定提交 `75ad3daa42689bdb48ba46e47b61c494e03d20d7`，来源：[Raw 交接文档](https://raw.githubusercontent.com/DengTaHome/dengta-home/75ad3daa42689bdb48ba46e47b61c494e03d20d7/docs/LOCAL-GPT-HANDOFF.md)、[完整 ZIP](https://codeload.github.com/DengTaHome/dengta-home/zip/75ad3daa42689bdb48ba46e47b61c494e03d20d7)。

| 对象 | HTTP | 字节 | SHA-256 |
|---|---:|---:|---|
| Raw | 200 | 22,365 | `17A5F270CDF622949AFFA436A4B2D5C07659B93221D3189ADC3403891E1E726B` |
| ZIP | 200 | 30,163,731 | `1D1BEC353B1ECAB63BCEC74701090101D320F916F7F7A0642EDD6B729BD1962D` |

ZIP 共 1,645 entries / 1,507 文件，展开 46,701,058 字节；Raw 与 ZIP 内交接文档逐字节相同。存在工程/Keychain/Vault/测试候选，但外部业务版本为 2.10.74，历史 run #9 并未通过原生启动。原始 npm/Xcode 日志不在该包，文档摘要不能当作当前证据。

未发现实际环境文件、高置信生产凭据、证书/profile/私钥、node_modules/Pods/DerivedData；环境示例、模拟数据与未做视觉隐私审计的历史二进制/截图不导入。只在仓库外隔离目录解压，没有执行外部脚本。详见 `IOS-EXTERNAL-HANDOFF-REVIEW.md`，清单/扫描记录位于 `D:/GZdeepseek/_audit/ios-stage0-external-20261112-153403955/`。

## 3. 本地 vs 外部

| 模块 | 选择 | 结果 |
|---|---|---|
| 产品业务 | 保留本地 | 基线 `f8fa26ae`，版本 2.13.43；保留 QQ 云/AstrBot/更新 UI，拒绝旧 2.10.74 覆盖 |
| iOS/SPM | 借鉴结构，CLI 重新生成 | 精确 Capacitor 8.4.3；Bundle ID `home.dengta.app`；当前产品图标 |
| Keychain/租约 | 审查后采纳并重做边界 | 三认证键、WhenUnlockedThisDeviceOnly、无共享 group/同步；迁移清理、失败关闭、旧刷新隔离 |
| 认证/请求隔离 | 在本地主线上增量修复 | 身份串行化、scope 票据、超时保留、隔离回跳候选、安全提交和 Web 多标签页兼容 |
| viewport/键盘 | 借鉴引用计数，保留本地行为 | iOS 有界认证滚动区；真实匿名 XCUITest；不替换业务布局 |
| CI/探针 | 借鉴概念，当前工具链实测 | 标准 Xcode Simulator ad hoc，无手工虚构 Team/重签；严格 nonce/可见性/PNG/几何证据 |
| AccountVault/AES-GCM | 后置 | 普通缓存没有全面加密，不能把凭据 Keychain 当作全量缓存安全 |
| 旧业务/截图/嵌套 TAR/签名绕过 | 拒绝 | 不进入产品分支 |

1–5 逐模块评分、风险与理由见 `IOS-IMPORT-MATRIX.md`；实施/回滚契约见 `IOS-IMPORT-PLAN.md`。

## 4. 已修改

隔离 worktree：`D:/GZdeepseek/_worktrees/ios-import-75ad3da`。分支 `feat/ios-import-75ad3da`；[Draft PR #2](https://github.com/DengTaHome/dengta-home-frontend/pull/2)，保持未合并。

- iOS：真实 CLI SPM host、自定义 Keychain bridge、受限 Debug Simulator 探针/readiness、隐私清单/用途说明、匿名 XCUITest target/scheme。
- 认证：原生迁移清理、每 SDK 租约/生命周期/cleanup retry、请求上下文票据、候选回跳验证/预约 seed、明确的本地账号确认、SDK dispose/迟到刷新防护；Web Locks 可用时另有非敏感 origin epoch 和持久化比对。
- 平台：iOS 不继承 Android marker/touch recovery，隐藏 APK 操作，网易原生播放缺能力返回 unsupported；共享 viewport 保留原抖动保护。
- 配置/CI：ios@8.4.3 与对应锁文件、iOS 配置、Node 24/macOS 26/Xcode 26.6 构建与有界证据；仅 feature/same-repository PR，contents:read。
- 文档：11 份 IOS 文档、八轮逐条审查报告和文档漂移记录；具体文件以 PR diff 为准。

主要提交：`d0e2a1f` 基础工程；`11b08ce` runner env 修复；`f8b8f51` 第二轮/XCUITest；`ca3f0f7` 认证/证据第三至第五轮修复；`0431a82` 小屏 CI 与可行性文档。未修改原前端 checkout 的用户工作、生产后端/Supabase/Render/Vercel 或 main。无凭据/构建产物/截图提交 Git，无 IPA/TestFlight/上架操作。

## 5. 已执行验证

本地日志根目录：`D:/GZdeepseek/_audit/ios-longrun-20261113/`。

| 检查 | 结果 | 证据与边界 |
|---|---|---|
| Windows CLI 生成/sync | 通过 | `cap-add-ios-windows.log`；不是 Swift 编译 |
| npm run test:ios | round8 当前源代码通过 | `test-ios-round8.log`；真实 SDK/合成存储、回跳确认、scope、平台、SSE/人格/记忆组件回归 |
| npm test | round5 完整通过；round8 重跑中 | `npm-test-full-round5.log` 为历史 exit 0；`npm-test-full-round8.log` 当前仍在执行，不是生产端到端 |
| npm run build:web | round8 当前源代码通过 | `web-build-round8-async.log`，含 ESLint/CSP/公开认证配置和异步回跳确认 |
| verify:ios-build-policy | 通过 | 同上；只证明 emitted API/callback literals，另有 redirect 源码测试 |
| 定向 SDK 竞态 | 57 项通过 | `round5-auth-complete.log`；`round5-refresh-reproduction.log` 保留修复前真实失败 |
| 真正 Web 多标签页机制 | 五例通过 | `browser-auth-audit.json`：Chromium 156、真实 Web Locks/storage/BroadcastChannel、完全合成 provider、零 pageerrors/外部请求；不是 WKWebView |
| Web 三标签交错竞争 | 120 轮通过 | `browser-auth-interleaving.json`；固定 seed、并发 A/B 登录/退出/延迟事件/乱序广播/标签重建；收敛身份一致，零 pageerrors/外部请求；不是 iOS |
| 未认证 HTTPS/CORS | 通过所测请求 | `transport-cors-20261112-1724.json`；OPTIONS /chat/stream=204，GET /health=200；无认证/POST 业务写入 |
| Xcode/Simulator/Keychain/匿名 UI | 0745558 双设备完整 CI 通过；round8 待新 CI | 见下面 actual run 表、manifest、PNG 和七阶段 receipt；早先 run 不证明回跳确认修改 |
| iPhone SE 小屏 | 通过，0745558 完整 CI；round8 待新 CI | 单独 nonce/安全区/PNG/七阶段，52.539 秒，0 failures |
| 独立 iOS WKWebView 合成 POST SSE | 通过，0745558 完整 CI | 当前 api.js + 真正 loopback HTTP；ACK 先于 done、UTF-8、multipart/虚构 headers、截断和取消/响应提前关闭；不等于生产端到端 |
| 邮件回跳本地确认 | 50 项定向/组件通过；原生待新 CI | `round8-consent-final.log`、`round8-approval-component-fixed.log`；async dialog 保留草稿，拒绝/超时/退出/销毁/陈旧响应不能提交候选 |

### 实际 CI 历史

| Run / SHA | 总体结果 | 实际发生 |
|---|---|---|
| 43264424061 | 失败 | workflow env 的 runner context 语法；未进入 Xcode，已修复 |
| [43264739171](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43264739171) / 11b08ce | 成功 | 首次标准 Xcode 构建/安装/启动、实际 Keychain 和匿名 PNG；早于收紧键盘检查 |
| [43269692016](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43269692016) / f8b8f51 | **失败** | 构建/Keychain/收紧就绪/PNG 与原始七阶段 XCUITest通过；总体因错误要求 keyboard accessibility frame 到窗口底部失败。修复后重读旧 log 不把该 run 改记成功 |
| [43279364936](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43279364936) / ca3f0f7 | **成功** | 全流程通过，含修复 parser、实测安全区参数/明确 MacroExpansion、required PNG 和七阶段 XCUITest，53.742 秒，0 failures |
| [43280829367](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43280829367) / 0431a82 | **成功** | 两台分别新建的 iPhone 17/SE 3 均通过启动/实际 Keychain/匿名就绪/PNG/七阶段，SE 56.686 秒，0 failures |
| [43283653297](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43283653297) / ffeb441 | **成功** | 包含设置安装控件修复；双设备启动/实际 Keychain/匿名就绪/PNG/七阶段均通过 |
| [43286170878](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43286170878) / 0745558 | **成功** | 双设备全流程和独立合成 WKWebView POST SSE 通过；早于回跳确认修复 |

对应 push run 因 push/PR 共用并发组而取消，未冒充成功或另算产品失败。

ca3f0f7 工具链：macOS 26.7.2、Xcode 26.6（17F113）、SDK/iOS 26.5、Node 24.22.2/npm 11.19.1、runner image 20261102.0473.1。原生 Keychain add/read/delete=0、回读字节一致、删除后 -25300。窗口 402×874，实测 safe top/bottom=62/34；七阶段控件完整位于安全区和实际 keyboard.minY=583 上方。键盘 accessibility frame [0,583,402,233] 不包含底部系统区域是合法情况。

证据目录 `ci-43279364936/artifact/simulator/`：`manifest.json`、`keyboard-evidence.json`、原生/UI receipts、`login-ready.png`、`keyboard-xctest.log`。截图已实际查看，是匿名登录表单；没有私人内容。

| 下载物 | 字节 | SHA-256 |
|---|---:|---|
| DengTa-iOS-Simulator-43279364936-1.zip | 758,500 | `02C97CB77B3C7B85D895666E5562D02D033688C566067FC71911AB961E453B43` |
| logs.zip | 136,717 | `405F67E98B8A3FD5B3E076B31BAAF3A2338CB6398F417EB6355483CBC779C76D` |

GitHub artifact 保留 7 天；上述下载与校验已放仓库外。初始和失败 run 的 ZIP/哈希也保留在对应 ci-* 目录，旧日志不删除或重写为成功。

0431a82 双设备 evidence 位于 `ci-43280829367/artifact/simulator/` 和 `simulator-compact/`。iPhone SE 3 窗口 375×667，实测安全区 20/0，键盘 [0,451,375,216]；七阶段完整控件均在键盘上方/安全区内，两份 PNG 已查看。ZIP 为 1,037,690 bytes，SHA-256 `C45F6FCA15D8FAC87AE1D140764852886E53E982DD4328894BA4400220C32A5D`；job logs ZIP 为 138,035 bytes，SHA-256 `340130E412E5BCFFBFEE8D069141D04BD8A14EC4EBB345829C0BC2B0F57E2879`。

ffeb441 evidence 位于 `ci-43283653297/artifact/`，两份 manifest 均为 `startup-passed` / `businessFlows: not-exercised`；PNG 已实际查看。ZIP 1,038,653 bytes，SHA-256 `6D197B0AB31F880221825E71D4B3C04AA0090F861F9FB1D180755D81D6C9F23C`；job logs ZIP 138,179 bytes，SHA-256 `229A467AA7C9EF3B8395ADC3D3F705578FFDB10FF990B557403D89C66FE59D18`。

0745558 evidence 位于 `ci-43286170878/artifact/`。产品双设备 XCTest 分别为58.052s/52.539s，0 failures；两个 PNG SHA 与已查看的 ffeb441 图完全相同。独立 `webkit-transport/transport-receipt.json` 与 manifest 共享 nonce/source SHA，六个检查布尔值均 true；server 确认3个合法 POST、normal ACK、0 unexpected requests，runtime iOS26.5。ZIP 1,049,888 bytes，SHA-256 `74C167628AC889B3EE74CB2FFBD6F21E58B41D52A968E899AF964D26857E6747`；job logs ZIP 140,969 bytes，SHA-256 `79E4BB7868DC0DEBC26AF1DFA3B2933380F3D15CA4AD59DF5734630AD5BB871A`。

## 6. 未验证/阻塞

| 验收项 | 当前状态 | 后续执行 |
|---|---|---|
| 真实私人账号登录/重启恢复 | 未执行 | 本地交互 Mac；凭据只本地使用 |
| 伴侣信息/账号伴侣隔离 | 真实链路未执行 | 登录后读取并切换/重启核对 |
| 已认证 POST SSE 一轮聊天 | 未执行 | 检查多段增量/结束/取消/重连，不能用预检或 mock 替代 |
| 人格设置保存/恢复 | 真实账号未执行 | 两个字段分别写无害值、重新读取、恢复原值并复读 |
| 记忆与设置页面 | 真实账号未执行 | 打开/读写范围按授权核验，避免破坏既有数据 |
| 聊天 composer 键盘/安全区 | 未执行 | 匿名表单七阶段不能代替登录后 composer/横屏 |
| 已登录页面无 APK 入口 | 源码 guard 有测试；实际页面未执行 | 登录后核对所有安装/更新入口 |
| 邮件回跳/生产 allowlist | 未执行 | 本地 Mac 实际注册/恢复邮件，核对账号确认/取消/超时与原生 picker 并存；配置不符时另提生产变更 |
| 语音/前台提醒 | 仅可行性评估 | 不纳入首版硬验收；见插件矩阵 |

当前需要可交互 Mac 完成业务验收。Apple Developer、APNs key、真机签名不阻塞现有 Simulator 流程，均留到后续真机/分发工作，不在本轮索要。

## 7. 大象/金鱼审查

真实 fresh-context 子代理只读，root 唯一实施写入者；使用本地 EGM review/review-loop/resolve/drift-report。用户已授权普通修复自动推进，未因技能交互 gate 中断。

| 轮次 | Findings | 处置/验证 |
|---|---|---|
| 1 | 11 P1 计划缺口 | 清理/回滚、scope、回跳、平台与 CI 契约；已落实现有代码/测试，业务证据分列 |
| 2 | 5 P1 + 2 P2 | 身份队列、scope facade、恢复超时、认证 scrollport、就绪可见性、SDK 资源、截图门槛；完整原生证据在 ca3f0f7 通过 |
| 3 | 1 P1 + 4 P2 + 2 Nits | Web 退出传播、无效回跳不删账号、安全区、产物检查与文档真实性；已修复 |
| 4 | 2 P1 + 3 P2 | 延迟身份消息、匿名身份边界、seed 抢占、SDK 自行退出、截图重试保存；已修复 |
| 5 | 1 P1 + 2 P2 | 新身份不得复用恢复 A 的 SDK、迟到刷新/初始读取的孤立拒绝；真实 SDK 复现后修复，审查者复读无未解决 P0/P1 |
| 6 | 1 P3；未发现新增核心 P1/P2 | 已登录插件/传输只读检查；修正设置页 PWA 安装入口，定向检查通过；真实业务不由源码审查推断 |
| 7 | 独立测试宿主 1 P1 + 2 P2，另有配置加固 | 修复 IIFE 顶层 await（先实际复现）、取消响应关闭误判、失败 receipt 丢弃；Vite 不读环境文件/继承前缀；原生完整 run43286170878 通过 |
| 8 | 3 P2 | 修复外部有效账号回跳的静默切换、阻塞 confirm 的 native completion 依赖、延迟审批创建的退出竞争；实际 SDK/组件/读数回归通过，审查复读关闭 |

逐条原文、理由、PROPOSE FIX 与证据在 `ios-reviews/round-*/goldfish_review_report.md`；汇总 `IOS-REVIEW-EVIDENCE.md`。没有静默降级、虚构多 agent 或把审查当构建。

### 三个具体自审缺点与修复

| 已发现缺点 | 级别/用户影响 | 修复 | 修复验证 |
|---|---|---|---|
| 请求 facade 丢 originating context | P1；旧 token 的迟到 401 可清除更新会话，旧 header 可改伴侣 | 全程转发 context，并核对生命周期/账号/伴侣/session revision | 修复前 race 复现；六个实际 API/manager/facade 用例通过 |
| 恢复超时清掉持久凭据 | P1；离线或慢网络被迫退出 | 超时仅 seal/drain，明确退出再验证清理 | 凭据保留/重试恢复/迟到写入与退出升级清理 fixtures 通过 |
| 新 SDK 先恢复 A 再用于 B | P1；A 的旧 refresh 可覆盖 B | 身份操作前必须得到匿名 SDK，有限重试后取消竞争 | 实际 GoTrue 延迟 B 登录/旧刷新用例通过；三标签交错检查未发现身份串写 |

这些已确认代码缺陷已修复；未执行的真实业务验收继续作为交付缺项，不由自审结果替代。

独立 drift agent 顺序读完 11 份文档/对应源码并复核外部哈希，发现两处证据汇总过期（初始记录在 `ios-reviews/drift-initial/2026-11-13_DRIFT_REPORT.md`）；修复后全部 11 份通过复读，结果在 `ios-reviews/drift-final/2026-11-13_DRIFT_REPORT.md`。随后新增独立传输测试仍需在最终证据确定后复核。

## 8. 风险

- **Keychain/回滚：** 当前标准模拟器未复现外部 -34018；真机锁定/重装/恢复与发行签名未验收。清理失败必须解锁重试并保持登录关闭；不能把旧凭据恢复至 Preferences/localStorage。
- **私人缓存：** 普通缓存未全面加密，AccountVault 后置；仅凭据的 Keychain 不能代表全部私人数据安全已完成。
- **共享认证与回跳：** 生命周期/租约修改涉及 Web/Android；新增本地回跳确认也是共享 native 安全修复。合成测试通过，Android 真机和真实 iOS 邮件 UI 未验收。明确确认缓解静默账号切换，不等于 PKCE/一次性挑战绑定；后续仍需评估更强的请求绑定与防钓鱼能力。
- **后台与 Android 差异：** 无 APNs/Android 周期 worker 等价实现，分享导出/全量插件后置。退出后 pending/delivered 通知清理仍需独立实际复现，未宣称通过。
- **可选请求路径：** 额外静态审查发现既有语音/创作的部分 capture/invalidation 转发缺少 originating context；未纳入本轮 Scope A 硬验收，后续需独立修复与竞态测试。未把核心已测 scope 结果扩大为全量业务隔离承诺。
- **分发/隐私/内容：** 无设备 IPA、TestFlight 或 App Store 提交。未来 SFW 内容、隐私披露、账号删除/权限数据流及审核规则需单独评估；当前不改成人内容或生产产品。
- **证据范围：** CI 匿名表单通过不等于核心陪伴通过。Web 合成测试、CORS 预检、编译 literal 检查各有明确边界。单一设备证据不能代替新增小屏、聊天或横屏。

## 9. 下一步与 A/B/C

现行环境 B/范围 A 不重问；外部逐模块导入 A、凭据 Keychain 采纳而 Vault 后置均已按推荐方案实施。PR 保持 Draft，等待用户/Lead 审查，不合并。

下一阶段建议 **A：用户提供可交互 Mac 时，按 IOS-BUILD.md 逐项完成本地私人账号业务与聊天键盘验收**；**B：继续 CI/合成覆盖，保留真实业务未验证状态**；**C：暂停功能扩大，先审查当前差异与后续数据/隐私设计**。Apple Developer/APNs/设备签名及 TestFlight 属于业务验收后的独立授权阶段。
