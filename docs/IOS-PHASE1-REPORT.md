# DengTa iOS 长任务报告

## 1. 结论

**部分完成；尚未通过 Phase 1 核心业务验收。** 环境 B（GitHub Actions macOS）、范围 A 保持。Windows 本地没有 Xcode；原生结论全部来自真实 CI，不把静态准备或合成账号测试算作私人账号实测。

最新已执行原生源码为 `1ba7e3a`：标准双设备 job 通过，合成核心流程通过至人格恢复/记忆页，最后退出导航失败。修复提交 `ca121ae` 已推送，但 Actions 在启动 runner 前因付款/支出上限拒绝，尚无该补丁的原生结果。需要恢复 GitHub 计费后重跑；无需个人 Mac。

用户随后选择跳过云端重跑并继续本地工作。本轮仅加固未启用的 live 辅助脚本及定向测试，保留原生/真实账号未验收状态；不申请新 runner、不调整支出、不启用 live 或上传账号 Secrets。

再后续用户授权 iPhone 16e + Poki + AllSign 真机验收，并要求签名时才使用 AllSign。Poki 已实际连接和控制手机；未发现 DengTa 真机安装包，未签名/安装。新增手动 iPhoneOS Release 构建、平台校验和 unsigned IPA 打包入口，本地定向测试 14/14 与 actionlint 通过；fresh-context 审查发现的环境继承/失败发布两项已修复并独立复核关闭。Mac 构建尚未执行、真机业务仍未验证。详见 [IOS-DEVICE-BUILD.md](IOS-DEVICE-BUILD.md)。本次仍未恢复云端重跑或改变支出。

| 环境检查 | 实际结果 |
|---|---|
| 本机 | Windows 11 Pro x64，10.0.22621；xcodebuild/xcrun 均不存在 |
| 本地源码与文件权限 | 原前端路径可读；可访问仓库外审计目录，非仅限当前仓库 |
| 原生执行环境 | Actions macOS 26.7.2 / Xcode 26.6 (17F113) / iOS SDK 26.5；以各 run toolchain.log 为证 |
| Apple Developer / App Store Connect | 本轮未使用或验证 Apple 账号权限；Simulator 无此当前阻塞，不索要账号/证书 |
| APNs / 真机签名 | 均后置；未配置、未分发 |

已完成外部包核验、逐模块选择、隔离分支、Capacitor iOS host、Keychain/认证生命周期与平台修复、八轮真实 fresh-context 审查。上一轮完整 run [43294494055](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43294494055) 在 `c84f0a7362683450e69aa744d8a08a5d423888cb` 通过 Xcode 构建，并在 iPhone 17 与 iPhone SE 3 各自通过启动、实际 Keychain、匿名就绪/截图及七阶段键盘交互；另有独立 iOS WKWebView 合成 POST SSE 传输通过。该源码已包含回跳确认修复，但普通 CI 不打开确认框，不验收真实邮件/原生面板交互；合成传输不计为真实业务验收。

新增云端业务自动化使用真实产品入口、认证 SDK、Keychain 与原生 XCTest，只有 auth/API 替换为 runner loopback 合成服务。它与真实账号验收分开记录，详见下方补充记录和 `IOS-CLOUD-ACCEPTANCE.md`。没有把密码上传 CI；真实账号的原生完整流程仍未执行，Phase 1 保持未完成。个人 Mac 并非现有云端构建或自动化的必要条件。

## 2. 外部交接包

手机输入框后续修复与实测范围见 [MOBILE-COMPOSER-FIX.md](MOBILE-COMPOSER-FIX.md)：共享 Android/iPhone 布局去掉重复底部预留、明确语音按钮位置、恢复多行输入及清空回缩。真实 iPhone Safari 和合成浏览器验证不能替代新原生包验收。

