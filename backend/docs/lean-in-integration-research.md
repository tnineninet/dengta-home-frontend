# Lean_In 上游审计与 DengTa 共看集成建议

状态：完成固定提交的一手源码审计；本文只记录独立实现边界与落地接口，不修改生产代码、数据库、部署或用户数据。

审计仓库：[`wxynora/Lean_In`](https://github.com/wxynora/Lean_In)

固定快照：[`f5201a18dc639e8c53140fe6977789d17b1d8cb3`](https://github.com/wxynora/Lean_In/commit/f5201a18dc639e8c53140fe6977789d17b1d8cb3)，默认分支为 `main`，作者与提交时间均为 `2026-07-23T23:03:21+08:00`；观察时间为 `2026-08-13T00:08:31+08:00`。固定版本清单声明包版本 `0.1.0`、Python `>=3.11` 且无 Python 运行时依赖（[`pyproject.toml`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/pyproject.toml#L1-L27)）。本文所有上游链接均锁定到该完整 SHA，避免分支后续变化造成结论漂移。

## 结论先行

1. **Lean_In 不是可以直接接入 DengTa 的完整服务。** 它是一个 alpha 状态的 Python 时间轴内核、JSON 协议、宿主适配接口和无框架浏览器参考客户端；仓库明确不提供生产 HTTP gateway、数据库、认证、任务队列或已配置模型，单独部署网页只会得到界面（[`README`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L22-L30)）。
2. **不能把上游代码、界面、提示词或素材直接并入 DengTa。** 仓库采用 PolyForm Noncommercial 1.0.0，而不是允许商业使用的开源许可证；许可证只把非商业用途列为许可用途，分发还必须附带许可证与 Required Notice（[`LICENSE`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/LICENSE#L24-L46)，[`非商业用途`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/LICENSE#L54-L64)）。DengTa 面向公开用户且未来用途可能变化，因此稳妥边界是：只借鉴一般概念，使用 DengTa 自己的命名、数据结构、代码、测试和 UI 从零实现。
3. **最值得借鉴的是“媒体时间轴”而不是现成 UI。** 其关键思想是让播放器时钟成为唯一真值，把已看剧情、发消息时正在播放的内容、预计回复抵达前会播放的内容，以及更晚的未来内容分开（[`README`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L32-L44)）。这能解决“用户说话时看到 A，模型回复时视频已播到 B”的错位。
4. **当前 DengTa 的“系统屏幕共看”和 Lean_In 的“受控播放器共看”是两种产品，不能混成一个精确同步承诺。** DengTa 能从任意前台 App 抽取屏幕帧并生成后台反应，但拿不到第三方播放器可靠的播放位置、字幕轨、seek 事件或片源身份；Lean_In 对跨域 Bilibili 也明确要求宿主提供真实播放快照，无法读取时不伪造（[`Web 客户端说明`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/README.md#L161-L170)）。因此应保留两个清楚命名的模式：
   - **屏幕陪看**：在其他 App 中稀疏看一帧、主动回复、通知栏快捷聊天；时间是“捕获时刻”，不是精确影片时间。
   - **一起看片室**：视频在 DengTa 自己控制的 HTML5/原生播放器中播放，才能同步时间、字幕、聊天、弹幕、暂停、恢复和票根。
5. **Lean_In 没有定义“AI 每隔多久自动说一句”。** 它明确不预生成伴侣台词（[`非目标`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L593-L601)）；聊天由用户消息触发，定时弹幕由当前回复产生。滚动任务分析的是剧情缓存，不等于每批都向用户发消息。因此 DengTa 的后台反应频率、免打扰、通知聚合和花费预算必须由 DengTa 自己定义。

## 当前 DengTa 已经具备什么

### 后台屏幕陪看

DengTa 已有一条完整的 Android 后台链路：`MediaProjection -> ImageReader -> JPEG -> /api/v2/co-watch/frame -> 主聊天模型 -> messages`。后端复用主聊天上下文、记忆和用户配置，把返回内容保存成 `visible=true`、`is_push=true`、`is_co_watch=true` 的 assistant 消息（[`services/co-watch.js`](../services/co-watch.js#L75-L193)）；路由使用租户作用域，并限制为 JPEG/PNG 与 1.5 MB（[`routes/co-watch.js`](../routes/co-watch.js#L1-L43)）。

当前 Android 采样与回应节奏不是“固定每 90 秒回复”：

- 设置默认每 90 秒检查一次，合法范围为 30–600 秒（前端 `android/app/src/main/java/home/dengta/app/ScreenGlanceService.java` 第 299–320、696–712、1073–1075 行）。
- 每次取得画面后会计算 8×8 感知哈希；只有相较上一帧差异至少 5 bit，或者已经 8 分钟没有上传，才真正请求模型（同文件第 567–600 行）。
- 单次后端请求超时为 70 秒；失败后大约 60 秒再试（同文件第 106–108、489–493、602–675 行）。

所以默认体感应解释为：“约每 90 秒看一次；画面有明显变化时才说；静态画面每 8 分钟最多强制看一次；随后再加模型响应耗时。”这段状态应该直接显示在设置页，不能让用户猜。

### 通知、声音和震动

共看后台回应其实已经走即时通知：Android 服务收到后端反应后调用 `PushNotificationWorker.showImmediateCompanionMessage`（前端 `ScreenGlanceService.java` 第 650–675 行）。消息频道是高重要度，使用系统默认通知声并明确启用震动（前端 `PushNotificationWorker.java` 第 128–148、250–283 行）。持续屏幕共享本身使用另一个低重要度、静音、常驻频道，并提供播放/暂停、暂停/继续、结束按钮（前端 `ScreenGlanceService.java` 第 941–1036 行）。两类通知分开是正确的：常驻服务不应每次更新都响，新 AI 消息才需要声音和震动。

现有实现有一个需要在落地阶段修复的去重缝：即时通知只负责展示，没有把该 `message_id` 写入周期轮询的 `SEEN_IDS`/cursor；同一消息又以 `is_push=true` 保存在服务端，15 分钟周期 worker 之后可能再次取得并重复通知（前端 `PushNotificationWorker.java` 第 72–95、194–246、286–307 行）。应把即时通知与轮询通知统一到一个 `acknowledgeImmediateMessage(messageId, createdAt)` 去重写入路径，或者使用后端可确认 cursor。

现有 `GET /api/v2/push/messages` 只返回通用消息字段，丢掉了 `is_co_watch`、共看 session/epoch/sequence 等来源信息（[`routes/v2/content.js`](../routes/v2/content.js#L629-L666)）。为了点击通知后直接进入“正在一起看”而不是普通聊天，应返回一小段经过白名单投影的 `push_context`，例如：

```json
{
  "kind": "co_watch_reaction",
  "watch_session_id": "...",
  "conversation_id": "...",
  "message_id": "..."
}
```

不要把完整 `tool_calls` 原样交给客户端。

## Lean_In 的实际架构

上游把宿主能力切成窄接口：播放器快照、客户端取材、剧情分析、背景检索、字幕、剧情召回、上下文注入、定时动作投递、回复延迟存储和运行时存储（[`adapters.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/adapters.py#L77-L168)）。便携内核本身不认识 HTTP、Supabase、OpenAI SDK 或 Android；生产宿主负责持久化、租户认证、队列和供应商适配（[`README 架构`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L86-L123)）。

| 上游模块 | 一手源码职责 | DengTa 独立实现的对应 seam |
|---|---|---|
| `models.py` | session、media、snapshot、plot chunk、sample plan、ticket 等值对象（[`PlaybackSnapshot`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/models.py#L224-L267)，[`SamplePlan/ContextEnvelope`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/models.py#L539-L619)） | Node 中独立的 `services/watch-session-engine.js` 纯函数和值校验；数据库行继续由 Supabase 管理 |
| `timeline.py` | epoch/sequence 单调校验、回复抵达窗口与 120 秒未来上限（[`timeline.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/timeline.py#L107-L158)） | 由后端校验所有 playback snapshot；客户端只提供候选值 |
| `context.py` | 把剧情严格切成已看召回、当前、回复抵达、定时未来四组（[`context.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/context.py#L23-L98)） | 在 DengTa 现有 `loadChatContext` 之后添加一个低权限 `watch_context` 动态层，不改个性化指令/记忆 |
| `prefetch.py` | 5 分钟初始缓存、30 分钟 ahead、高水位后整批补齐（[`prefetch.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/prefetch.py#L6-L58)） | 后端队列的纯调度器；同一媒体区间只分析一次，不能每张屏幕帧都请求模型 |
| `lifecycle.py` / `worker.py` | 客户端租约、队列 claim、取消、epoch 失效、provider 前后 guard、提交前复核（[`lifecycle.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/lifecycle.py#L48-L166)，[`worker.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/worker.py#L144-L238)） | 复用 DengTa 后台 job/租户作用域习惯，新增 watch job 类型；每个提交仍带 user_id + companion_id |
| `costs.py` | 按用途、调用次数、token、美元价格、是否结算完整进行幂等聚合（[`costs.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/costs.py#L68-L106)，[`汇总`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/costs.py#L127-L170)） | 使用 DengTa 自己的 `watch_usage_events`；按 provider response 落账，不从估算文本反推 |
| `viewing.py` / tickets | 保存进度、完成观看、跨分 P 聚合与稳定票根 | Supabase `watch_viewings` + `watch_receipts`，票根只是产品 UI，不复制上游票面 |
| `web/lib/host.js` | 把播放器、聊天、截帧、恢复位置接到宿主（[`host.js`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/lib/host.js#L1-L142)） | React/Capacitor 中建立 DengTa 自己的 `watch-room-bridge.js`，不可复制参考客户端源码 |

## 媒体时钟与聊天同步

### 必须保留的契约

一次用户消息必须在同一个点击动作中抓取新鲜播放快照，而不是复用后台定时上报的旧快照。上游协议明确要求这一点（[`protocol.md`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L217-L255)），参考客户端也先抓快照、同步给服务器，再连同 `watch_session_id` 发送真实聊天（[`web/app.js`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/app.js#L1937-L1989)）。DengTa 应独立采用下列最小结构：

```json
{
  "watch_session_id": "uuid",
  "snapshot": {
    "media_id": "opaque",
    "playhead_ms": 930000,
    "duration_ms": 1800000,
    "is_playing": true,
    "playback_rate": 1.0,
    "timeline_epoch": 2,
    "snapshot_seq": 17,
    "captured_at": "2026-08-13T00:00:00+08:00"
  }
}
```

- `snapshot_seq` 在同一 epoch 严格递增；seek、换片、换本地文件 revision 时 epoch 增加，旧 job、sample plan、弹幕和投递全部作废（[`协议规则`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L234-L252)）。
- 当前剧情只看消息位置前约 30 秒；回复抵达窗口先用设置值，获得实际数据后用 session 平均首字可见延迟，并按播放速度换算成媒体时间（[`context.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/context.py#L39-L70)，[`延迟协议`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L257-L276)）。
- 更晚的 future chunk 只允许产生定时弹幕，不能提前泄露到普通回复；上游把这个边界写进 `ContextEnvelope`（[`Context Envelope`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L730-L769)）。

### DengTa 的响应时间校准

DengTa 已经有 SSE 首字到达和可见心声流，因此无需另开模型调用。新增 `chat_job_id` 后：

1. 发送按钮记录 `performance.now()`。
2. 第一段真实 assistant 正文被 React 提交到 DOM 后，上报 `visible_latency_ms`。
3. 同一 `job_id` 重放只替换样本，不增加计数。
4. 只在当前 watch session 内平均，不写入长期记忆。

上游参考客户端在首次 assistant 文本实际显示后上报该值（[`web/app.js`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/app.js#L1937-L1987)）。这比“模型请求耗时”更接近用户真正看到回复的时间。

## 截帧、字幕与分析

### 本地视频

上游浏览器参考方案不上传完整本地文件，而是使用隐藏 `<video>` 根据服务器短期 sample plan seek 到少量时间点，最长边缩至 960 后导出 JPEG（[`LocalFrameSampler`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/lib/local-sampler.js#L76-L145)）。sample plan 带 media revision、epoch、允许范围、目标时间、最多帧数、MIME 与过期时间；服务端接收字节前和消费计划时都要再次核验（[`protocol.md`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L332-L421)）。

DengTa 可独立实现同样的窄授权思路，但第一版不需要复制完整分析系统：

- 只支持 DengTa 自己播放器中的本地文件或可合法嵌入 URL；
- 片源原文件留在设备；
- 每个分析批次最多 3–4 张稀疏 JPEG；
- `plan_id + revision + epoch` 作为幂等键；
- 上传成功/失败后清理设备临时帧；后端 provider 提交或取消后清理对象存储临时帧；
- 不把分析帧写入 Memory、Moments 或普通聊天附件。

### 字幕

上游把字幕当可选证据：本地 SRT/VTT 上传带 track ID 和一次性 signed `offset_ms`；revision 或轨道不匹配就拒绝，没配置网络字幕或没找到字幕都不阻塞播放（[`protocol.md`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L423-L449)）。默认网络策略是单请求 15 秒、整次 45 秒、自动 1 次，失败后由用户手动重试（[`subtitles.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/subtitles.py#L9-L51)）。

DengTa 第一版建议只做：

1. 本地 SRT/VTT 文件；
2. 用户可调字幕偏移；
3. 无字幕时用帧继续降级；
4. 网络字幕留到第二阶段，服务端密钥只从现有 Provider Center/环境读取。

### 不能从任意第三方 App 得到的能力

MediaProjection 截图只能说明“捕获这一刻屏幕长什么样”，无法可靠得到：

- 影片唯一身份、分 P/集数、真实 duration；
- 当前 playhead、播放倍速和 seek epoch；
- 字幕轨与音轨；
- DRM/受保护表面的像素；
- 对特定播放器精确暂停、seek 或选集。

当前 DengTa 只能通过系统媒体键切换全局播放/暂停（前端 `ScreenGlanceService.java` 第 1006–1015 行）。因此屏幕陪看中可以保留“伴侣按暂停键”，但不能宣称它知道精确剧情时间；精确能力必须放进 DengTa 自己的看片室播放器。

## AI 回复节奏与费用

### 不要把分析批次当回复批次

上游默认先准备 5 分钟可靠剧情覆盖，播放后按约 140 秒整批分析，维持最多 30 分钟 ahead；到高水位后等一整批被播放消耗再补，不因每次小 playhead 变化发短模型请求（[`README`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L421-L426)，[`prefetch.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/prefetch.py#L6-L58)）。这是成本优化，不是要求 AI 每 140 秒说话。

DengTa 的独立节奏建议：

| 事件 | 是否调用聊天模型 | 用户可见输出 |
|---|---:|---|
| 用户在看片室发消息 | 是，复用正常 chat SSE | 聊天区即时流式回复；后台时转通知 |
| 新剧情分析批次 | 是或本地分析 | 默认静默，只更新 plot cache 和费用 |
| 到达模型已安排的弹幕时间 | 否 | 播放器上显示已生成的短弹幕 |
| 屏幕陪看检测到显著画面变化 | 可选 | 由冷却、免打扰和预算决定是否生成通知 |
| 相同/近似画面 | 否 | 不输出；只更新采样状态 |
| 用户回到 App | 否 | 从 messages/session 恢复，不补发重复通知 |

屏幕陪看的建议默认可以沿用现有 90 秒检查，但另加：每 5 分钟最多 2 次可见反应、相似画面静默、连续三次无新信息后延长间隔、用户说话时立即恢复；这些是 DengTa 新策略，不是上游代码或行为。

### 使用量与会话票据

上游把 provider usage 在响应到达后立即、幂等落账，即使随后发现 session 已结束或 epoch 已过期，真实发生的调用也不能从费用里消失（[`worker.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/worker.py#L185-L238)，[`costs.py`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/costs.py#L88-L106)）。结束响应分别报告价格是否完整、调用次数、输入/输出 token、pending job 与按用途 breakdown，不能把“未报价的 0”显示成免费（[`protocol.md`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L521-L580)）。

DengTa 可独立设计一张更轻的结束卡：

```json
{
  "viewing_id": "...",
  "watched_ms": 594000,
  "reply_count": 7,
  "analysis_batches": 3,
  "provider_calls": 4,
  "input_tokens": 39920,
  "output_tokens": 8227,
  "amount_usd": 0.0292135,
  "pricing_complete": true
}
```

票根应使用 DengTa 自己的日光玻璃视觉语言，不复制上游截图中的票面、字体、文案、布局比例或素材。上游将技术清理、保存进度、完成观看明确分成三种幂等转换（[`protocol.md`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md#L585-L595)），这一数据语义值得独立采用。

## 通知栏与后台聊天的最短落地路径

上游参考客户端只实现前台网页聊天和自定义事件，不提供 Android heads-up、声音、震动或通知内回复。DengTa 应基于现有原生通知独立完成：

1. **即时 heads-up**：共看反应保存成功后立即使用共看消息频道展示；声音/震动使用系统频道设置，不在 WebView 中自行播放提示音。
2. **通知内快速回复**：给 AI 消息增加 Android `RemoteInput` action；提交到新的安装令牌受限路由，如 `POST /api/v2/co-watch/reply`，请求只含 `conversation_id`、`watch_session_id`、文本和客户端幂等键。回复仍走主 chat provider 与当前 companion 作用域。
3. **播放/暂停**：继续放在静音常驻屏幕共享通知；它只是系统媒体键，不标记为精确播放器控制。
4. **点击正文**：携带 `conversation_id + watch_session_id + message_id` 打开 DengTa 的看片室/共看消息位置。
5. **去重**：即时通知成功后写入本地 seen/cursor；周期 worker 只做漏投补偿。
6. **通知权限状态**：如果用户关闭声音、震动或 heads-up，App 只能打开系统频道设置，不能绕过用户设置；页面应显示频道当前是否启用。
7. **Web/PWA**：只能在已授权且浏览器支持的条件下用 Web Push；iOS PWA 需要用户安装到主屏幕后再请求通知。不要声称网页能获得 Android MediaProjection 的后台能力。

## 推荐的 DengTa 数据与接口

这是独立设计草案，不是上游 schema 的复制：

### Supabase 表

```text
watch_sessions
  id, user_id, companion_id, conversation_id
  mode(screen_companion|watch_room), state
  media_id, media_revision, title, duration_ms
  timeline_epoch, latest_snapshot_seq, latest_playhead_ms
  client_seen_at, lease_expires_at, created_at, ended_at

watch_plot_segments
  id, user_id, companion_id, session_id
  media_id, media_revision, timeline_epoch
  start_ms, end_ms, summary_json, created_at, expires_at

watch_jobs
  id, user_id, companion_id, session_id
  purpose, range_start_ms, range_end_ms, status
  idempotency_key, cancel_requested, usage_json

watch_reply_latency
  user_id, companion_id, session_id, chat_job_id
  visible_latency_ms, updated_at

watch_viewings
  id, user_id, companion_id, title, status
  watched_ms, saved_playhead_ms, usage_json, completed_at
```

每张表都必须纳入 DengTa 的 `RequestScope`/RLS、同时携带 `user_id + companion_id`，不能让客户端提交所有权列覆盖作用域。屏幕帧只做临时对象，不把 base64 放进数据库，也不进入长期记忆。

### API

```text
POST   /api/v2/watch/sessions
POST   /api/v2/watch/sessions/:id/heartbeat
PUT    /api/v2/watch/sessions/:id/playback
GET    /api/v2/watch/sessions/:id/status
POST   /api/v2/watch/sessions/:id/samples
POST   /api/v2/watch/sessions/:id/reply-displayed
POST   /api/v2/watch/sessions/:id/quick-reply
POST   /api/v2/watch/sessions/:id/end
GET    /api/v2/watch/viewings
```

保留现有 `/api/v2/co-watch/frame` 作为 `screen_companion` 的兼容入口；不要把它假装成精确的看片室协议。

## 分阶段实施

### Phase 0：先修用户眼前的问题

- 明示现有 90 秒检查、30–600 秒范围、画面差异门槛与 8 分钟强制检查。
- 修复即时通知与 15 分钟轮询的重复投递。
- 确认共看 AI 新消息使用高重要度声音/震动频道；常驻共享通知继续静音。
- 通知点击定位到具体 conversation；增加通知内快速回复。
- 不新增模型调用。

### Phase 1：DengTa 看片室最小版

- 新增侧边栏“一起看”，支持本地视频与用户合法提供的直链。
- 同页播放器、聊天、字幕文件和播放位置；用户消息携带新鲜 snapshot。
- AI 回复仍走现有主聊天 SSE、个性化指令与记忆；watch context 只提供当前媒体事实。
- 支持暂停/继续、简单定时弹幕、后台消息通知。
- 不做预分析、外部字幕搜索和票根。

### Phase 2：缓存剧情而不是频繁识图

- 增加短期 sample plan、稀疏帧、可选短音频与 SRT/VTT。
- 分析结果按 `media_revision + range` 缓存，seek 后复用已完成区间。
- 先做 3–5 分钟初始覆盖，再以大批次补齐；分析完成默认不发聊天消息。
- 加 usage event 与成本卡。

### Phase 3：观看记录与票根

- 区分退出、保存进度、完成观看。
- 生成 DengTa 自有风格观看卡；用户明确保存的封面/截帧与临时分析帧分离。
- 多分 P/剧集复用一个 viewing ID。

## 明确阻塞项

1. **许可证**：未经权利人另行授权，不能把 Lean_In Python/JS、HTML/CSS、提示词、JSON schema、测试、文档文字或 UI 素材直接用于可能商业化的 DengTa。本文不是法律意见；任何源码级复用应先取得书面许可或法律审查。
2. **任意 App 的精确时间轴**：系统屏幕截图无法提供可靠 playhead/seek/subtitle/media ID。只有 DengTa 控制播放器或目标 App 提供正式接口时才能承诺精确同步。
3. **DRM 与受保护表面**：不得尝试绕过；黑屏/不可截取应作为明确降级状态。上游也把绕过 DRM、订阅和区域限制列为非目标（[`README`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L593-L599)）。
4. **后台任意悬浮聊天窗**：Android 跨 App 浮窗需要额外高风险系统权限，iOS 基本不允许同类常驻覆盖。最短、最普适的交互是 heads-up + 通知内 `RemoteInput`，不是悬浮窗。
5. **完整视频分析成本**：若每 30–90 秒直接做一次视觉聊天调用，长视频费用和延迟都会线性增长。必须把剧情分析、用户聊天和主动通知分成三条有独立预算的路径。
6. **上游缺失生产基础设施**：Lean_In 没有 gateway、数据库、认证、队列、Android/iOS SDK 或供应商实现；这些都必须由 DengTa/Supabase/Capacitor 提供（[`集成要求`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L114-L127)）。

## 必须覆盖的测试

### 媒体时间与上下文

- 同 epoch sequence 非递增被拒绝；seek 新 epoch 取消旧 pending work。
- 用户发送时抓取的是同一点击动作的新 snapshot。
- future plot 不进入可见正文，只能形成定时 action。
- 实际首字显示延迟以同一 job ID 幂等替换。

### 取材与清理

- revision/epoch/plan/range/MIME/expiry 任一不匹配都在读 provider 前拒绝。
- 完整本地文件从不上传；临时帧在成功、失败、取消、session 结束后都被删除。
- SRT/VTT offset 只应用一次；无字幕不阻塞播放。
- DRM/黑帧返回降级，不伪装分析成功。

### 通知

- 共看即时通知只出现一次，周期轮询不会重复。
- App 前台不弹系统通知；后台使用声音/震动频道。
- 通知内回复携带租户、companion、conversation 和 idempotency scope，不能跨账号。
- 用户关闭通知权限后只显示系统设置入口，不声称已提醒。

### 费用与多租户

- provider 已返回但结果因 stale epoch 被丢弃时，usage 仍只记录一次。
- 未报价的 0 不显示“免费”；pending job 不显示“已结算”。
- 用户 A 无法读取用户 B 的 session、剧情、观看记录、临时帧或通知。
- 同一用户的不同 companion 默认不共享看片室上下文。

## 验证记录

- 固定提交的 Web 参考测试在本机 Node `v24.18.0` 下运行，`34/34` 通过：`npm test`（`web/package.json` 定义的命令见 [`package.json`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/package.json#L1-L8)）。
- 本机没有可用 Python 解释器，因此本次未重跑 Python 测试；上游仓库提供的无网络验证命令在 [`README`](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L583-L591)。
- 本次未调用任何模型/字幕/媒体网络供应商，未读取或输出任何 DengTa 凭据。

## 一手来源

- [固定提交源码树](https://github.com/wxynora/Lean_In/tree/f5201a18dc639e8c53140fe6977789d17b1d8cb3)
- [项目范围、架构、集成边界与非目标](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md)
- [协议 v1](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/protocol.md)
- [架构说明](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/architecture.md)
- [Web 宿主与播放器接线](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/README.md)
- [时间轴和延迟实现](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/timeline.py)
- [上下文分区实现](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/context.py)
- [滚动批次计划](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/prefetch.py)
- [worker 生命周期](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/worker.py)
- [费用聚合](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/costs.py)
- [PolyForm Noncommercial 1.0.0](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/LICENSE)
