# 灯塔 2.10.29 / Android 77 / 后端 0.29.6

本轮完成上下文预算、日志详情及错误反馈修复，沿用上一版聊天底部定位与滚动优化。发布推送沿用用户本任务中“做完全套……需要推送就推送”的明确授权。推送前核对 main、GitHub/CNB 目标、工作树、测试与回滚条件。发布和生产验收是独立状态，部署回执另存。

## 根因与证据

1. 日志无法查看：生产最近100条日志编号均为数字、UUID为0；旧 GET /api/errors/:logId 却仅接受 UUID，直接拒绝数字编号。仅查询日志技术元数据，相同编号加 user_id / companion_id 条件可查到1条，HTTP200。见 log-storage-check.json。新增 diagnostic-log-reader.js 支持正 bigint 字符串与旧 UUID，仍使用 scope.db 保留账号和伴侣过滤。没有修改数据库。
2. 上下文超限：装配历史使用 max_tokens 的较小预算，实际 Responses 发送默认预留32000，还受推理档位最低预算影响，两处不一致。提取原输出预算函数供装配和发送共用；30组 provider/输出配置/推理档位实际 payload 回归通过。GPT-4.1 以前会匹配 legacy GPT-4 的8192窗口，现采用官方1047576窗口并限定旧 GPT-4 匹配。上游网关可能另有窗口限制，估算不能代替供应商真实 tokenizer。
3. 日志读取的旧15秒计时仅覆盖响应头，现在覆盖登录准备、请求和 JSON 响应体全程；失败可重新读取，无服务器日志编号可展开本轮诊断。context_budget 日志只记录白名单数值和阶段，不记录输入正文。
4. 错误反馈：新 provider-error-reason.js 只解析失败的供应商请求/错误事件，区分余额不足、额度耗尽、频率、鉴权、权限、模型/地址、上游上下文、参数、超时和服务故障。insufficient_quota 不武断当成余额不足；522仅归连接超时，不能证明内容检查。消息同时给原因、处理办法、稳定码与上游码，查看日志有来源、阶段、HTTP、业务位置和版本。未知原因明确待确认；收到 error_log_id 才宣称日志已记录。

## 文件及行为

- 后端 services/diagnostic-log-reader.js / server.js：修复数字编号读取；tenant 作用域保持。
- services/generation-output-budget.js / generation-budget.js / ai-service.js：复用原 Responses 预算；requestJson 超时给稳定 provider_timeout 来源。没有改提示词模板或装配顺序。
- services/context-budget.js：修正 GPT-4.1 family，防止新版本误匹配旧 GPT-4。
- services/provider-error-reason.js / chat-error-feedback.js / chat-stream-contract.js：失败原因与重试提示，公共错误码不泄露原始错误正文；未知流错误返回 request_failed。
- services/diagnostic-errors.js：白名单 context_budget 数值；保存和读取安全错误反馈；旧日志可用上游码/状态重新分类，拒绝展示保存的私密异常正文。
- 前端 src/error-log-request.js / api.js：日志全程限时；src/ChatErrorLog.jsx：原因、办法、上游代码、预算数字及失败重试；src/chat-error-feedback.js / chat-errors.js：具体反馈、稳定码与日志状态；App.jsx：临时失败消息保留上游技术元数据。沿用幂等重试，不重复保存用户消息。
- package.json / lock、android/app/build.gradle / android-release.test.js：版本29/77、后端0.29.6及测试脚本。其他新测试见下。逐处准确行号见 CHANGE_MAP.md。

## 实际提示词与数据保护

以当前源码为准（旧限制器注册表快照不能代替当前版本）：resolveGenerationPrompt 将用户 agents.md 放在 systemInstructions 首块；其内部是 user_details → unified_system_prompt，或 legacy system/additional/personality → 已有记忆投递副本 → knowledge 文件块。之后保留原计划其他块的相对顺序：附件授权（如启用）、亲密表达（如启用）、可见心声格式、世界书 beforeMemory，再追加已选性别指令。动态上下文以 user 角色插在最新 user 之前，历史角色和接口映射沿用。已有记忆选取上限12条及每条5000字符是基线代码，未修改，不能宣称无限上下文。source-evidence.json 比较本轮 Git HEAD 基线：六个关键装配函数、记忆/输出守卫/设置/请求/凭据保护/架构检查文件内容均一致（统一换行后SHA256）；ai-service 的改动只涉及输出预算函数移出和超时错误元数据。旧冻结整文件哈希因历史授权变化已过期，未伪称匹配。

本轮无数据库写入、迁移、删除或个性化/记忆字段变更。预算在请求投递副本中沿用原有完整用户轮次选择；真实必需上下文超出容量仍报错，不通过修改人设、记忆或重放工具来绕过。技术鉴权、租户、幂等和流终止校验保留。没有新增成人主题检测或业务内容拦截。供应商拒答属于外部供应商限制；供应商/网关522属于外部平台错误，当前修复不能保证消除它们。

## 验证及限制

