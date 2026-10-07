# DengTa 2.10.67 / 115：日记、家庭、动态与投屏接收端可靠性

记录日期：2026-10-07。本文是**发布前源码与本地验证报告**，不是生产端到端验收声明。前端不可变基线为 `4708f8d8b29ddc38e77dab3fa02ac831dc311da7`（2.10.66 / 114），后端只读基线为 `8dd525b2d15cada57cacf80d293e9c9cabcf2ad9`。撰写时前端 main 有本轮未提交修改，后端 main 干净。后端代码推送暂缓。

本轮改善四个模块的失败恢复、请求顺序和草稿保护：读取失败不再被表示为空数据；同一页面的重复操作受到同步锁约束；旧请求不能把新结果或新账号/伴侣的客户端状态改回去；写入回执不完整时保留草稿并指导先读取核对。投屏接收端增加可恢复的读取、视频重载和重新配对入口。未新增提示词模板、生成请求或数据库迁移。

## 1. 已确认的原因与修复证据

### 日记

旧页面初次 GET 失败后仍呈现“空白第一页”，轮询也没有在途锁。旧请求的 React cancelled 标记未覆盖真实 API/auth 管理器的伴侣响应头捕获及 401 会话失效副作用。非法日期会使真实组件抛出 RangeError。HTTP 200 的空对象或字段类型错误又会被当作空列表或不可用成功。

现有后端日记 GET 只给出 available/entries，没有实时生成状态；新界面只说明实际读取状态，不把定时检查说成生成进度。25 项真实组件/API/auth 实现与合成 SDK、fetch、计时器测试全部通过。相同新断言在原始基线上为 1 通过、24 不满足，退出 1；该数量包含新增恢复体验要求，不等于 24 个独立线上故障。证据：`diary-evidence.json`、`diary-baseline.log`、`diary-fixed.log`。

### 家庭

旧初读失败将 null 快照当作已确认无孩子；同一 tick 的出生、命名、发送、照护等动作在 React busy 尚未更新前可发出两个 POST。每个请求有新的 client_action_id，现有后端幂等字段无法把它们当成同一动作。在途操作成功后会清空期间新输入的草稿；迟到 GET 会回滚已确认状态。画像读取可与照护竞争 busy，失败后也不能直接重试。

新实现按实际后端 DTO 校验 GET、动作和画像回执，兼容 available:false 的合法不可用回执，以及 available:true、child:null 的完整空快照。动作成功必须有有效孩子，已有孩子的动作还核对其 ID。读取失败与操作结果未确认分别反馈；恢复按钮只 GET。38 项实际组件/API/auth 合成边界测试全部通过。原始基线 3 通过、35 不满足；追加回执/日期条件时，第一轮补丁为 28 通过、10 不满足，均退出 1。证据：`nursery-report.json`、`nursery-baseline-38-test.log`、`nursery-before-contract-test.log`、`nursery-fixed-38-test.log`。

### 动态

原始 App 同 render 连续发布或评论可发出两个 POST，保存回调还会清空新输入文字和新选图片。逆序 GET 可覆盖新列表；201 空对象或 204 缺保存对象仍可能被显示为发布成功。真实 AuthSessionManager 配合合成 SDK/fetch，复现了刷新 token 期间切换伴侣后发送旧 body 到新范围，以及旧响应头回写当前伴侣的客户端风险。

新动态请求复用已有 scoped session；读取序号让旧 GET 失效；发布和评论使用同步 ref 锁；仅清空仍等于提交原文的草稿，图片仅移除本次提交 IDs。发布回执核对 moment id/author，评论核对 id/author/moment_id，点赞核对目标 id/user_liked。保留原有即时点赞与同步防重复行为。24 项实际 App 函数/JSX、React、API/auth 与合成 SDK/fetch 测试全部通过。

原始 HTTP 500 已保留列表，原始点赞已有同步锁；main.jsx 也已按账号/伴侣重建 App，不能把旧 setter 描述成已证实生产串库。12 项原始基线探针退出 0 表示复现/排除断言通过，不是原产品通过新增验收。未知原始错误正文的四项回归先失败，再修复局部公开反馈。证据：`moments-baseline-probe.json`、`moments-raw-before.log`、`moments-verification.json`、`moments-fixed.log`。

