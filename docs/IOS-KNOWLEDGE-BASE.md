# DengTa iOS 工程知识与证据边界

## 源码与出处

当前私有前端 main `f8fa26ae` 是产品基线。外部 `75ad3daa42689bdb48ba46e47b61c494e03d20d7` 是候选资料，公开业务基线 2.10.74。下载哈希/库存与自述核验见 `IOS-EXTERNAL-HANDOFF-REVIEW.md`；逐模块评分与选择见 `IOS-IMPORT-MATRIX.md`。未导入旧业务、后端、历史私人截图、嵌套 Kiwi TAR、环境文件或外部签名脚本。

外部 run #9 的编译部分成功、Keychain -34018 和后续启动失败是真实历史问题；它不是当前分支的测试结果。本轮采用 CLI 新生成工程和 Xcode 原生 Simulator ad hoc 流程，结论必须由新 run 证明。

## 认证安全边界

- 三个稳定键：`dengta_home_auth_v1`、`-code-verifier`、`-user`。iOS 只用设备解锁后可访问且不迁移至新设备的 Keychain。
- 首次迁移以已存在的 Keychain 为准；只有 Keychain 空时读旧 Preferences/localStorage。写后读回，再清除已知明文副本。失败仍清除旧副本并阻止登录，可能要求重新登录；这不是无损迁移承诺。
- 每个 SDK 拥有可撤销租约。退出同步封闭旧租约、事件和生命周期，再等待在途存储完成并验证三个键删除。失败保留封闭状态，显式解锁重试后才允许新客户端。
- 新请求持有私有上下文票据。旧请求的 401 或伴侣响应不能修改新账号/新 token。当前 provider 401 白名单保留。
- 保留现有错误分类、连接检测、初始化/登录 20 秒和刷新 15 秒截止时间；超时不能让迟到 SDK 重新登录。
- 恢复超时只封闭/排空旧租约，保留 durable session 供重试；显式退出可把该排空升级为 verified clear。内部 SDK rotation 不重置身份队列；显式取消使用独立 epoch。真实 GoTrue 的 initialize finally 可能重开监听，因此立即及初始化结束后都执行 dispose。
- 回滚必须保留安全存储边界，不能恢复旧 Preferences 认证路径。AccountVault 和普通缓存加密后置，不声称全部私人数据已加密。

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
6. 原生 XCUITest 的匿名键盘输入/滚动：只能证明所测登录/注册/找回表单，不证明登录后聊天 composer。当前新增测试待 CI。
7. 本地私有账号业务验收：恢复会话、伴侣、流式聊天、人格保存/恢复、记忆/设置与聊天键盘。执行前保持未验证。

CI 只导出 allowlist schema 的诊断、工具/构建日志和匿名页面截图，带源码 SHA 与本次随机启动标识；未知或认证状态拒绝截图。下载的 CI artifact 只放仓库外并记录哈希。

## 后续依赖

交互 Mac 用于真实账号/键盘调试；Apple Developer/签名、APNs、TestFlight、上架隐私与内容评估后置。前台本地通知与后台推送分开描述。当前没有设备 IPA 或上架产物。
