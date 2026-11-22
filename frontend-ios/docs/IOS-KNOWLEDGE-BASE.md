# DengTa iOS 工程知识与证据边界

## 源码与出处

当前私有前端 main `f8fa26ae` 是产品基线。外部 `75ad3daa42689bdb48ba46e47b61c494e03d20d7` 是候选资料，公开业务基线 2.10.74。下载哈希/库存与自述核验见 `IOS-EXTERNAL-HANDOFF-REVIEW.md`；逐模块评分与选择见 `IOS-IMPORT-MATRIX.md`。未导入旧业务、后端、历史私人截图、嵌套 Kiwi TAR、环境文件或外部签名脚本。

外部 run #9 的编译部分成功、Keychain -34018 和后续启动失败是真实历史问题；它不是当前分支的测试结果。本轮采用 CLI 新生成工程和 Xcode 原生 Simulator ad hoc 流程，结论必须由新 run 证明。

## 认证安全边界

- 三个稳定键：`dengta_home_auth_v1`、`-code-verifier`、`-user`。iOS 只用设备解锁后可访问且不迁移至新设备的 Keychain。
- 首次迁移以已存在的 Keychain 为准；只有 Keychain 空时读旧 Preferences/localStorage。写后读回，再清除已知明文副本。失败仍清除旧副本并阻止登录，可能要求重新登录；这不是无损迁移承诺。
- 每个 SDK 拥有可撤销租约。退出同步封闭旧租约、事件和生命周期，再等待在途存储完成并验证三个键删除。失败保留封闭状态，显式解锁重试后才允许新客户端。
- 核心 API/settings/personality/memory scope 持有并转发私有上下文票据；已测旧请求的 401/伴侣响应不能修改新账号/新 token。当前 provider 401 白名单保留。额外只读审查发现既有语音/创作的部分直接转发未带 originating context；这些可选路径不在本轮硬验收，后续需单独补齐，不能声称所有业务调用已完成同等隔离。
- 保留现有错误分类、连接检测、初始化/登录 20 秒和刷新 15 秒截止时间；超时不能让迟到 SDK 重新登录。
- 恢复超时只封闭/排空旧租约，保留 durable session 供重试；显式退出可把该排空升级为 verified clear。内部 SDK rotation 不重置身份队列；显式取消使用独立 epoch。真实 GoTrue 的 initialize finally 可能重开监听，因此立即及初始化结束后都执行 dispose。
- 回滚必须保留安全存储边界，不能恢复旧 Preferences 认证路径。AccountVault 和普通缓存加密后置，不声称全部私人数据已加密。
- Native 回跳先由隔离的不持久化 SDK 验证，失败不删除当前登录。验证后仍需异步页面对话框明确确认账号/恢复用途；取消、不可用、超时、退出、销毁或陈旧响应不能提交。只有明确确认后才保留完整 session（包括可能旋转的 refresh token），在退休前预约 seed/recovery 状态，任何胜出的新客户端都先持久化 seed 再构造 SDK。拒绝/超时/退出/部分写入失败和订阅者抢占均有真实 SDK 合成回归；不把无法恢复的 seed 计作成功。对话框保持底层 App/草稿挂载；当前源代码的构建/匿名启动已在 c84f0a7/run43294494055 通过，但普通 CI 不打开该框；真实邮件与原生面板交互未验收，不声称 PKCE。
- Web 仅在实际 window.localStorage 且支持 Web Locks/crypto 时使用非敏感 epoch 和 origin 独占锁。退出、SDK 删除主认证键和身份变化均封闭旧 epoch；事件在持久化比对后才接受。无锁环境只有普通 storage removal 退出传播承诺。新身份只使用匿名 SDK；跨标签页竞争超过有限重试则取消。Android/iOS 不采用这个 Web 协议。
- SDK 专用退休读取返回空，防止 GoTrue detached INITIAL_SESSION 异常；普通租约读取仍拒绝。存储错误使用 GoTrue 可识别的安全 retryable 类型/原名，避免迟到刷新拒绝无人观察的 Deferred；退休仍由 manager 永久封闭，写/删不开放。当前 provider 错误仍可见。

## 平台与传输

POST SSE 使用 WKWebView fetch 流；没有选择 native HTTP 代理。CORS、流是否被上游代理缓冲、登录 allowlist 都要用实际链路验收。native callback 为 `dengta://auth`。冷启动 URL 与事件可能同时发送，处理器订阅后读取冷启动 URL、串行去重并清理监听。