### 投屏接收端

原读取、配对和播放缺少完整生命周期约束；慢读取可重叠，迟到旧鉴权错误会干扰新配对，缺回执也缺少准确恢复反馈。播放失败可能提前消耗 revision 或确认状态。等待 video.play() 的在途操作曾阻碍后续状态读取；新暂停命令抵达首次手动播放尚未 ready 的阶段时，仅使旧结果失效仍不足以取消实际播放。

新请求按接收 token 作用域取消，GET 单一在途。只有真实成功应用后才确认 revision；播放 promise 不占用 GET 锁，同 revision 读取保留原操作，新 revision/媒体、重载和媒体错误使旧操作失效。替换尚未 ready 的在途播放时先调用 pause，取消旧启动。未提供媒体时省略 video src。配对只要求实际 `{receiver_token, expires_at}` 回执，不依赖不存在的 session 字段。

20 项真实接收组件加 5 项实际 API/存储合成边界测试共 25/25，通过；另四项只读函数探针通过。原始基线只有 9 项探针，9 项不满足、退出 1，不能描述为原始基线全部 25 项失败。窄屏基线在既有全局 border-box 下没有实测页面横向溢出；本轮将内容宽度约束到可用宽度并改善按钮、换行和焦点，不能声称修复了巨幅溢出或已证明播放帧率提升。证据：`receiver-baseline.json`、`receiver-fixed.json`、`receiver-fixed.log`、`receiver-readonly-probe.json`。

## 2. 本地逻辑与外部供应商的区分

上述故障证据指向前端异步生命周期、回执校验、状态和错误呈现。本轮没有真实模型供应商调用，也未逐层复审成人内容、上游内容检查或流式生成策略，不能从这些测试判定任何供应商限制已经解决，或将外部供应商/平台错误归为 DengTa 本地规则。未增加成人主题关键词拦截、拒答模板或生成提示词；原认证、租户、凭据、媒体链接和协议保护保留。

未知上游原始 error.message 不再由这四个页面直接展示。日记、家庭、动态复用既有 describeOperationError 的公开原因、操作建议与规范错误码；接收端使用局部稳定错误码、公开恢复说明与合法 HTTP 状态。冻结的共享聊天错误映射没有改动。

## 3. 提示词装配状态

本轮未修改主聊天或各业务模块的提示词、注入条件、用户字段、记忆及供应商适配器。`protected-check.json` 证明 13 个保护文件相对本轮前后端基线不变；这是**本轮基线差异证据**，不是对限制器历史 SHA 注册表逐项相等的声明。

本轮没有重新逐层核验当前完整提示词装配顺序，因此不把历史文档中的顺序标为当前已实测。当前完整装配顺序、各条件块的实际注入及生产账号内容状态仍需专项审计；本报告不复述未经本轮实码核验的历史顺序来代替证据。后端 `npm run check` 和 `npm test` 已退出 0，但它们通过不等于生产供应商/账号验收。

## 4. 修改文件、准确行号与行为

以下行号按本报告撰写时工作树核对；未整文件格式化或重构无关模块。

