# 投屏异步回执与媒体切换审查

前端 2.10.38 / Android 86，后端保持 0.29.15。开始时前端 main 基线 38366ed，后端 main 基线 1f1205d；两工作树干净。发布沿用用户“做完全套……需要推送就推送”的明确授权。本轮仅改投屏生命周期、相应 Android 桥和测试，没有数据库迁移。

## 根因和行为变化

| 文件 | 证据与修复 |
| --- | --- |
| src/DlnaCastPlayer.jsx | 旧画面和聊天只检查页面 lifetime；同一组件切换媒体后仍能显示旧回复。现在按 mediaUrl 和 roomId 建立独立生命周期，切换时取消画面网络请求；旧聊天、截帧、控制和状态回执不回写新媒体。旧任务 finally 不会解锁正在处理的新任务 |
| src/DlnaCastPlayer.jsx | 结束放映一直 await 原生桥，挂起后无法再次操作；现在同步锁防连点、最多等待 3 秒，超时显示 cast_stop_timeout 和重试/返回聊天。超时不假装停止成功、不自动重发；晚到回执不突然关闭当前页面。返回聊天只离开网页，用户仍需在原生播放器停止未确认的播放 |
| src/cast-receipt.js | 普通控制等待 5 秒，状态读取 3 秒，原生窗口/截帧 35 秒（原生窗口本身 30 秒），聊天回执 90 秒；生命周期取消立即释放等待者并观察晚到失败，不产生未处理拒绝。桥超时不代表原生副作用已取消 |
| DlnaReceiverPlugin.java / CastPlaybackService.java / CastMediaScope.java | 原生控制没有媒体归属；新客户端附 expectedUri，主线程操作和停止 Intent 执行时均检查当前原始 URI。旧媒体请求拒绝 playback_media_changed，不能操作不同媒体地址；旧客户端省略字段保留原行为。停止桥回执仍表示已提交停止请求，并非硬件逐帧停止验收 |
| 等待页 | 没有网页媒体时“返回”不再发 stopPlayback，避免停止其他后台播放。已打开媒体时仍提供结束操作 |

媒体识别使用完整原始 URI，不把 URI 写入日志；同一 URI 的重复播放仍遵循现有原生幂等机制。本轮没有新增跨设备同步标识或重写历史记录。服务器已有 active screen 会话可能继续复用；本轮隔离的是前端迟到结果，不宣称每条视频自动拥有新的服务端会话。

## 数据与提示词

没有查询用户私密正文、执行数据库保存/迁移、改账号权限、清理记忆或操作 Kiwi 服务。后端工作树保持干净；前端 App、co-watch API、提示词装配和个性化保存模块未改。本轮保护清单与基线规范化哈希均一致，详见 artifacts/dengta-media-lifecycle-20261001/inventory.json。CRLF 与 Git blob 原始字节差异沿用现有工作树，没有按旧哈希覆盖文件。

本轮不增加内容边界、不修改供应商接口或拒答逻辑，也没有真实供应商成人场景验收。既有提示词装配顺序保持原实现，本轮未重新审查其文本。技术媒体归属检查不是内容过滤。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| node test/dlna-player-lifecycle.test.js | 退出 0；真实 React 组件 + 虚构桥/API，新增切换视频后旧画面取消、新画面不被旧 finally 解锁、旧聊天/截帧/控制隔离、关闭连点、3 秒超时、迟到停止回执、再次结束和等待页返回 |
| node --test test/cast-receipt.test.js | 3 组通过；截止时间、取消前/后拒绝、晚到失败观察、成功与精确 native 错误传递 |
| npm test | 退出 0；新增测试已纳入 test:co-watch-experience；84 个测试文件全部可从测试脚本到达 |
| npm run lint | 最终退出 0；首次检测到直接在 effect 中重置状态，改为当前生命周期有效时的微任务，并重新验证 |
| npm run typecheck | 退出 0；实际采用 ESLint，没有 TypeScript 编译器 |
| npm run build:web | 退出 0；公共登录配置验证通过。保留已有 pet-runtime 超过 500kB 的构建提示，没有把该提示改成错误或忽略为已优化 |
| npm run android:sync | 退出 0 |
| gradlew.bat :app:testDebugUnitTest :app:assembleDebug | 退出 0；CastMediaScopeTest 2 组通过，失败/错误均为 0 |
| inventory.cjs / git diff --check | 保护文件未改，新测试可达；最终 diff 检查结果随发布回执保存 |

签名、资源逐文件匹配、版本、秘密模式扫描、生产网页入口哈希和 GitHub/CNB 精确提交分别记录在本轮 artifacts；只有对应回执成功才表示发布完成。

## 真实验收限制和回滚

内置浏览器 inventory 已列出灯塔标签，但 getTab 仍 30 秒超时；没有绕过浏览器连接读取登录凭据，本轮没有真实页面截图/触控验收。Android 真机安装、原生投屏、帧率、真实多人观影、Kiwi 召回/写入仍未验证。纯 Java 单元测试证明 URI 判定，不代替真实 Android Service/Activity 调度测试。无数据库变更；可回滚前端到 38366ed，后端无需回滚。

## 候选趣味改进（本轮未实现）

已核对 Together 的会话回执、后端 watch_viewings 完成记录和 watch_receipts 票根，避免重复造同名票夹。下一步可做用户主动点击的“收藏这一刻”：以真实播放时间保存片名、时间点与短备注；按当前账号和伴侣隔离，标明设备内保存，提供删除与导出，不把收藏自动写进人格/长期记忆。回到该片段需要原生 seek 支持及媒体匹配验证后才能标为可用。还可提供观影后任选一个共同话题，沿用当前聊天上下文，不强制弹窗或自动生成未经用户选择的记忆。

## 精确修改位置

- android/app/build.gradle:18
- android/app/src/main/java/home/dengta/app/CastPlaybackService.java:49,118,145
- android/app/src/main/java/home/dengta/app/DlnaReceiverPlugin.java:222,252,277,317,325
- package-lock.json:3,9
- package.json:4,47
- src/DlnaCastPlayer.jsx:3,33,150,191,195,199,231,235,244,250,252,261,265,272,281,283,291,294,296,307,314,319,326,347,366,467,475,502,529,537,548,551,557,567,569,571,573,598,765,772
- test/android-release.test.js:75
- test/dlna-player-lifecycle.test.js:26,30,51,56,296
- android/app/src/main/java/home/dengta/app/CastMediaScope.java:1
- android/app/src/test/java/home/dengta/app/CastMediaScopeTest.java:1
- src/cast-receipt.js:1
- test/cast-receipt.test.js:1

## 本地发布校验

APK 2.10.38 / 86，最低 Android 12/API31，包 home.dengta.app，稳定 debug 证书 SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6；apksigner 退出 0。89 个 public 资源与最终 dist 一致，私密模式及已配置私密值扫描均未命中。大小 36239613 字节，SHA256 5d144f77ca20450d37e975b751e94212e5476c1d5bd2752e945a87dd8f58f421。adb 可用设备数 0。Gradle 构建保留原有弃用警告，未升级 Gradle 或隐藏警告。
