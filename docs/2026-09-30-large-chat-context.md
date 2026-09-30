# DengTa 超长上下文优化：2.10.30 / Android 78 / 后端 0.29.7

用户本轮明确要求增大上下文，沿用本任务“做完全套……需要推送就推送”的发布授权。修改只涉及历史读取预算、自动压缩阈值、相关设置入口和版本。开始时双仓库main工作树干净；前端基线e0dfcbfe818011cc7465198bf5955c336a030b67，后端基线2fa28106ec7b7dd5245d2e6ce99bc8fff425633e。

## 根因与行为

- 后端默认context_turns=20、前端与旧服务器默认50，历史最多按轮数×2+20读取，阻止大窗口利用更长历史。新账号默认0（按模型容量）。已保存的轮数不被静默覆盖；旧账号可在设置→角色/记忆与主动消息点击“使用模型最大上下文”，通过现有自动保存更新context_turns=0与compression_threshold=0。
- 自动压缩阈值原来是窗口50%并封顶80000，现为窗口80%，没有80000封顶。GPT-4.1应用窗口1047576时阈值838060；2000000应用窗口时阈值1600000。自定义压缩阈值最高10000000 token；它控制触发压缩，不能改变单次模型请求容量。
- 历史旧读取只有单次.limit，受PostgREST单次行数上限影响。新增256条一批的时间戳+ID游标分页，主聊天从最新向旧读取，压缩从最旧向新读取；相同时间戳保留微秒精度。每页继承账号、伴侣、会话、visible/context_visible与context_reset_at条件，达到token或扫描条数预算就停；分页失败明确抛错，不能冒充已完整读取。
- 用户可指定最多1000000轮；最终条数仍受模型窗口约束。自动扫描上界根据每条24 token最小预留计算，实际正文和工具元数据计入读取预算。压缩只处理已读的前缀，剩余记录继续保留。长历史装配改为push后一次reverse，避免反复头部插入。
- 最终请求仍保留输出预算、工具/附件和固定指令检查。未知模型继续现有64k估算，未伪造百万容量。模型窗口表本轮未改；它是应用估算，不是供应商/网关保证。上游真实容量、价格、长输入速度尚未实测；更长输入可能增加首字等待和费用。

## 提示词、数据与边界

整个services/ai-service.js与HEAD哈希一致，提示词合同v8、装配顺序和用户字段优先级均未改。沿用agents.md中的用户详情→个性化指令（统一/旧字段回退）→记忆→知识块，并继续原有世界书和业务补充、动态用户上下文与历史装配。没有增删本地内容限制、供应商错误分类、流终止校验、持久化拒答处理或幂等机制。没有生产数据库写入、删除、迁移或账号批量修改；已保存的人设、记忆和摘要未读取或改写，原context_reset_at不恢复旧历史。

证据：backend-source-evidence.json（提示词整文件与相关保护文件SHA256一致）、frontend-source-evidence.json、privacy-receipt.json（个性化字段保存逻辑逐段哈希一致；前端仅默认轮数改变）。准确文件与行号见CHANGE_MAP.md。

## 测试及实际结果

- android: gradlew.bat :app:testDebugUnitTest :app:assembleDebug --console=plain → exit 0
- backend: npm run check → exit 0
- backend: npm run test:context-reset → exit 0
- backend: npm run typecheck → exit 0
- backend: npm test → exit 0
- frontend: npm run android:sync → exit 0
- frontend: npm run build:web → exit 0
- frontend: npm run lint → exit 0
- frontend: npm run test:android-release → exit 0
- frontend: npm run test:settings → exit 0
- frontend: npm run typecheck → exit 0
- frontend: npm test → exit 0

新增后端context-history测试覆盖5001条跨页、REST分页上限73条、同时间戳、并发新消息、每页租户/伴侣/会话条件、重置、压缩分页、分页失败、预算停止、原文不变与旧自定义轮数保留。约70万token模拟历史通过GPT-4.1窗口的装配和发送检查，小窗口仍按预算裁取近期历史。新增前端组件测试覆盖一键启用、自动/指定轮数切换、原文与保存载荷。390×844模拟页面实测百万轮输入与自动模式。

首次前端全量测试exit1是旧版本77断言，首次lint exit1是测试预览组件未导出；已修正并重跑为exit0。模拟预览热更新曾重复createRoot，已缓存预览root并用新页面复查。构建有既有chunk体积提示和Gradle弃用提示，未因本轮改动扩大无关模块。

## 构建、发布与未验收事项

APK签名证书沿用38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6，Android12+。apksigner退出0；86份APK公共资源与本地构建一致，公共登录配置和生产后端地址存在，无检测到私钥格式。SHA256见apk-verification.json。没有新增SQL，现有迁移与租户回归已在全量测试运行。

本地构建通过不等于真实端到端验收：adb devices无设备，安卓真机安装/长对话/帧率、真实账号与模型调用、Supabase管理面、多账号生产隔离均未验证。GitHub/CNB/Render/Vercel与APK实际发布状态另存DEPLOYMENT.md，未取得回执前不宣称上线。

发布目标：两个既有GitHub main、CNB frontend-main/backend-main、现有Render/Vercel自动部署、前端私有仓库prerelease v2.10.30。推送前需核对工作树、测试、无新增迁移与这些目标；回滚可恢复上述基线代码或安装2.10.29，不需要数据库回滚。

# 超长上下文变更位置

## frontend

- `android/app/build.gradle`: L18
- `package-lock.json`: L3, L9
- `package.json`: L4, L22
- `src/App.jsx`: L49, L8511, L8536, L8539, L8542, L8553
- `src/index.css`: L10436
- `src/settings.js`: L18
- `test/android-release.test.js`: L75
- `src/ChatContextSettings.jsx`: L1（新增）
- `test/chat-context-preview.html`: L1（新增）
- `test/chat-context-preview.jsx`: L1（新增）
- `test/chat-context-settings.test.js`: L1（新增）

## backend

- `package-lock.json`: L3, L9
- `package.json`: L3, L21
- `server.js`: L2, L891, L3289, L3291
- `services/context-budget.js`: L217, L219, L275, L277
- `services/context-reset.js`: L16, L87, L97, L105, L110, L111, L238, L241, L246, L253, L256
- `services/settings-store.js`: L21, L175, L181, L184
- `test/context-reset.test.js`: L28, L43, L65, L67, L71, L74, L111
- `services/context-history.js`: L1（新增）
- `test/context-history.test.js`: L1（新增）

