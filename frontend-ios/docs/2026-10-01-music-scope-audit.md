# 2026-10-01 音乐导入、登录和账号范围专项

本轮前端基线 main `06c999080bc2cd5ad2e93ec8bfa7d0c5a1cff331`（2.10.46/94），后端基线 main `cd26e20acda6bf696645ede6c603abf0a6c7021e`（0.29.19）。开始时两工作树干净；本轮前端 2.10.47/95，后端源码不变。沿用用户在当前任务中明确授权的推送、部署和 APK 交付；不更改仓库可见性，不执行数据库迁移。

## 根因、修改位置与实际行为

1. 原音乐供应商、Cookie、收藏及导入入口未完整固定发起请求时的账号/伴侣；原生登录、文件读取等异步动作返回后可能继续执行旧页面的下一步。多数界面只用 React 状态防双击，重绘前仍可能重复请求。
2. MCP 状态 API 的实际回执为 `{status:{logged_in,account_name,...}}`；旧设置面板可能直接把对象交给 React 渲染。保存操作没有有效回执时，也可能显示成功。部分歌单详情点击未捕获读取错误。
3. MCP 连接保存后刷新失败，被当成整体保存失败；Cookie 断开失败仍清空界面状态。首次登录检查或歌单读取晚于新操作返回时，还会覆盖新状态。以上均为本地状态和协议处理问题，不能据此归因于外部供应商内容限制。

文件均在前端仓库，行号为本次最终源码。不是整文件格式化；复用原接口、技术认证、账号作用域及脱敏函数。

| 文件及行号 | 修改目的与行为变化 |
| --- | --- |
| src/music-request-scope.js:1、10、18 | 捕获并验证账号/伴侣及取消信号；页面代次和任务同步锁；替换读取、取消操作、旧 finally 不能释放新锁。 |
| src/use-music-scope.js:5 | 生命周期和身份切换取消旧任务；组件实例按身份重新初始化。 |
| src/music-operation-feedback.js:3、19 | 使用现有 publicChatErrorMessage 脱敏；稳定错误码始终可见，HTTP、已记录日志、允许的位置按回执展示；未知来源不冒称 DengTa；已格式化诊断不重复。统一任务成功/失败及迟到回执处理。 |
| src/music-listening.js:14、29、35、160、175、353 | 28 个现有异步适配方法全部接受兼容的可选 options；请求前后验证发起身份。歌单导入、连接和 Cookie 保存/断开必须收到对应回执；MCP 状态解开 status 对象。上传 JSON 解码后再次验证范围。 |
| src/MusicSettings.jsx:35、66、76、85、93、117、149、208 | 设置曲库、来源选择、搜索、歌单详情、导入、删除、剪贴板、文件读取和上传使用固定范围；手动刷新与详情选择丢弃旧读取。连接读取独立于歌单刷新。失败保留输入；已保存但播放器刷新失败单独说明。上传结束后页面已取消，不再创建歌单；后续保存失败保留诊断元数据并提醒先刷新确认。 |
| src/TogetherMusic.jsx:60、192、398、412、431、448、551、579、596、612、682 | 曲库、外部打开、MCP、Cookie、搜索、推荐/历史、收藏及分享导入接入同步锁和范围验证。原生浏览器返回后，范围失效则不再读取 Cookie 或保存登录态。断开失败保留连接。登录变更取消首次状态检查，旧检查不能覆盖已确认的新登录。保存成功与列表/播放器读取失败区分；外部手动播放进度携带身份。内嵌导入设置传递相同范围。 |
| src/App.jsx:7990 | 设置音乐组件按账号/伴侣键重建，防止沿用上一身份的临时输入和曲库。 |
| test/music-request-scope.test.js:1 | 实际 28 个适配方法与模拟 API/auth 运行；固定身份、取消、迟到读取、失效写入、锁所有权、状态解包、缺失回执、脱敏、错误来源和诊断去重。 |
| test/music-operation-ui.test.js:1 | 实际 React 组件及实际适配器配模拟服务；状态对象渲染、最新歌单/曲库、双击导入、切账号、关闭上传、断开失败和重试、取消原生登录、首次 Cookie 检查迟到。 |
| test/music-listening.test.js:73、76、112；test/together-music-lifecycle.test.js:1 | 更新携带作用域参数的源码断言和真实 Cookie/status 回执结构；保留旧行为测试。 |
| package.json:4、71；package-lock.json:3；android/app/build.gradle:18；test/android-release.test.js:75 | 2.10.47/95；两个新运行测试加入现有 npm test 路径；沿用稳定 debug 签名，不使用 release JKS。 |

本轮没有新增成人主题关键词检查、替代回复或模型切换。未调用真实 LLM、网易云、MCP 或收费接口；不会把模拟适配测试称为外部服务兼容验收。

## 提示词、用户数据及记忆保护

没有 SQL、迁移、生产用户数据删除或设置写入，后端没有 diff。真实私人消息、Cookie、API Key 和令牌没有写入测试、提交或报告，测试只用虚构样例。APK 检查只在内存比较已配置私密值，输出布尔结果。

