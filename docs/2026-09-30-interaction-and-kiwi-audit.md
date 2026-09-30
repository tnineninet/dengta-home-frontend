# 灯塔聊天、战斗、共看与 Kiwi 检查记录

本轮目标：战斗与共看实际操作恢复、多行输入、按钮反馈和动画减负、检查流式首段显示、检查记忆账号/伴侣隔离。前端 2.10.36 / Android 84；后端 0.29.12。基线前端 `9fb58fdfab2eb607b9bcafafccd1f803aa9b6a70`，后端 `8288f80edc28de8b60cd60371b607269d2a0f057`。

## 根因和修复

| 位置 | 已确认的问题 | 本轮行为 |
| --- | --- | --- |
| `src/watch-room.js` 创建/加入/播放/聊天 | JSON Content-Type 下发送了对象而非 JSON 字符串 | 明确序列化请求；统一成员显示名；所选邀请码不能被附加字段覆盖 |
| `src/watch-room.js` 实时订阅 | fetch 相对路径绕过配置的后端地址与统一鉴权 | 使用 apiFetch；正确处理分片、CRLF、媒体类型和结束事件；401/403/404/410停止重连，临时故障退避重连 |
| `src/DlnaCastPlayer.jsx` | 创建/加入吞掉具体错误；已加入后错误区域不可见 | 显示接口错误和重试操作；连接恢复清除错误，成员已加入后也显示连接失败 |
| `src/IntimateDuel.jsx` | 同一事件循环可连点；重开后旧请求覆盖新局；拒答留下半回合状态；存档只有账号粒度 | 同步请求锁、取消与请求身份校验；90秒截止；拒答/超时回滚；新存档同时包含账号和伴侣。未将无伴侣归属的旧存档自动归给当前伴侣，旧存档原样保留 |
| `src/Together.jsx` / `src/co-watch.js` | 旧网页解析结果覆盖新链接；结束后恢复已结束页面；回复拒绝可能产生未处理 Promise 并清掉后续输入 | 取消旧解析、验证请求身份；成功结束清除本场缓存；保留失败输入和用户在等待时新增的文字；不连发同一条回复 |
| `src/composer-size.js` / `src/interaction-polish.css` / `src/App.jsx` | 移动样式把输入框固定44px并隐藏溢出 | 输入随内容及宽度重算，最多176px或视口28%，长文字内部滚动，清空恢复单行；按钮轻量按压反馈与键盘焦点 |
| `src/api.js` | 外部取消信号存在时，原有截止时间被禁用；鉴权阶段不响应外部取消 | 合并取消信号和截止时间；鉴权与网络阶段都响应。保留原SSE/UTF8分片与终止事件校验，不修改错误文本架构 |
| `src/App.jsx` 发送入口 | 无截止地等待可选手机活动摘要 | 最多等待250ms，其余读取继续异步，使用已有环境快照；必要设置保存、模型绑定及记忆上下文仍保持原有逻辑 |
| `src/CelestialBackdrop.jsx` / 交互样式 | 背景与装饰绘制可能争抢回复渲染时间 | 流式回复期间降低天气画布刷新频率，滑动/流式回复期间暂停聊天装饰入场动画；弹幕无变化时不创建新状态，隐藏页面不处理弹幕。日月、星空、天气及装饰原设计保留 |
| 后端 `services/kiwi-memory-client.js` | 缺账号/伴侣时仍发送无租户请求；HTTP200逻辑失败被视为成功；HTTP错误被静默吞掉；不确定提交成功时自动重发 | 所有记忆接口缺有效租户时停止请求；要求网关返回匹配的X-Tenant-Id；不接受未经确认的召回；错误只记录稳定代码/HTTP状态；删除非幂等写入的自动重发 |
| 后端 `server.js` | 失败半轮先上报用户消息，成功重试时再次上报；启动检查读取公共库统计 | 失败消息继续保留在灯塔，Kiwi仅接收成功提交的完整回合；无租户启动时只标记已配置/未验证，不检查公共记忆库 |
| `src/MemoryGatewayStatus.jsx` | 软件没有明确的服务器记忆隔离检查入口 | 记忆页可检测连接和当前账号/伴侣范围，区分鉴权、404、超时和租户回执错误，给出对应操作；检查不读取记忆正文，不把连接成功当作召回验收 |