固定提交 `75ad3daa42689bdb48ba46e47b61c494e03d20d7`，来源：[Raw 交接文档](https://raw.githubusercontent.com/DengTaHome/dengta-home/75ad3daa42689bdb48ba46e47b61c494e03d20d7/docs/LOCAL-GPT-HANDOFF.md)、[完整 ZIP](https://codeload.github.com/DengTaHome/dengta-home/zip/75ad3daa42689bdb48ba46e47b61c494e03d20d7)。

| 对象 | HTTP | 字节 | SHA-256 |
|---|---:|---:|---|
| Raw | 200 | 22,365 | `17A5F270CDF622949AFFA436A4B2D5C07659B93221D3189ADC3403891E1E726B` |
| ZIP | 200 | 30,163,731 | `1D1BEC353B1ECAB63BCEC74701090101D320F916F7F7A0642EDD6B729BD1962D` |

ZIP 共 1,645 entries / 1,507 文件，展开 46,701,058 字节；Raw 与 ZIP 内交接文档逐字节相同。存在工程/Keychain/Vault/测试候选，但外部业务版本为 2.10.74，历史 run #9 并未通过原生启动。原始 npm/Xcode 日志不在该包，文档摘要不能当作当前证据。

未发现实际环境文件、高置信生产凭据、证书/profile/私钥、node_modules/Pods/DerivedData；环境示例、模拟数据与未做视觉隐私审计的历史二进制/截图不导入。只在仓库外隔离目录解压，没有执行外部脚本。详见 `IOS-EXTERNAL-HANDOFF-REVIEW.md`，清单/扫描记录位于 `D:/GZdeepseek/_audit/ios-stage0-external-20261112-153403955/`。

补充来源核验：GitHub compare API HTTP 200 确认包提交 75ad3daa 比自述代码头 70b407d2 多一个文档/证据提交，23 个变更文件均在 docs/，前端实现未变；详见外部核验文档及 `external-claimed-head-compare.json`。此关系不证明外部自述测试成功。

## 3. 本地 vs 外部

| 模块 | 选择 | 结果 |
|---|---|---|
| 产品业务 | 保留本地 | 基线 `f8fa26ae`，版本 2.13.43；保留 QQ 云/AstrBot/更新 UI，拒绝旧 2.10.74 覆盖 |
| iOS/SPM | 借鉴结构，CLI 重新生成 | 精确 Capacitor 8.4.3；Bundle ID `home.dengta.app`；当前产品图标 |
| Keychain/租约 | 审查后采纳并重做边界 | 三认证键、WhenUnlockedThisDeviceOnly、无共享 group/同步；迁移清理、失败关闭、旧刷新隔离 |
| 认证/请求隔离 | 在本地主线上增量修复 | 身份串行化、scope 票据、超时保留、隔离回跳候选、安全提交和 Web 多标签页兼容 |
| viewport/键盘 | 借鉴引用计数，保留本地行为 | iOS 有界认证滚动区；真实匿名 XCUITest；修复 iOS 16px 输入字号兜底被更具体聊天规则覆盖，不替换业务布局 |
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
- 文档：原11份加本轮云端验收文档共12份、八轮逐条审查报告和文档漂移记录；具体文件以 PR diff 为准。

主要提交：`d0e2a1f` 基础工程；`11b08ce` runner env 修复；`f8b8f51` 第二轮/XCUITest；`ca3f0f7` 认证/证据第三至第五轮修复；`0431a82` 小屏 CI；`ffeb441` 安装入口；`0745558` 独立传输；`c84f0a7` 异步回跳确认。上一轮归档的 `delivery-boundary-check.json` 只证明当时归档与 c84f0a7 的运行代码一致；本轮业务自动化是后续新实现，必须核对新的源码与 CI。新增 `4d521db` 合成产品业务测试，`14f7fdf` fixture/键盘修复与 live gate，`30e6270` 文字定位尝试，`b0052e7` iOS 字号与手机设置入口。未修改原前端 checkout 的用户工作、生产后端/Supabase/Render/Vercel 或 main。无凭据/构建产物/截图提交 Git，无 IPA/TestFlight/上架操作。

## 5. 已执行验证

本地日志根目录：`D:/GZdeepseek/_audit/ios-longrun-20261113/`。

| 检查 | 结果 | 证据与边界 |
|---|---|---|
| Windows CLI 生成/sync | 通过 | `cap-add-ios-windows.log`；不是 Swift 编译 |
| npm run test:ios | round8 当前源代码通过 | `test-ios-round8.log`；真实 SDK/合成存储、回跳确认、scope、平台、SSE/人格/记忆组件回归 |
| npm test | round8 完整脚本链通过 | `npm-test-full-round8.log` 已结束至末项 test:style-distill；全链脚本日志齐全、无失败标记，独立 exit code 未另存；`round8-complete-test-log-check.json` 核验，不是生产端到端 |
| npm run build:web | round8 当前源代码通过 | `web-build-round8-async.log`，含 ESLint/CSP/公开认证配置和异步回跳确认 |
| verify:ios-build-policy | 通过 | 同上；只证明 emitted API/callback literals，另有 redirect 源码测试 |
| 定向 SDK 竞态 | 57 项通过 | `round5-auth-complete.log`；`round5-refresh-reproduction.log` 保留修复前真实失败 |
| 真正 Web 多标签页机制 | 五例通过 | `browser-auth-audit.json`：Chromium 156、真实 Web Locks/storage/BroadcastChannel、完全合成 provider、零 pageerrors/外部请求；不是 WKWebView |
| Web 三标签交错竞争 | 120 轮通过 | `browser-auth-interleaving.json`；固定 seed、并发 A/B 登录/退出/延迟事件/乱序广播/标签重建；收敛身份一致，零 pageerrors/外部请求；不是 iOS |
| 未认证 HTTPS/CORS | 通过所测请求 | `transport-cors-20261112-1724.json`；OPTIONS /chat/stream=204，GET /health=200；无认证/POST 业务写入 |
| Xcode/Simulator/Keychain/匿名 UI | c84f0a7 双设备完整 CI 通过 | 见下面 actual run 表、manifest、PNG 和七阶段 receipt；每台真实 Keychain add/read/delete=0，删除后 -25300 |
| iPhone SE 小屏 | 通过，c84f0a7 完整 CI | 单独 nonce/安全区/PNG/七阶段，50.974 秒，0 failures |
| 独立 iOS WKWebView 合成 POST SSE | 通过，c84f0a7 完整 CI | 当前 api.js + 真正 loopback HTTP；ACK 先于 done、UTF-8、multipart/虚构 headers、截断和取消/响应提前关闭；不等于生产端到端 |
| 邮件回跳本地确认 | 50 项定向/组件通过；当前源构建/匿名启动通过；真实邮件/确认框/选择器仍未实测 | `round8-consent-final.log`、`round8-approval-component-fixed.log`；async dialog 保留草稿，拒绝/超时/退出/销毁/陈旧响应不能提交候选。普通匿名 CI 不打开此框，不能验收 showModal/原生面板共存 |
| Chromium 原生 HTML dialog 交互 | 四例通过，Windows/合成 manager | `browser-native-approval.json`：真实 showModal/背景 inert/焦点/Tab/Escape、明确确认、不可用时拒绝、320×568 长邮箱滚动可达；草稿/节点保持、零页面错误/外部请求。不是 iOS/原生选择器实测 |

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
| [43294494055](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43294494055) / c84f0a7 | **成功** | 含异步确认源码；定向 JS/公开 web build/原生策略/双设备匿名全流程及独立合成传输通过；普通 CI 未打开真实邮件确认框 |

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

上一轮 c84f0a7 evidence 在 `ci-43294494055/artifact/`，下载回执在 `download-receipt.json`。iPhone 17/SE 3 的唯一实际 XCTest 分别 59.697s/50.974s，均 0 failures、七阶段且未提交表单；两个 manifest 都明确 `businessFlows: not-exercised`。原生 Keychain 探针成功，PNG 文件哈希与 manifest 一致，且已实际查看。[iPhone 17 匿名截图](D:/GZdeepseek/_audit/ios-longrun-20261113/ci-43294494055/artifact/simulator/login-ready.png)、[iPhone SE 匿名截图](D:/GZdeepseek/_audit/ios-longrun-20261113/ci-43294494055/artifact/simulator-compact/login-ready.png)。独立传输的 native/server nonce 与源码一致，六项检查均 true，3 个合法 POST、0 个意外请求。artifact ZIP 1,050,915 bytes，SHA-256 `3B3D1C60F64D4D46378E4D79C3AABE8F23B8C83EB437BAB7AC8C5A86D53BA789`；logs ZIP 141,898 bytes，SHA-256 `5966E4FEEA85BDBF5CADB585255E7C4CD2D32B9DA57313946F82D77C3E153818`。

便携审查包：`D:/GZdeepseek/_audit/ios-longrun-20261113/review-pack-final.zip`；包内 HASHES.json 与旁边 `.sha256.txt` 核验文件，不包含密码、环境文件、产品 app 或原始 xcresult。

### 本轮云端业务补充（2026-11-13）

审计目录：`D:/GZdeepseek/_audit/ios-cloud-acceptance-20261113/`。
与前述匿名 CI 分开：真实产品 App/SDK/Keychain/XCTest，runner loopback
合成 auth/API。没有注入登录态、替换产品页面、绕过原生回跳确认或导出真实账号截图。
`test:ios-business` 31/31、`test:settings`、公开配置下的 `build:web` 均以 exit 0 结束。
首次缺公开 auth 配置的 build:web 调用在 verifier 失败，随后正确配置重跑通过。
桌面和 402×874 移动 Chromium 预检各六项通过，无未知路由/远程 HTTP 请求；仅网页证据。

| Run / 源码 | 实际业务结果与修复 |
|---|---|
| 43355244162 / 4d521db | 编译/登录通过；keyboard 容器 isHittable 错误门槛失败。改用真实按键和有界 native frame；整体后续被取消 |
| 43356331374 / 14f7fdf | 首段可见后才 ACK，服务端终段/完整历史确认；XCTest 终段文本查询失败；整体后续被取消 |
| 43357224935 / 30e6270 | 缩短选择器仍失败，不当作修复；standard simulator job 通过，整体失败 |
| 43358580545 / b0052e7 | 聊天完整通过、打开设置；回滚手势落固定标题栏导致失败；无设置写入。整体后续被取消 |
| 43359416288 / 0947466 | 再次无法查终段；原生 AX 树中两方正文缺失，PNG 有文字。字号修复后头像完整、状态胶囊位于 y76；整体失败 |
| [43360513467](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43360513467) / 5c240db | iOS 关闭聊天行 CSS 跳过后，本次完整聊天通过；人格大幅滚动在两侧来回过冲，写入前失败。标准 job 全通过，整体仍失败 |
| [43361811216](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43361811216) / 1ba7e3a | 标准 job 成功；业务 XCTest 441.155 秒后在退出导航失败。登录、聊天首段/ACK/终段、重启会话、人格保存/重启回读/恢复、记忆页打开均通过；账号控件实际为 AX Other，测试误查 Button。整体失败 |
| [43363465042](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43363465042) / ca121ae | 已修正账号/退出控件类型查询并增加合成记忆正文可见性断言；GitHub 付款/支出上限检查在 runner 启动前拒绝两个 job，steps 为空。没有执行新构建或测试，补丁原生未验证 |

新增产品修复：iOS 输入字号最低16px 的规则优先级、iOS 聊天行持续渲染、
普通 composer 可访问标签、两个完整的保存/字数回执文本节点。聊天历史初始
显示200行，加载更早内容会逐次增加150行；取消 CSS 跳过有长历史布局成本，
不是永久200行硬上限。独立只读 CSS 探针实测字号15→16px、渲染规则有效；
探针脚本/JSON/哈希在审计目录，不能代替原生结果。

5c240db 标准 Simulator evidence：iPhone17/SE3 启动、Keychain、匿名七阶段、
独立 WKWebView SSE 都通过。ZIP `simulator.zip` 为1,050,089字节，SHA-256
`2B1972145AF1FD7D2F2F916971AFAECE318E3656E3FE39163A917B9F1F055E71`。
失败业务 ZIP 为577,227字节，SHA-256
`F2E22371FCE48849265566B7E8F51E2A14570822DF8A2DD3DB83E9DA125C4E44`；
截图与 AX 已实际查看，纯合成 SFW 数据。

1ba7e3a 的 fixture 确认人格恢复基线、完整 user/assistant 历史持久化、
一次流和一次 ACK、零违规请求；logout=false，不能当作整条业务通过。
这轮 memoryOpened 只证明页面和读取状态，不证明卡片可见；ca121ae 的新增
正文可见性断言仍待执行。原生失败截图停在账号菜单，没有留存该轮聊天或
人格页面截图，不以其他 run 或网页图替代。

| 1ba7e3a 下载证据 | 字节 | SHA-256 |
|---|---:|---|
| 标准 simulator.zip | 1,050,243 | `92A0B5E80F44B1D3DDBC32760C9179C5431795070C6FF071F664C3646092D061` |
| 失败 business.zip | 896,164 | `013FAFCDAF9337EF5FB0FFA4C4D0E1A8ED27B51F8BB9C4A5B55390BB7E1261F4` |
| logs.zip | 160,521 | `16366AF6B3369B455162E5A6EA69BCADF22A70D6F199659BECC2463DCAD42EFA` |

两台标准匿名截图和业务失败截图均已实际查看，文件位于审计目录
`ci-43361811216/`。最新未启动 run 的 `run.json`、`jobs.json` 和
`annotations.json` 位于 `ci-43363465042/`；失败原因是 GitHub 账户计费门槛，
另一个 capacity 提示仅为 notice。需管理员检查 Billing & plans 后重跑该 SHA；
本轮没有调整支出或付款设置。

上一轮 `12aa9a6` 便携审查包：`D:/GZdeepseek/_audit/ios-cloud-acceptance-20261113/review-pack-cloud.zip`，
附逐文件 `HASHES.json` 和 ZIP 旁置 SHA-256。仅含匿名/合成证据、只读审查及报告；
不包含账号凭据、app、xcresult、测试计划或真实账号原始输出。源码已按本地八个
私有值模式扫描117个变更文件（含本轮文档），零命中。最终五篇文档/PR描述
独立复读无剩余漂移，记录为仓库外 `cloud-doc-drift-final.md`；不冒充额外完整审查轮次。

### 跳过云端重跑后的本地加固

`test:ios-business` 现在46/46、exit 0（日志 `test-ios-business-guard-next.log`）。
全部新增行为通过 fake fetch 验证，没有对生产服务执行这些操作：

- helper 始终 local 撤销自己的会话；回执区分 guard 与 native 登录，401不当作撤销成功。产品正常退出仍有 global 行为，本轮不改共享认证语义。
- 只记录 helper 自己普通 POST 成功返回并读回的精确 session ID/nonce 标记。陌生唯一会话不认领；创建响应丢失不重试、不猜测删除，清理失败；重命名不删除。
- 人格修改前必须等待计划登记并新读基线；恢复时只接受原值或确切计划值，有冲突不发设置 PUT。只发本次改动字段，保留新读的其他设置，排除服务端ID/时间戳，避免旧全量请求触发账号/伴侣身份写入。

只读后端核验发现：普通 API 无 CAS/幂等创建，服务端设置仍有内部读写窗口；
会话 DELETE 不撤销所有记忆/伴侣状态副作用，也不保证附件存储清除。
因此不声称原子恢复或账号完整复原。owner/history 预检限制仍在；
driver 未接入计划/精确会话选择，持久恢复日志、强制中断恢复、成功回复判定、
native 登录单独撤销和实际 macOS验证仍未完成。总 live 入口继续在读取账号、
写文件、构建或请求网络之前拒绝。

本轮本地审查包：`D:/GZdeepseek/_audit/ios-cloud-acceptance-20261113/review-pack-live-guard-local.zip`，
含提交快照/补丁、46项日志、独立方案/攻击/文档审查、逐文件哈希与敏感扫描，
不含新的原生结果或截图；上一轮云端包保持历史快照不覆盖。

## 6. 未验证/阻塞

| 验收项 | 当前状态 | 后续执行 |
|---|---|---|
| 最新修复原生编译/完整合成流程 | ca121ae 未执行；GitHub runner 被计费门槛拒绝 | 恢复 Actions 付款/额度后重跑；1ba7e3a 部分通过不能替代 |
| 真实私人账号登录/重启恢复 | 原生未执行；本地普通 auth/bootstrap 返回200 | 云端 live 尚未就绪；不把本地账号预检算作原生验收 |
| 伴侣信息/账号伴侣隔离 | 真实链路未执行 | 登录后读取并切换/重启核对 |
| 已认证 POST SSE 一轮聊天 | 未执行 | 检查多段增量/结束/取消/重连，不能用预检或 mock 替代 |
| 人格设置保存/恢复 | 真实账号未执行 | 两个字段分别写无害值、重新读取、恢复原值并复读 |
| 记忆与设置页面 | 真实账号未执行 | 打开/读写范围按授权核验，避免破坏既有数据 |
| 聊天 composer 键盘/安全区 | 合成账号原生两阶段已测；完整结果见补充记录 | 匿名表单七阶段不能代替 composer；横屏/真实账号仍未验收 |
| 已登录页面无 APK 入口 | 源码 guard 有测试；实际页面未执行 | 登录后核对所有安装/更新入口 |
| 邮件回跳/生产 allowlist | 未执行 | 本地 Mac 实际注册/恢复邮件，核对账号确认/取消/超时与原生 picker 并存；配置不符时另提生产变更 |
| 语音/前台提醒 | 仅可行性评估 | 不纳入首版硬验收；见插件矩阵 |

用户已跳过当前云端重跑；计费恢复后仍可继续该路径，个人 Mac 是人工交互调试的另一选择。真实账号 live driver 因成功回复判定、持久远端恢复及 native 登录局部撤销等未完成而硬关闭，手动 dispatch 也会在读取账号或请求网络之前失败。用户指定的有会话 owner 仍被当前空 member 策略拒绝；这是实现限制。helper 的局部加固没有完成真实账号支持；无 CAS 不能声称原子恢复。没有上传凭据、没有修改生产聊天或人格。Apple Developer、APNs key、真机签名均后置，不在本轮索要。

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

早先独立 drift agent 顺序读完 11 份文档/对应源码并复核外部哈希，发现两处证据汇总过期（初始记录在 `ios-reviews/drift-initial/2026-11-13_DRIFT_REPORT.md`）；修复后的历史复读在 `ios-reviews/drift-final/2026-11-13_DRIFT_REPORT.md`。随后 fresh reviewer `final_drift_after_security` 再次逐份读完 11 份文档、当前确认/传输源码与 0745558 真实 receipts/哈希，未发现 P0/P1 过度承诺，但发现确认契约、最新证据与漂移范围汇总需同步，原文保留在 `ios-reviews/drift-round8-initial/2026-11-13_DRIFT_REPORT.md`。全部按 PROPOSE FIX 处理；在 c84f0a7 原生 CI 仍待执行时逐份复读关闭，结果在 `ios-reviews/drift-round8-final/2026-11-13_DRIFT_REPORT.md`。后续 CI 数字只从实际 receipts 补充，不用普通 CI 推断真实邮件/原生确认框验收。

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

继续按已确认的 **环境 B / 范围 A** 推进；按用户选择跳过本次云端重跑。后续需把 helper 的计划/精确会话接入 driver，完成持久恢复、native 单会话撤销及成功回复判定，再做独立审查与实际 macOS 验证。计费恢复时仍需补验 ca121ae 的退出/记忆可见性修复；本地测试不替代。PR 保持 Draft，不合并；Apple Developer/APNs/设备签名及 TestFlight 留到后续阶段。
