# 风格提纯修复：代码与验收范围

## 已确认的问题

1. `services/style-distill.js` 原先把全局 Supabase 客户端传给 getSettings，未使用认证请求的 scope.db，可能选到其他账号的默认接口。改为当前账号及伴侣隔离的客户端；默认模型不再由全局首行配置决定。
2. 原蒸馏分析指令放在 messages 的 system 项中，现有历史消息适配器把该项当作 user。改用现有 runtimeContext 参数，保留原分析模板和既有 personalization/agents.md 架构。
3. 前端文件导入把 apiFetch 返回的 Response 当成 JSON，导致成功解析后仍提示失败；现在读取 JSON，并保留失败的技术诊断。
4. 20MB 上传错误发生在 multer 中间件，原 handler 内的捕获无法处理；现在在中间件回调中明确映射。
5. 移除提纯输出的静默 12000 字截断；长文件仍按原有 60000 字输入限制，明确显示截取信息。
6. 未配置 API 时底层 placeholder 回显不得当作提纯结果。

## 本次真实调用及结论边界

用户已登录正式站 https://www.dengtahome.com/ 并授权用当前默认接口/模型验收。仅提交虚构角色星灯的聊天样例，没有点击应用到个性化指令。

修复前真实调用返回 `provider_model_unavailable`，复现模型/接口不可用。该反馈不能单独证明是哪家网关、哪个地址或模型返回 404；未隔离配置是已确认的代码缺陷，是否是本次唯一根因需发布后同账号复测。

修复后的生产调用结果、日志查看和上线版本另见补充验收记录。自动化通过不等于真机或生产账号验收。

## 用户数据与提示词

不需要数据库迁移。不执行用户数据库更新、历史清理、提示词/记忆覆盖。提纯结果仅供前端预览，用户主动点击应用才写入原有设置。

保持现有 agents.md 注入与个性化内容优先级；专用分析指令进入原有 runtimeContext，再组装原始材料 user 消息。不修改主聊天模板、供应商输出守卫或成人主题处理。

## 自动化与发布

- 后端 `node --test test/style-distill.test.js`：账号/伴侣隔离客户端、默认/指定模型、输入校验、空结果、multipart 导入、超过 20MB、多文件拒绝、长文件提示、占位回显及诊断隐私。
- 前端同名测试：Response JSON、multipart 头、POST 不重试、404 元数据、上游 HTML 不公开，以及认证/响应体阶段的整体超时。
- 双方 `npm test`、后端 `npm run check`、双方 `npm run typecheck`、前端 `npm run lint`、`npm run build:web`。
- `npm run android:sync` 后执行 `:app:testDebugUnitTest :app:assembleDebug`；签名保持原稳定 debug 证书。Android 真机尚未验证。
- 发布版本：前端 2.10.31 / Android 79，后端 0.29.8。只推当前 main，不强推。回滚可恢复前端 cd2bfdd 和后端 f2b09ed 的先前部署；无需数据库回滚。

实际退出码与资源签名收据位于工作区 `artifacts/dengta-style-distill-20260930`。GitHub、CNB、Render、Vercel 及 APK 同步状态以最终验收收据为准。

## 下一步产品想法

- 提纯前选择目标发言者，减少把用户语气混入角色。
- 并排比较材料与提纯结论，标出材料不足的维度，让用户决定是否补充。
- 只用虚构短场景试演提纯风格，确认喜欢后再手动应用；提供可恢复的版本历史。

本轮已落地模型选择和 Markdown 下载。其余想法尚未实现。