后端 services/ai-service.js:387、3640 装配保持基线：agents.md 首块按用户详情、统一个性化指令（未配置则 legacy 原字段）、选中记忆摘要、知识文件块组装；随后仍为已有 system 指令及可见心声/世界书相关块；动态上下文保留在最新用户消息之前。没有修改长度、优先级或持久化内容。既有记忆选择限制仍存在，不声称无限物理上下文。

最终回执逐字核对前后端 12 个保护文件（只规范化 CRLF）：前端 api.js、chat-errors.js、chat-idempotency.js；后端 ai-service.js、persistent-memory-filter.js、provider-output-guard.js、chat-stream-contract.js、settings-store.js、chat-request.js、prompt-security.js、server.js、check-prompt-architecture.mjs。完整哈希和源码不变结果在 artifacts 最终 JSON。

## 实际验证命令和结果

npm/Gradle 命令在对应仓库运行；下述工具位于 `E:/chatgpt/artifacts/dengta-music-scope-20261001`，保留全量日志、退出码和机器回执。

| 实际命令 | 结果 |
| --- | --- |
| 前端 node test/music-request-scope.test.js | 0；28 个实际适配器、取消及严格回执、错误诊断通过。 |
| 前端 node test/music-operation-ui.test.js | 0；上述实际组件竞态和失败/重试场景通过；供应商和原生桥为模拟。 |
| 前端 npm test | 0；95 个 .test.js 全部接入，另运行原有脚本。最终修改后完整重跑通过。 |
| 前端 npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 各 0，最终源码构建并同步到 Android。 |
| 后端 npm test、npm run check、npm run typecheck | 各 0；125 个 .test.js 全部接入；后端无 lint 脚本。 |
| 前端 .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 0，BUILD SUCCESSFUL；原生 Java 未变，testDebugUnitTest 为 UP-TO-DATE；核对已有 33 用例/10 suites、无失败，不称本轮重新执行了原生单测。 |
| 前后端 git diff --check | 各 0。 |
| Codex bundled Python -X utf8 extract-apk.py；node verify-apk.cjs；node secret-check.cjs；Python -X utf8 verify-native.py | 各 0；90 public assets 与本次 dist 匹配，含新增代码标记，DEX 原保护存在；3 个私密值比较未发现暴露。 |
| E:/chatgpt/DengTa-production-tools/android-sdk/build-tools/35.0.0/apksigner.bat verify --verbose --print-certs 本轮 APK | 0，v2 有效；稳定 debug 证书 SHA256 为 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。 |
| 同目录 aapt2.exe dump badging 本轮 APK | 0；home.dengta.app / 2.10.47 / 95 / min31 / target36。 |
| E:/chatgpt/DengTa-production-tools/android-sdk/platform-tools/adb.exe devices | 0，设备列表为空；未进行真机安装。 |

开发中首次全量测试退出 1：旧断言不接受新增的作用域参数，且旧 status 断言不符合修复后的实际结构；更新断言并保留运行测试，最终完整检查通过。早期 lint 的无用赋值也已修复。React test renderer 弃用、Vite 大 chunk、Gradle 弃用等警告仍有，未声称零警告。

APK：`E:/chatgpt/artifacts/dengta-music-scope-20261001/DengTa-2.10.47-95.apk`，36,259,001 字节，SHA256 `6e079759084368ac38e9c6e966152e806c3097196d28d2908a368edcd8bc020f`。Android 12+，稳定 debug 签名测试版。

## 发布、回滚及未验证事项

写入本文时本地构建和检查完成；GitHub/CNB 提交与标签、APK 上传和生产网页资源以 artifacts/final-audit.md、final-state.json 最终实时回执为准。后端保持 0.29.19，不创建空提交。仓库保持原可见性；如果仍私有，GitHub 下载须有权限的登录账号，不能称免登录公开下载。本地 APK 为直接交付路径。

前端 Git-push 发布前确认 main、基线、测试、范围和私密检查；如需回滚，可对本轮前端提交做普通 revert 后重新构建发布，不强推、不修改数据库或用户字段。APK 不使用正式 release 签名。

未验证：Android 真机、真实网易云/MCP 播放和登录、实际账号成人场景、生产多账号隔离、Supabase 管理面、Vercel 平台 READY/构建及运行日志、实际帧率。内置浏览器此前绑定超时；本轮没有将静态页面请求或组件测试替代真实账号交互。

已传到服务器且通过原身份认证的写入，前端取消不能撤销；本轮不自动重试供应商写操作。导入后上传文件残留、跨设备替换原子性和服务端导入幂等仍需审查；外部 App 打开与服务器播放记录目前并行，记录失败可能使整体显示失败，也仍需分开反馈。实际可用性及版权由供应商决定。

歌单文本仍为 1 MiB，音频上传仍为 20 MB；这与聊天附件容量不同，未宣称所有格式或 1 GB 音乐文件已适配。下一轮优先服务端幂等、原生配置/暂停、跨设备替换及聊天听歌请求轮询；趣味改进可在这些回执可靠后增加“AI 点歌候选试听卡”，不能把建议写成已实现。整体长期目标保持进行中。
