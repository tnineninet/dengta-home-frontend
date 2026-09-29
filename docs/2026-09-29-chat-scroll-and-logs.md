# DengTa 2.10.28 / 76 — 聊天滚动与日志修复

## 根因与改动
- App.jsx:3002 挂载会话时直接定位底部，移除跨页面旧位置恢复及延时重复纠偏。上翻阅读暂时停止自动跟随，回到底部再恢复。ResizeObserver 覆盖图片/长内容和键盘视口变高。
- src/chat-scroll-controller.js:1 新增独立滚动控制器和清理逻辑，区分用户上翻意图与布局/程序滚动；防止刚上翻时遗留的 bottom scroll 事件重新开启跟随。
- App.jsx:6594 私有头像只按角色加载一次，共享 blob URL。ChatMessage eager 显示头像，PrivateMedia / ChatBackground 异步解码。
- src/native-feel.css 与 sun-glass-chat.css: 去掉聊天行 96px 估算高度、聊天列表整体位移、逐气泡 backdrop blur；固定背景独立绘制。弹窗仍保留原来的动画。超长历史首屏仍需实际布局，尚未引入列表虚拟化。
- 原 ChatMessage 失败缓存会阻止后续重新请求；新 ChatErrorLog.jsx 提供显式重试、404/授权/超时提示和无服务器编号时的本轮诊断；失败不展示上游原始报错文本。api.js:154 日志请求增加15秒等待响应上限。
- 没有改后端、数据库、用户设置/记忆、提示词装配或成人内容处理。API diff 仅日志查询超时。原小棉花项目未修改。

## 验证
前端 npm test、npm run lint、npm run typecheck、npm run build:web、npm run android:sync 均退出0。后端 check / test:prompt-layers / test:prompt-content-regression / test:provider-output-guard / test:chat-contract / test:persistent-memory-filter / test:intimate-duel 均退出0。具体命令、耗时、日志见 validation-summary.json。
Android :app:testDebugUnitTest :app:assembleDebug 退出0；apksigner verify退出0；86项APK内置资源与dist核验一致，生产后端和公开认证配置存在，凭据模式扫描无命中。git diff --check退出0。
浏览器390px测试页：50条首次打开距离底部0；90条异步历史与缩小视口后误差约1px；上翻后距离510，追加一条后661，following保持false，证明未被强拉。这是无真实账号的组件/样式回归，不等于真机端到端验收。

## 仍需定位的偶发错误
9月29日仅查询服务器最近100条脱敏技术元数据，不读取私聊正文、不做写操作。可区分8条上游HTTP522、1条上游event错误、3条上下文预算超限，另有通用request_failed记录。样本跨请求，不代表全部属于当前用户；无法用其断定本次按钮失败的具体网络/账号原因。现有诊断对部分路由只保留 :value，不能反推具体业务。
上下文预算错误的现有产品提示是选择更大窗口模型或减少本轮附件，本次未缩短/重写用户提示词及记忆；外部522未宣称被本次界面修复消除。真实账号日志点击、实际供应商聊天、Android真机帧率及多账号验收未验证。旧的060性别字段迁移仍未执行，本次不涉及迁移。

## 发布
包：DengTa-2.10.28-76.apk（Android12+，稳定debug签名，与2.10.27一致），SHA256见apk-verification.json。GitHub/CNB/Vercel真实状态将在发布后补录；后端保持0.29.5，不需部署。回滚可使用上一前端提交57e4ae0及其Web构建；不涉及数据回滚。APK降版本不能保证原地安装，切勿为降级卸载并丢失本机数据。
文件逐处行号见CHANGE_MAP.md。完整产物目录：E:/chatgpt/artifacts/dengta-scroll-smoothness-20260928。