新增 tests：diagnostic-log-reader（数字/UUID/输入验证/账号与伴侣隔离）、generation-budget-consistency（30种装配到实际 payload 一致性及字段不变）、provider-error-reason（13类样本、隐私、旧日志）、前端 error-log-request（整个请求超时）、chat-error-feedback（原因/动作/稳定码/上游码/真实日志状态）。更新 chat-contract、诊断预算、聊天错误及版本回归。完整 npm test 包含提示词原文/层次、成人内容/普通剧情、外部拒答/记忆污染、分片/终止/错误事件、模型和租户、重试幂等等原有专项。

- backend：npm run check → exit 0；backend-npm-run-check.log
- backend：npm run typecheck → exit 0；backend-npm-run-typecheck.log
- backend：npm test → exit 0；backend-npm-test.log
- frontend：npm run android:sync → exit 0；frontend-npm-run-android-sync.log
- frontend：npm run build:web → exit 0；frontend-npm-run-build-web.log
- frontend：npm run lint → exit 0；frontend-npm-run-lint.log
- frontend：npm run typecheck → exit 0；frontend-npm-run-typecheck.log
- frontend：npm test → exit 0；frontend-npm-test.log
- Android：gradlew.bat :app:testDebugUnitTest :app:assembleDebug --console=plain → exit 0。
- apksigner verify --verbose --print-certs → exit 0；稳定debug证书 SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。
- APK ZIP 解包 + verify-apk.cjs → exit 0；86资源匹配，公开认证配置和生产后端配置存在，凭据模式无命中。APK SHA256：092cdf9480e0e279b9054d4d453957692a37737da80fe9d26f12f1abd117825c。
- 双仓库 git diff --check → exit 0。
- 浏览器390×844实际 ChatErrorLog 组件预览：首次读取失败 → 重试成功显示 65536/45000/32000 与 transport；余额不足原因/动作/代码显示。模拟数据，非真实账号。

数据库迁移：本轮不需要。Supabase仅服务API元数据读取；管理面未验收。Android真机安装/FPS、实际账号日志详情、实际供应商聊天及真实多账号端到端未验证；自动化作用域隔离已验证。旧060性别迁移仍待既有管理权限，当前任务无新增迁移。真实超过模型/网关容量和上游故障可能继续发生。错误匹配支持已列代码及明确余额/额度文本；供应商未给具体原因时保持未知，不展示未经脱敏的全文。

## 同步与回滚

GitHub、CNB、Render、Vercel、APK：发布前本地已验，发布后以 DEPLOYMENT.md、github-status.json、backend-health.json、live-assets.json、published-apk.json 为准。安装包仅debug验证版（Android12+），GitHub私有仓库下载需账号权限。回滚前端基线 14ba95db574f5dee9d44e63736941fbfb321a025、后端基线 5391dffcdade9dc67c7f696e39d9733236a367fb，通过新提交回退并重新部署；本轮无数据库回滚。Android不得为降级随意卸载导致本机数据丢失。

官方模型容量来源：[GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)、[mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano)，本任务已打开核验。

# 逐文件变更位置（当前工作树）

## backend

- `package-lock.json`: L3, L9
- `package.json`: L3, L8, L105
- `server.js`: L1, L633, L6553
- `services/ai-service.js`: L1, L1616, L1898
- `services/chat-stream-contract.js`: L1, L8, L39, L82, L86, L92, L98, L103, L169
- `services/context-budget.js`: L12, L107
- `services/diagnostic-errors.js`: L5, L30, L53, L64, L75, L79, L86
- `services/generation-budget.js`: L1, L7, L9, L15, L24, L64, L95
- `test/chat-contract.test.js`: L213, L222, L234, L243, L267, L322, L333, L352
- `test/diagnostic-errors.test.js`: L20
- `services/chat-error-feedback.js`: L1（新增）
- `services/diagnostic-log-reader.js`: L1（新增）
- `services/generation-output-budget.js`: L1（新增）
- `services/provider-error-reason.js`: L1（新增）
- `test/diagnostic-log-reader.test.js`: L1（新增）
- `test/generation-budget-consistency.test.js`: L1（新增）
- `test/provider-error-reason.test.js`: L1（新增）

## frontend

- `android/app/build.gradle`: L18
- `package-lock.json`: L3, L9
- `package.json`: L4, L41, L56
- `src/App.jsx`: L4941
- `src/ChatErrorLog.jsx`: L3, L35, L42, L51, L61
- `src/api.js`: L2, L156
- `src/chat-errors.js`: L1, L21, L73, L78, L85, L93, L121
- `test/android-release.test.js`: L75
- `test/chat-error-sanitization.test.js`: L44, L51, L66
- `src/chat-error-feedback.js`: L1（新增）
- `src/error-log-request.js`: L1（新增）
- `test/chat-error-feedback.test.js`: L1（新增）
- `test/chat-error-log-preview.html`: L1（新增）
- `test/chat-error-log-preview.jsx`: L1（新增）
- `test/error-log-request.test.js`: L1（新增）

