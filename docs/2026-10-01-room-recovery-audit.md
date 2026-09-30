# 放映厅操作、消息恢复与权限回归记录

本轮前端2.10.37 / Android85，后端0.29.15；开始时前后端main工作树干净，基线分别为08b9f35与bab4388。本轮延续软件全功能优化目标，优先补齐上一轮放映厅的实际读取、消息与状态恢复链路。发布授权沿用用户“做完全套……需要推送就推送”。

## 根因、变更和使用行为

| 文件 | 根因与本轮修复 |
| --- | --- |
| 后端services/co-watch-rooms.js的publicRoom | 字段清单包含media_url，但DTO没有mediaUrl，加入者拿不到媒体源；现在返回原有地址。没有更改媒体解析、SSRF防护或DRM行为 |
| 后端routes/co-watch-rooms.js | 房间详情、历史和SSE只要求登录；现在复用现有requireRoomParticipant，按userId+companionId+roomId+left_at校验活跃成员。公开邀请码预览保留片名与成员摘要，媒体源仅向已加入成员返回；结束房间的事件订阅返回410/room_ended |
| 后端services/co-watch-rooms.js | AI群聊插入原来没有实际成员校验；现在插入前校验。退出时关闭同一账号/伴侣的事件流，结束时先发结束事件再关闭剩余流；error/finish/close清理心跳。不关闭同账号另一伴侣的流 |
| 后端播放更新 | 旧查询没有读取播放位置，暂停时省略进度会回退0；现在读取并保留位置。结束房间拒绝更新，乐观更新同时限定active状态，数据库读取错误不再变成虚假的404 |
| 后端群聊与display-id | 用户消息默认“我”，多伴侣查询未限定当前伴侣；现在沿用房间成员显示名，并同时限定companions.user_id和id |
| 前端DlnaCastPlayer.jsx | 同一个事件循环内可重复创建/加入；邀请接受和手动加入没有共用锁；退出先删本地状态，服务器失败后无法再退出。现用同步ref锁；退出失败保留房间、提示与重试按钮 |
| 前端房间聊天 | HTTP回执和SSE各追加一次，用户和AI消息重复；成员被标为本地用户名；现在按房间及服务器消息ID去重，使用服务器发送者显示名，不靠内容去重 |
| 前端重连/历史 | 事件流恢复没有重新读取状态与历史；现在onConnected读取最近50条并合并实时消息，按时间排序，限制显示最近100条。晚到请求验证房间epoch；旧revision不覆盖新播放进度。加入下一房间时清空本设备当前房间消息视图，没有删除服务端消息 |
| 前端输入与同步失败 | 发送立即清空输入，错误被吞掉；现在网页发送有同步锁，房间未确认保存时保留输入且不继续生成；用户消息已保存但AI失败，不把该用户消息当作未提交草稿重发；等待中新增文字保留。AI同步不确定时明确标为仅当前设备显示，不自动重发 |
| 前端watch-room.js | 重连失败提示可携带底层异常；现在只输出稳定room_stream_network_error，不输出原始网络错误。主动stop不重连，传输自身AbortError可重连；建立连接回调触发恢复 |
| 前端错误展示 | roomActions中的错误只有无房间时显示，播放器已加入后看不到；现在活动房间内持续渲染。重连文字不累加；复制邀请单独用role=status，错误用role=alert；长错误能换行 |
| 前端cast-player.css与按钮 | 失败状态仍是绿色点、重试为浏览器默认样式；改为红色状态和统一重试按钮。返回、结束、倍速、全屏、弹幕改为button，支持键盘焦点；弹幕有aria-pressed。保留影院原布局与主聊天日月背景 |
| 后端memory-import-feedback.js | 共用404提示只提import-file，记录导入实际使用import；改为分别列出两种地址，未更改记忆正文或网关配置 |

## 数据与提示词边界

本轮没有执行生产写入查询、迁移、权限修改、记忆清理或用户字段保存。Supabase只读聚合查询结果：房间0条、成员0条、成员归属不匹配0条、缺host记录房间0条。空表只能证明当前没有可抽查的历史房间，不能证明真实多人流程或历史隔离已验收。独立Kiwi服务未改、未部署，现有用户记忆未读正文、未重写。

