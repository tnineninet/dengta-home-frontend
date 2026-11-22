# DengTa 项目交接文档（Context Handoff）

> 生成时间：2026-08-18
> 用途：在新对话中继续本会话任务时，让新的 deepseek 快速获得完整上下文。

## 一、使用方法（新对话开头说）

> 请先读取 E:\chatgpt\dengta-home-backend\CONTEXT-HANDOFF.md（后端项目根目录），
> 然后按其中"未完成任务"继续。所有工具调用必须通过 run_code 内的 tools.xxx。

## 二、项目位置与凭据

- **后端**：E:\chatgpt\dengta-home-backend（Node/Express，Render 部署 https://dengta-home-backend-rkmq.onrender.com）
- **前端**：E:\chatgpt\dengta-home-frontend（React，线上 www.dengtahome.com）
- **kiwi 记忆网关**：E:\chatgpt\dsh\kiwi-mem-dengta（远程服务器 8080，DengTa 生产 KIWI_MEM_URL 指向它）
- **教程**：E:\chatgpt\agent-tutorial\agents-from-scratch-main（LangChain 教程，已通读）
- **Supabase**：ref nyyqizwrlmejpfdhgrnd；service key 与管理 token 见会话（若新对话没有，用户提供）
- **登录**：2458077782@qq.com / alanwalker520（桃桃，user_id 3a86a0d7-a3a2-4034-8868-1afd8889e1da，companion 小小灯 d99ebbd8-5823-4e39-8be4-79a92be965c0）
- **git**：GitHub 网络波动频繁，用 Node execSync 重试循环推送；用户身份 buyaocaowo555-collab

## 三、产品底线（用户多次强调，绝不违反）

1. **成人内容绝不拒绝**：DengTa 是成人伴侣产品，任何"敏感/不适当"判定都不许存在；只过滤真正的"拒绝回答"句式（作为AI我无法/不能）。
2. **agents.md 只允许个性化+记忆原文**：每用户 agents.md = user_details + unified_system_prompt + memories 一比一拼接，以 <file path="agents.md"> 块注入 systemInstructions[0]；不许加包装/标题/过滤/脱敏。
3. **文件驱动**：agents.md 每轮从数据库实时组装，用户改内容下一轮即生效。
4. **授权纪律**：用户授权自主修改，但改用户数据（provider/模型/会话）前先备份并测后恢复；汇报必须有实测证据。

## 四、已完成的核心功能（全部已推送部署）

| 功能 | commit | 状态 |
|---|---|---|
| 每用户 agents.md 注入（<file> 块，systemInstructions[0]） | db803dd 等 | ✅ 生产生效 |
| agents_md_read 工具 + agents.md 状态端点 | 7f6353e / 63bbd38 | ✅ |
| 工作区工具（list/read/write/delete，Supabase Storage 每用户隔离） | 527ae93 | ✅ |
| 工具 input_schema 修复（Anthropic 网关剔除无 schema 工具） | 9c484fc | ✅ 根因修复 |
| 工具顺序重排（核心前置，上游截断 43 个） | 259395b | ✅ |
| 心声修复（卷首块 + 每轮动态格式提示） | db57bd6 / d7c4c6c | ✅ 实测 complete |
| AI 失忆修复（未知模型窗口 64k + 压缩保底 8 条） | e9ba5f3 | ✅ |
| 全模型窗口调准（gpt-5.x 256k、qwen3/kimi 256k、deepseek 128k、llama-4 1M） | d0de953 | ✅ |
| 压缩阈值按模型自适应（8k→80k）+ context_turns 生效 | 91be790 | ✅ |
| 历史 1 万条+自动扩容；删除敏感过滤（只留拒答） | 6ce388e | ✅ |
| kiwi 记忆打通（recall/reportChatTurn/import 65 条，超时 60s） | 030186a | ✅ 跨会话记忆实测 |
| kiwi 健康检查（启动日志+health 端点，emb 不可用不再静默） | 489e51b | ✅ |
| 天气系统（open-meteo 免费源） | 既有 | ✅ 实测大理天气 |
| 位置系统修复（058 迁移建表 + scope 注册 + upsert） | 8eb7539 / e2a9633 | ✅ 全链路实测 |
| timeline 权限修复（scope 表注册） | ff021bb | ✅ |
| HITL 确认门控（workspace 删除/覆盖需 confirm） | bec5e37 | ✅ |
| **意图路由 triage**（任务/敏感/情绪分类注入） | 8775b2d | ✅ |
| **评估体系**（golden dataset 18 例 100%） | 8a313e1 | ✅ |

## 五、未完成任务（按优先级）

1. **emb 模型验证**：用户已在 kiwi 面板加了"咸鱼流动"emb 模型。DengTa 的 /api/v2/memory/health 端点部署后（489e51b 可能还在部署队列）调用验证 embedding_available；若不可用，在 kiwi 面板检查供应商是否支持 /embeddings。
2. **心动大冒险上游拒答**：lingyu/gpt-5.6-sol 拒成人正文（"我不能写露骨性爱场景"）、新疆 Qwen 返回空。需要换支持成人内容的 provider（deepseek 官方 key 用户可提供）。
3. **每日一拍无数据**：daily-shots today=null（功能正常，用户今天没拍）。
4. **HITL 前端确认 UI**：门控已后端实现，前端确认交互待做（可选）。
5. **意图路由升级为 LLM 分类**：当前是规则+关键词（评估 100%）；可升级为结构化 LLM 分类（教程 Part 1 triage 节点）。
6. **工作区管理前端页面**：可选。

## 六、关键架构（新对话必须知道）

- **提示词链路**：server.js /chat/stream → executeChatTurnOnce → resolveGenerationPrompt（9 架构统一分发）→ agents.md unshift 到 systemInstructions[0] → provider 序列化
- **上下文**：runtimeContext 数组（含 triage/agents-md 说明/工作区说明/心声格式提示/featureHints 等）作为 user 消息插入最新用户消息前
- **记忆**：本地 memories 表（压缩产物，阈值按模型窗口）+ kiwi（recall+report，65 条）+ 每轮 agents.md 注入
- **工具**：60+ 工具，核心前置（workspace/agents_md/whereabouts/timeline 最前）；无 input_schema 会被 Anthropic 网关剔除
- **git 推送**：GitHub 网络波动，用 Node execSync + 12 次重试循环；PowerShell 里 git 输出有异常时改用 execSync

## 七、用户偏好

- 中文汇报、要实测证据（数据库/API 验证）、不报"应该没问题"
- 成人产品底线（见三）
- 敏感信息不过滤、用户写啥就是啥
- 走前人路（教程/GitHub 参考），不自己摸