| 文件与行号 | 目的与变化 |
| --- | --- |
| `src/CompanionDiary.jsx:12`、`:17` | 公开错误说明；非法/缺失时间显示“日期未知”。 |
| `src/CompanionDiary.jsx:40`、`:61`、`:72`、`:85` | 显式账号/伴侣 scope；已有 scoped session；读取同步锁；available:boolean、entries:Array 回执校验。 |
| `src/CompanionDiary.jsx:102`、`:115`、`:150` | 失败保留已有条目，0ms 初读与前台 20 秒轮询清理，提供 GET“重新读取”。 |
| `src/Nursery.jsx:35`、`:50`、`:68`、`:76` | 公开错误；快照/画像实际 DTO 校验；非法里程碑时间兜底。 |
| `src/Nursery.jsx:115`、`:131`、`:164`、`:197` | 生命周期 scope、读序号、scoped session、所有动作与画像共用同步锁。 |
| `src/Nursery.jsx:266`、`:319`、`:322`、`:336` | 仅清理已提交且未改变的草稿；画像失败可重读；读失败和结果未确认各自反馈，GET 核对。 |
| `src/Nursery.jsx:408`、`:446`、`:506` | 命名、发送、画像按钮体现共同 busy 状态。 |
| `src/App.jsx:946`、`:3146`、`:3161` | 动态公开失败说明、scoped 请求、读取序号和回执校验。 |
| `src/App.jsx:6383`、`:6393`、`:6428` | 发布同步锁、提交文字/图片快照、只清理提交内容；取消过期图片准备结果。 |
| `src/App.jsx:6471`、`:6519` | 保留即时点赞并校验回执；评论同步锁、准确回执和新草稿保护。 |
| `src/App.jsx:7133`、`:7144`、`:7330` | 加载/未读/失败/空数据不同反馈、GET“刷新动态”、评论 busy/disabled。 |
| `src/App.jsx:7881`、`:7882`、`:7900` | Diary 的 key/scopeKey 和 Nursery 的 key 跟随账号/伴侣范围。 |
| `src/ReceiverApp.jsx:25`、`:29`、`:42`、`:74`、`:82` | 安全取得 sessionStorage；公开错误和实际 session 回执；挂载及 token 生命周期。 |
| `src/ReceiverApp.jsx:125`、`:156`、`:174` | 播放操作身份与成功确认；GET 在途锁及 revision 顺序；取消被新命令取代的首次待播放操作。 |
| `src/ReceiverApp.jsx:221`、`:247`、`:254` | 配对同步锁和有效回执；保留新草稿；准备播放与重载恢复。 |
| `src/ReceiverApp.jsx:276`、`:280` | 无媒体省略 src；媒体错误反馈；重读状态、重载视频、重新配对。 |
| `src/cast-receiver-api.js:6`、`:12`、`:47` | 可选 signal，15 秒 deadline 覆盖 fetch 与 JSON body；Promise.race 使忽略 signal 的传输也能结束等待；finally 清 timer/listener。 |
| `src/cast-receiver-api.js:55`、`:61`、`:65`、`:69`、`:81`、`:85` | 存储异常降级当前页内存；兼容原配对/读取/ack API，传递取消信号，不自动重发 POST。 |
| `src/receiver.css:1`、`:6`、`:8`、`:9`、`:10`、`:12`、`:14`、`:15`、`:16` | 可用宽度、输入 min-width、50px 按钮、键盘焦点、标题与操作换行；无新增动画或滤镜。 |
| `package.json:4`、`:47`、`:52`、`:53`、`:55`；`package-lock.json:3`、`:9` | 版本 2.10.67；四类新生命周期测试接入常规测试；依赖版本未变。 |
| `android/app/build.gradle:18`、`:19`；`test/android-release.test.js:75` | versionCode 115 / versionName 2.10.67 和相应版本回归。 |
| `test/diary.test.js:28`、`test/nursery.test.js:18`、`test/cast-receiver.test.js:153` | 既有静态断言接受新增请求 options/signal。 |
| `test/diary-lifecycle.test.js:1`、`test/nursery-lifecycle.test.js:1`、`test/moments-lifecycle.test.js:1`、`test/receiver-lifecycle.test.js:1`、`test/receiver-api-lifecycle.test.js:1` | 新增 25+38+24+20+5 共 112 项生命周期与恢复回归。 |
| `docs/module-reliability-20261007.md:1` | 本发布前源码报告。 |

## 5. 数据、隐私与保护文件

本轮没有迁移、生产数据库写入、用户个性化/详情/记忆/历史/世界书正文读写或清理操作。测试所有账号、伴侣、孩子、草稿、错误正文、URL 和 SDK/fetch 回执均为虚构。真实 API/AuthSessionManager 的实现被执行，网络、SDK 和计时器等边界受夹具控制；这不等于生产多账号隔离已验收。

`protected-check.json` 的 13 项均 unchanged:true、authorizedChange:false：前端 chat-errors.js、chat-idempotency.js、api.js、auth-session.js；后端 ai-service.js、persistent-memory-filter.js、provider-output-guard.js、chat-stream-contract.js、settings-store.js、chat-request.js、prompt-security.js、server.js、check-prompt-architecture.mjs。后端工作树检查为空。`secret-check.json` 检查 3 个当前配置私密值，privateValueExposed:false、credentialValuesWritten:false；`apk-verification.json` 无私密凭据模式。检查结果仅证明这些实际扫描范围，不作为全部系统绝无泄漏的保证。报告与测试不记录凭据值或用户私密正文。