## 记忆与提示词边界

Kiwi 当前网关代码的租户中间件无租户时走 public，有租户时创建/选取租户 schema 并回传 X-Tenant-Id。本轮只修灯塔客户端和调用生命周期，没有覆盖 `E:\chatgpt\dsh\kiwi-mem-dengta` 已有的未提交修改，也没有改变其部署。旧网关/反向代理如果丢弃租户回执，会返回 `kiwi_mem_tenant_unverified` 并停止使用此次召回；需适配网关后再检测。

HTTP请求头和回执测试不能证明生产数据库历史上没有混杂。本轮未读取记忆私密正文，未删除、重分类或重写用户历史记忆。跨账号、同账号不同伴侣的并发测试使用独立虚构哨兵，没有调用真实记忆写接口。Kiwi写入超时后不自动重发，避免重复记忆；可靠补发需要网关持久化幂等支持，未在本轮添加。

另外通过Supabase已连接管理接口执行了只读归属聚合查询：灯塔 `memories` 共610条，user_id/companion_id缺失0条，伴侣引用缺失0条，伴侣所有者不匹配0条，已关联会话的账号/伴侣不匹配0条。仅查询计数与结构字段，没有读取summary等私密正文。这不能判断正文在语义上是否混杂，也不能代表独立Kiwi数据库的历史数据。`memories`、`companions`、`conversations` 的RLS启用且各有1条策略；放映厅与成员表RLS启用、无客户端策略，继续由后端鉴权和权限检查访问。没有修改任何策略或结构。

提示词装配保持现有行为：所选个性化字段按原顺序进入 agents.md，随后是核心/普通记忆及知识文件块；agents.md在应用system/instructions数组首位，重复个性化块按原实现去重，其余应用块保持相对顺序；性别指令沿用现有追加位置；历史消息、动态上下文、工具与附件保持独立入口。上述装配函数未修改。`services/ai-service.js` 工作副本SHA256仍为 `e8068639957b20f51d8814421bf01516bde99752cb588b5873ba41c65202b9cd`。未改变成人内容处理、供应商策略识别、协议完整性或持久化保护。

## 实际验证

| 命令/项目 | 结果 |
| --- | --- |
| 前端 npm test | 最终退出0；83个测试文件均接入测试脚本。初次失败分别是旧取消测试仅等一微任务、样式清单未包含新样式、IndexedDB测试依赖固定25ms，已改为明确阶段/条件等待后通过 |
| 后端 npm test | 退出0；120个测试文件接入测试脚本，包含新增Kiwi客户端6组行为测试 |
| 前端 npm run lint / npm run typecheck | 退出0；typecheck沿用项目ESLint检查，项目未提供TypeScript编译器 |
| 后端 npm run check / npm run typecheck | 退出0；包含运行时JS语法与提示词架构检查 |
| npm run test:interaction-runtime | 房间请求/SSE4组、战斗锁/取消/伴侣存档、真实api.js取消/UTF8首段/终止校验、共看旧解析隔离/缓存清除、记忆检查生命周期均通过 |
| npm run test:stream-privacy / npm run test:visible-monologue-stream | 退出0；隐私、分离与后端首段先于完成事件通过 |
| 浏览器 `browser-verify.cjs` | 360/390/1440三种宽度，真实组件与虚构接口响应：六行输入154px；40行输入176px并可滚动；战斗重开、网页解析/开始/结束、记忆回执错误、房间创建/加入/SSE通过，pageerror为0 |
| 模拟首段时间 | 最后一次测量23/37/39ms，从本地虚构SSE发出到首段DOM可见，均早于1.2秒后的完成事件；此数值不是生产供应商首字时间，也不是完整App/真机帧率指标 |
| npm run build:web / npm run android:sync | 退出0，生产公开配置校验通过 |
| Android gradlew.bat :app:testDebugUnitTest :app:assembleDebug | 退出0；Android单元测试及APK构建成功 |
| apksigner verify / aapt2 dump badging | 签名通过，home.dengta.app，2.10.36 / 84，最低Android12/API31；稳定debug签名验证包 |
| APK资源核对 | 89个assets/public文件与dist/生成资源一致，公开登录配置/生产后端/新功能标识存在；秘密模式检测未命中 |
| Kiwi原生隔离脚本 | 已尝试，无网络部分因本机缺asyncpg无法启动（退出1）；真实PostgreSQL守卫未运行。没有把客户端mock结果当成原生数据库验证 |
| adb devices | 没有已连接设备，Android真机安装/帧率/投屏及真实账号聊天未验收 |