已执行的只读传输检查：2026-11-12T17:24Z，OPTIONS `/chat/stream` 返回 204，允许 capacitor origin/POST/请求 headers；GET `/health` 返回 200、JSON、匹配 allow-origin 与 HSTS。证据 `transport-cors-20261112-1724.json` 在日志目录。后台源码检查发现全局 CORS 先于认证、POST stream 设置 event-stream/no-transform/X-Accel-Buffering 并 flushHeaders；这些不是已登录流式实测。没有执行 POST/业务写入。源码搜索仅限明确 source/config，排除凭据交接文档。

iOS native 不获取 Android marker/touch recovery，不显示 APK 操作。共享 viewport controller 有引用计数；AuthGate 与 App 重叠挂载时只保留一组监听，原来的键盘 scroll 抖动保护仍在。单元测试不能证明设备上的键盘布局。

## 证据等级

1. JS 单元/组件回归：证明已执行的合成条件，不能代替真实服务器或原生运行。
2. Swift 注入 Security 策略测试：不触碰 runner Keychain，不能证明 entitlement 可用。
3. Simulator 构建/安装/启动：分别记载；有 `.app` 不等于能启动。
4. 实际 Keychain 随机探针：独立 service/key，验证 add/read/delete 与字节回读，不导出值。
5. 匿名 DOM 就绪 + 截图 + 进程存活：证明启动至登录页，不能证明真实账号业务。
6. 原生 XCUITest 的匿名键盘输入/滚动：只能证明所测登录/注册/找回表单，不证明登录后聊天 composer。`f8b8f51` 原始七阶段通过但总体 parser 失败；ca3f0f7 完整 run 43279364936 通过。随后 0431a82 run 43280829367 与 0745558 run 43286170878 在 iPhone 17 和 iPhone SE 3 分别通过七阶段、实际 Keychain/就绪与截图。0745558 仍早于 round8 确认修复；普通 CI 不打开邮件确认框。
7. 独立 WKWebView 合成 loopback 传输：编译真实 api.js、虚构认证上下文、ACK 后才送 done，另测截断与取消；0745558 的 run43286170878 首次原生通过，c84f0a7 的 run43294494055 再次通过。不证明产品 origin/生产服务器或真实业务。
8. 本地私有账号业务验收：恢复会话、伴侣、流式聊天、人格保存/恢复、记忆/设置与聊天键盘。执行前保持未验证。

CI 只导出 allowlist schema 的诊断、工具/构建日志和匿名页面截图，带源码 SHA 与本次随机启动标识；未知或认证状态拒绝截图。下载的 CI artifact 只放仓库外并记录哈希。

Windows Chromium 的真实 Web Locks/storage/BroadcastChannel 合成 provider 检查是另一类兼容证据，不能替代 WKWebView 或私有账号验收。`browser-auth-audit.json` 及 harness 位于仓库外证据目录。

另有 `browser-auth-interleaving.json` / harness：固定 seed `0xD3A6105`、120 个三标签竞争轮次；并发登录/退出、延迟存储事件、乱序广播与标签重建后收敛身份一致，零 pageerrors/外部请求。36 次旧租约/竞争身份操作被取消，不当作业务成功计数。

## 后续审核的官方资料快照

2026-11-12T19:11Z，以下官方页面直接 HTTP 200 读取；网页搜索工具当时返回服务错误，因此使用本机 HTTP 客户端。HTML 保留在仓库外证据根目录，未作为产品代码或审核结果使用。

| 页面 | 本地文件 | 字节 | SHA-256 |
|---|---|---:|---|
| [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | apple-review-guidelines.html | 240818 | `31EA529B57226A76978AEFA5F814BEFDA515B46DA5E2E7F79434B36D73A9AFAB` |
| [TestFlight](https://developer.apple.com/testflight/) | apple-testflight.html | 112344 | `1170E1875A1A398F234D5076EBBA5D9AF71E4D0E63A25180BDD2548A738540F4` |
| [Account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) | apple-account-deletion.html | 134554 | `49CB3BDC633D5F985CE0BE4CBBAF41ADE3BDFFA8D3480C649585347792545012` |

具体 SFW/生成内容、第三方 AI 数据分享、账号删除、数字付费和原生实用性评估见 IOS-DECISIONS.md；不从这些规则推断已经符合或保证过审。

## 后续依赖

交互 Mac 用于真实账号/键盘调试；Apple Developer/签名、APNs、TestFlight、上架隐私与内容评估后置。前台本地通知与后台推送分开描述。当前没有设备 IPA 或上架产物。