## 6. 实际验证命令与结果

证据目录：`E:/chatgpt/artifacts/dengta-module-reliability-20261006/`。下表为已完成的实际回执；没有用计划命令代替结果。

| 执行目录 | 命令 | 退出码与结果/证据 |
| --- | --- | --- |
| 前端 | `node --test test/diary-lifecycle.test.js` | 0；25/25，diary-fixed.log。 |
| 前端 | `node --test test/nursery-lifecycle.test.js` | 0；38/38，nursery-fixed-38-test.log。 |
| 前端 | `node --test test/moments-lifecycle.test.js` | 0；24/24，moments-fixed.log。 |
| 前端 | `node --test test/receiver-lifecycle.test.js test/receiver-api-lifecycle.test.js` | 0；25/25，receiver-fixed.json/log。 |
| 前端 | `node E:/chatgpt/artifacts/dengta-module-reliability-20261006/receiver-readonly-probe.mjs` | 0；四项实际函数/合成媒体补充探针，receiver-readonly-probe.json。 |
| 前端 | `npm test` | 0；frontend-checks.json、frontend-npm-test.log；包含新专项及既有常规测试。 |
| 前端 | `npm run lint` | 0；frontend-npm-run-lint.log。 |
| 前端 | `npm run typecheck` | 0；frontend-npm-run-typecheck.log。 |
| 前端 | `npm run build:web` | 0；frontend-npm-run-build-web.log。 |
| 前端 | `npx cap sync android` | 0；frontend-npx-cap-sync-android.log。 |
| 后端 | `npm test` | 0；backend-checks.json、backend-npm-test.log。 |
| 后端 | `npm run check` | 0；backend-npm-run-check.log。 |
| 后端 | `npm run typecheck` | 0；backend-npm-run-typecheck.log。 |
| 前端 | `.\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug` | 0；BUILD SUCCESSFUL，gradle-result.json/log；11 个 JUnit suites、35 项、0 failures/errors。 |
| 前端 | `git diff --check` | 0；本报告写入前本次只读复核实际执行，只有 Git autocrlf 行尾提示；最终提交前需再核对本报告。 |
| 证据脚本 | `node .../verify-tools.cjs` | 0；aapt2/apksigner/adb 实际执行，tool-verification.json：版本/证书正确，连接设备 0。 |
| 证据脚本 | `node .../verify-apk.cjs` | 0；apk-verification.json：94 项资产核对，无差异或缺失，四模块标记存在。 |
| 证据脚本 | `node .../protected-check.cjs`、`node .../secret-check.cjs` | 各 0；13 项保护文件不变，已扫描配置私密值未暴露。 |

`.../` 在最后三行指上述证据目录，完整脚本文件名对应回执。APK 当前 ZIP 的逐资产审计另见 current-apk-zip-proof.json；389 项构建源文件哈希见 build-source-proof.json，用于后续发布前核对代码未漂移，不构成可重复构建或真机功能证明。

测试保留 react-test-renderer 上游弃用提示；Gradle 有既存 SDK XML/Gradle 9 弃用提示。命令均按完整退出码和完整日志判定，未把提示当成生产运行故障，也未宣称所有工具无警告。

## 7. APK 产物

- 文件：`E:/chatgpt/artifacts/dengta-module-reliability-20261006/DengTa-2.10.67-115.apk`。
- versionName 2.10.67，versionCode 115；minSdk 31，targetSdk 36。
- 大小：36,309,439 bytes。
- SHA-256：`9d7e300109a6adc218a0e140575c4f47b901d74e9856f9a51515438a9f594941`。
- Debug APK，既有证书 SHA-256：`38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6`。未创建或替换 release JKS。
- 94 项 assets/public 资产核对无差异，生产后端及公开 Supabase 配置标记存在。配置存在不等于线上 API 可用。

## 8. 迁移、浏览器与生产验收状态