路由使用原admin数据库；service_role能绕过RLS，因此应用层的成员检查必要，不能只把登录当作房间权限。依据：[Supabase RLS文档](https://supabase.com/docs/guides/database/postgres/row-level-security)。已查看官方changelog，没有升级依赖或更改SQL架构。

冻结文件ai-service、persistent-memory-filter、provider-output-guard、chat-stream-contract、settings-store、chat-request、prompt-security及前端chat-errors/chat-idempotency保持基线原文；api.js本轮未改；server.js仅把邀请摘要路由移到全局登录校验前，其他API认证仍保留。提示词顺序继续沿用现有agents.md最高个性化块、记忆与知识块、原位置的格式/运行时块及独立历史/动态/工具上下文。没有修改模板、排序、成人内容处理或供应商拒答识别。具体SHA和规范化对照存入本轮inventory.json；登记文件的旧哈希不被当作本轮基线。

## 验证命令与证据

| 命令 | 实际结果 |
| --- | --- |
| 前端npm test | 退出0，含原生命周期及扩展的连点、回显、历史排序、失败退出、草稿保留行为 |
| 后端npm test | 退出0，新co-watch-room-access进入test:co-watch可达链路 |
| node --test test/co-watch-room-access.test.js | 4组通过；实际Express/HTTP与虚构查询数据，覆盖正常成员读写、异账号/异伴侣/已离开拒绝读取、拒绝AI写入、结束房间410、真实HTTP离开关闭SSE、暂停进度和revision约束 |
| node test/dlna-player-lifecycle.test.js | 最终退出0；真实React组件，虚构原生桥与接口；重连历史、去重、真实成员姓名、失败回执、旧结果隔离及原有媒体生命周期通过 |
| node --test test/watch-room.test.js | 包含原4组及新增网络异常脱敏/重连，完整测试链路通过 |
| 前端npm run lint | 最终退出0；首次发现未使用catch参数并移除，不改变流程 |
| 后端npm run check / npm run typecheck | 均退出0；语法与提示词守卫保持通过 |
| browser-verify.cjs | 360/390/1440，真实组件+虚构HTTP/SSE；历史恢复、发送回执/SSE仅一份、保留新输入、保存失败保留草稿、失败退出可重试、键盘弹幕切换、错误不越界、失败点红色通过；pageerror0 |
| npm run build:web / npm run android:sync | 最终退出0；最后两处样式修正后重新构建与同步 |
| gradlew.bat :app:testDebugUnitTest :app:assembleDebug | 最终退出0；构建最新网页资源 |

浏览器最初等待自定义错误码失败，是虚构错误缺少生产错误链路的error_location等诊断元数据；检查现有错误函数后补齐fixture，再用真实格式验证，未改全局错误映射。截图检视发现伪元素颜色错误使用background，已改为color并新增浏览器颜色断言。模拟页面明确显示原生播放器在桌面浏览器不可用，没有把原生失败当作真机播放成功。

## 本轮仍未完成的真实验收

内置浏览器inventory只发现X标签，Chrome扩展连接失败；尝试打开灯塔时连接超时。没有读取登录令牌、没有借用其他浏览器凭据。真实账号多人共看、生产供应商、Kiwi召回/写入、Android安装/帧率/原生投屏仍未验收；自动化通过不能替代它们。重连恢复最多50条历史，房间界面显示最多100条；SSE跨后端多实例广播未在本轮实现。API响应不确定时不自动重复有副作用的操作，真实重试仍需先核对。

生产发布、GitHub/CNB精确提交和APK签名/资源回执另存本轮artifacts，只有实测回执才表示已上线。无新增迁移，可回滚到前端08b9f35/后端bab4388；不需要回滚用户数据。

APK签名校验退出0：home.dengta.app，2.10.37 / 85，最低Android12/API31，稳定debug签名。89个assets/public文件与最终dist一致，公开认证配置和生产后端匹配，秘密模式检查未命中。APK为36,264,940字节，SHA256：1ed23f5402f172a46eb59f5f29bbd76a9491e9ed4500e680caeda8af0eac5f44。

生产路由烟测首次退出1：三个成员接口匿名401符合预期，公开邀请预览也401不符合预期。定位到server.js注册顺序，修正后新增实际服务器prelude顺序的HTTP回归，覆盖公开摘要200、无效码404及成员接口仍401。最终生产回执存入production-route-smoke.json。

## 精确变更定位

以下为最终工作树的新行号，配合上方逐项目的查看；新增文件从第1行开始。

- `frontend/android/app/build.gradle:18`
- `frontend/src/DlnaCastPlayer.jsx:13,40,74,110,112,146,156,165,212,222,227,232,234,248,251,265,305,307,310,320,333,343,347,352,361,365,370,384,386,404,407,413,415,422,426,609,633,639,650,654,668,705,709,742,744,747,816,819,827,829,846,848,869`
- `frontend/src/cast-player.css:795,1099`
- `frontend/src/watch-room.js:99,151,189`
- `frontend/test/android-release.test.js:75`
- `frontend/test/dlna-player-lifecycle.test.js:26,30,61,63,84,224,248`
- `frontend/test/watch-room-recovery-preview.html:1`
- `frontend/test/watch-room-recovery-preview.jsx:1`
- `frontend/test/watch-room.test.js:30,32,36`
- `backend/routes/co-watch-rooms.js:10,80,95,133,193,215,253,266`
- `backend/server.js:586,780`
- `backend/services/co-watch-rooms.js:13,21,24,31,73,75,90,136,295,386,401,403,406,411,428,459,466,502,580,591,599`
- `backend/services/memory-import-feedback.js:16`
- `backend/test/co-watch-room-access.test.js:1`
