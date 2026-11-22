# 2.10.61 / 109 聊天流式渲染

## 问题与修改

App 收到 text 事件后本来就立即追加正文（src/App.jsx:4741），没有人为逐字延迟。卡顿的一处可复现原因是每次分片重新创建所有历史行的 skinPresentation、可见心声和回调，导致已有 ChatMessage memo 失效。

src/ChatTranscript.jsx:7 把每条消息的派生展示放入 memo 行，只传入该行消息、前后角色、主题及该行心声状态。相邻分组、附件、昵称、头像、心情和主题仍然参与更新。src/use-latest-callback.js:3 通过提交后的 layout effect 更新回调代理，使保留的行调用最新 App 状态，不使用忽略函数的比较器。src/App.jsx:6477 接入该组件。

没有新增流式缓存、打字计时器、动画延迟或原位 DOM 修改；网络、SSE、重试、保存、错误及提示词装配保持不变。消息数组及整个 App 仍会更新；此修复没有虚拟化全部历史，也不等于所有性能瓶颈已经消除。

## 验证

test/chat-transcript.test.js:11 在 Vite SSR 加载实际 ChatMessage 和 ChatTranscript，通过仅测试转换插入的观察器计数。120 条虚构记录中，旧属性组装每个分片使 120 行执行，优化后 3 个分片各仅使最后 1 行执行。每次 React commit 后检查最新正文，引用调用最新闭包，心声及其错误、相邻分组、主题、头像和昵称变更正常更新。

test/chat-skin.test.js 与 test/inner-monologue.test.js 的源位置检查更新到新组件，原有行为断言保留。新增测试接入 npm run test:chat-latency 及全量 npm test。

本地浏览器使用实际组件和生产 CSS、120 条虚构记录、模拟 60 个到达分片，无账号或模型调用。390×844 完成后保持底部，观察到未完成时的部分文字；360×740 打开后在底部，翻阅旧消息后收到新分片时 scrollTop 不变；两尺寸无横向溢出，引用操作正常，console error 为 0。React Profiler 同页样本累计 actualDuration 为旧方式约 2200.9 ms、优化约 184.3 ms（各 60 次提交）。这是开发预览中的渲染测量，不是网络延迟、完整帧耗时、真机 FPS 或固定性能保证。

前端 npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android，以及后端 npm test、npm run check、npm run typecheck 均退出 0。Android testDebugUnitTest / assembleDebug 退出 0；原生单测任务 UP-TO-DATE，35 个用例、11 套件为保留的通过记录。没有连接 Android 真机，真实供应商和已登录聊天本轮未验收。

## 数据与提示词边界

没有后端代码或数据库修改、生产用户数据写入、记忆清理、个人指令修改、成人关键词逻辑或供应商配置更改。13 个保护文件相对本轮基线一致。既有用户 agents.md 装配仍为 user_details → unified_system_prompt（缺失时旧字段原文）→ 选中的记忆 summary → 知识文件块，位于 resolveGenerationPrompt 的 systemInstructions 前部（后端 ai-service.js:344、387、3524、3641）。没有重新判定外部供应商限制，也不能由此证明供应商响应更快。

版本 2.10.61 / 109 使用已有测试签名，最低 Android 12 / API 31。APK、生产资源、GitHub/CNB 同步和下载权限的最终状态以本地 artifacts/dengta-chat-render-20261001/final-state.json 为准；代码检查通过不是生产端到端全部通过。