| 项目 | 本报告撰写时状态 |
| --- | --- |
| 数据库迁移与重复执行 | 本轮没有新增或执行迁移；不写成通过迁移验收。 |
| Supabase 管理面、RLS 和真实用户数据 | 未验证/未修改。 |
| Android 真机安装、聊天及四模块操作 | 未验证；adb 设备数 0。 |
| 生产模型供应商及真实账号成人向场景 | 未验证；没有据此结论供应商兼容或限制已解决。 |
| 生产多账号、伴侣/会话隔离 | 未验证；已验证合成作用域/迟到响应用例。 |
| 真实电视/浏览器媒体播放、自动播放和 DRM | 未验证；合成媒体 promise 测试不能替代原生播放。 |
| 整体帧率、手机手感、全功能端到端 | 未验证；本轮无可用真实设备性能基准。 |
| 局部浏览器 UI | 真实 CUA 浏览器、390×844、虚构 SDK/fetch 边界：日记报错后“重新读取”成功并显示“日期未知”；家庭报错后 GET 重读恢复合法无孩子入口；动态读取失败明确区别于空列表，再刷新得到合法空列表。browser-final.json 中 fixtureOnly:true、productionAccountTested:false、console:[]。恢复截图为 diary-restored-final-390.png、nursery-restored-final-390.png、moments-restored-final-390.png。receiver-error-360.png、receiver-restored-360.png 是已有局部虚构边界预览。diary-restored-360.png 曾捕获错误页面，明确排除。 |

浏览器工具条最初遮挡导航，根任务只修改 artifact 预览工具条位置后重测；家庭首个虚构空快照缺 actions/events，被 nursery_response_invalid 正确拒绝，补齐实际 DTO 后恢复。这两项是验收夹具问题，不计为产品故障。页面 console 读取为空仅限该虚构页面与本次观察，不能扩大为生产无错误、真实账号数据可用或媒体帧率已验收。

## 9. GitHub、CNB、Render、Vercel 与回滚

| 系统 | 发布前真实状态 |
| --- | --- |
| 前端 GitHub/CNB | 本版尚未提交/推送；本报告不能宣称 v2.10.67 已镜像同步。后续以 frontend-commit.json、frontend-tags.json 等实际回执为准。 |
| 后端 GitHub/CNB | 本地 main 为 8dd525b2d15cada57cacf80d293e9c9cabcf2ad9，工作树干净；本轮未推送，按约定暂缓。 |
| Render 后端 | 本轮未部署或更改配置；当前生产版本未在本报告中实时核验。 |
| Vercel 前端 | 本版部署未在本报告中核验；源码/构建通过不能代替线上资源哈希核对。 |
| APK 发布 | 本地构建和静态验证已通过；本报告撰写时未取得本版上传/发布回执。 |

前端回滚参考提交为 4708f8d8b29ddc38e77dab3fa02ac831dc311da7；本轮无数据库变更，回滚无需回退迁移。若上线后确认回归，应经既有部署流程回退对应前端版本，或创建反向提交后正常推送，不强推、不重置共享工作树。Android 既有更高 versionCode 安装通常不能直接以旧包覆盖降级；需要保留账号数据并按设备安装条件制定回退，不能保证旧 APK 可直接覆盖当前包。本轮未执行任何回滚或平台配置变更。

## 10. 兼容性、风险与剩余工作

同步 ref 锁只约束当前挂载页面，不能代替服务端跨设备全局幂等。AbortSignal 与作用域校验能阻止鉴权期间错范围请求及迟到客户端副作用，但不能撤销服务器已经接收的 POST。网络失败或缺回执仍可能已保存，界面要求先 GET 核对后再决定是否重试，不自动重复写入。

日记使用冻结 api.js 原有 15 秒鉴权/fetch 超时语义，不能保证任意 JSON body 读取都有 deadline；接收端自己的 deadline 已覆盖 body。严格回执校验按当前实际 DTO 子集实现，若后端未来更换 DTO，需要同步维护兼容测试。sessionStorage 被浏览器禁用时配对仍可在当前页内存使用，刷新不能保证恢复；没有改用持久存储或把 token 写入 URL。

后续必须取得本版提交/双端镜像、APK 发布、线上前端资源哈希和后端版本回执；再进行实际设备、真实供应商、Supabase 管理面及生产多账号验收。全软件审查目标仍在进行中，不能因本轮 112 项通过而缩为“四模块全部生产可用”或“整个软件无报错”。