构建产物：`E:\chatgpt\artifacts\dengta-interaction-memory-20260930\DengTa-2.10.36-84.apk`，36,235,949字节，SHA256 `9fbacdc99144bda8c87e21b6654b242ab1110a883e8203c91469784d339aed05`。稳定debug证书SHA256 `38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6`。

## 验收与发布状态的范围

本记录是本地代码、模拟接口、浏览器组件和安装包静态验证。生产供应商真实生成、多人真实共看、Kiwi生产召回/写入、历史库隔离和真机动画仍待验收。用户已持续授权本任务推送及发布；GitHub、CNB、Render/Vercel版本和APK发布的最终回执另存本轮artifacts，不用本地通过代替部署确认。没有新增数据库迁移，没有修改此前待单独授权的数据库权限设置。

未来功能候选：共看时间点书签与回看片段、战斗回合复盘/显式选择重试、用户可编辑的记忆来源回执。这些只是建议，本轮没有伪装成已落地功能。

## 精确变更定位

以下为最终工作树的新行号，配合上方逐项目的查看；新增文件从第1行开始。

- `frontend/android/app/build.gradle:18`
- `frontend/src/App.jsx:11,1314,4579,7754,7886,7891,9312`
- `frontend/src/CelestialBackdrop.jsx:311`
- `frontend/src/DlnaCastPlayer.jsx:303,319,346,364,581,592,638`
- `frontend/src/IntimateDuel.jsx:16,18,21,23,65,67,75,80,89,93,100,109,122,145,151,162,179`
- `frontend/src/Together.jsx:122,131,137,420,425,433,435,492,501,504,510`
- `frontend/src/api.js:71,88,103,128`
- `frontend/src/co-watch.js:280,284`
- `frontend/src/main.jsx:15`
- `frontend/src/watch-room.js:1,12,21,37,46,55,126,128,130,132,140,149,152,157,168,172,179,200`
- `frontend/test/android-release.test.js:75`
- `frontend/test/chat-latency.test.js:45`
- `frontend/test/chat-tools.test.js:935,950,977`
- `frontend/test/mobile-layout.test.js:118,142`
- `frontend/test/workspace-manager.test.js:15,25,60,62,70`
- `frontend/src/MemoryGatewayStatus.jsx:1`
- `frontend/src/composer-size.js:1`
- `frontend/src/interaction-polish.css:1`
- `frontend/test/api-stream-lifecycle.test.js:1`
- `frontend/test/duel-request.test.js:1`
- `frontend/test/interaction-runtime-preview.html:1`
- `frontend/test/interaction-runtime-preview.jsx:1`
- `frontend/test/together-requests.test.js:1`
- `frontend/test/watch-room.test.js:1`
- `backend/server.js:4980,5026,6566,6577`
- `backend/services/kiwi-memory-client.js:19,45,57,64,71,87,97,103,110,125,132,176,178,259,274,281,288,310,313,321,335,342`
- `backend/test/kiwi-memory-client.test.js:1`
