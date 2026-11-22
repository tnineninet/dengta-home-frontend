# 2026-10-01 一起听会话、队列重试和播放同步专项

基线前端 main `5b62363ce58049bbe5f06634799530b910dd3324`，2.10.45/93；后端 main `cd26e20acda6bf696645ede6c603abf0a6c7021e`，0.29.19。本轮前端 2.10.46/94，后端源码不变。开始时两工作树干净，本轮只修改下表所列范围，沿用用户在当前任务中对推送、部署及 APK 交付的授权。

## 根因与修复

原音乐开始/结束依赖 React 状态锁，连续点击在重绘前可发出重复请求；旧播放回执缺少账号、伴侣、会话归属检查。队列失败后重新开始使用新的请求编号，可能重复执行已成功但回执丢失的动作。原生正在播放的歌匹配不到时，将歌名拼为网易云 `song?id=` 的值；它不是供应商的歌曲编号。共看及共享控制器的 finally 只在账号仍一致时解锁，旧请求先完成、切换清理稍后执行时可能漏掉释放。

| 文件位置（前端仓库相对路径） | 实际变化 |
| --- | --- |
| src/co-watch-lifecycle.js:18、41、66 | 只有持有当前操作的 token 能释放同步锁；切换身份也释放旧操作自己的锁。听歌允许复用同模式 active 会话；创建回执检查模式；停止听歌不能误结束屏幕或视频。 |
| src/screen-glance-lifecycle.js:20 | 修复同样的锁残留条件，旧 token 不能释放新操作。 |
| src/music-queue-requests.js:1 | 会话/账号/伴侣固定、取消旧请求、串行队列操作；读取和变更回执核对会话 ID 和版本。失败动作保留请求编号，即使中间执行其他动作，重试仍用原编号；409 刷新版本后最多重试一次。 |
| src/music-playback-sync.js:1 | 合并最新播放进度；单次请求；按账号、伴侣、当前 active 听歌会话接受回执。旧 finally 不能清除新请求。409 读取同场新版本再有限重试，错误保留本机播放器。 |
| src/music-now-playing-sync.js:1 | 只在当前所选歌单中按标题及可用歌手唯一匹配；使用真实曲目 ID。找不到或匹配歧义提示手动选择，停止伪造歌曲分享链接；切换歌单/会话后丢弃旧结果。 |
| src/App.jsx:1473、6088、6093、6095、6099 | 接入上述实际控制器；开始/结束与屏幕/视频共用同步锁，生命周期和身份切换取消播放与切歌同步。停止失败保留会话。 |
| src/TogetherMusic.jsx:57、167、239、353、359、375、382、1005 | 显式传递身份；控制器生命周期与会话绑定；开始/结束有同步本地锁，失败给出错误码；队列失败保留会话，增加“重试载入队列”，只重试队列。成功载入后提示点击播放；服务器确认结束后才清除播放器状态。 |
| src/Together.jsx:722 | 听歌组件按账号、伴侣和活动请求隔离并传递范围。 |
| src/co-watch.js:190、201 | 队列读写支持 scoped authSession 和 AbortSignal，旧调用无 options 时仍兼容。 |
| src/music-listening.js:342、347 | 歌单列表和详情支持相同身份范围及取消选项；没有声称其他供应商、收藏或导入接口已全部改为该方式。 |
| package.json:4、package-lock.json:3、android/app/build.gradle:18、test/android-release.test.js:75 | 2.10.46/94；三个新运行测试接入 npm test。 |

这些是 DengTa 本地生命周期、请求编号及技术身份错误，不是成人内容限制。本轮未调用真实大模型、网易云或 MCP 服务，不能据此判断外部供应商是否可用或是否限制内容。

## 提示词和用户数据保护

没有数据库迁移、SQL 执行、用户数据删除或个性化字段写入；后端完全没有 diff。前后端 12 个保护文件以源码逐字比较（仅规范化 CRLF），最终机器回执包含结果。ScreenGlance 画面提示词文件没有修改。没有将真实私人正文、密钥或用户图片写入测试、报告或提交。

当前 `services/ai-service.js:387、3640` 保持原装配：agents.md 首块为用户详情、统一个性化指令（未配置则 legacy 原字段）、选中记忆摘要、知识文件块；随后保留已有 system 指令及可见心声/世界书相关块；运行时动态上下文仍在最新用户消息前。现有记忆选择上限和长条目处理未修改，不能称为无限物理上下文。后端 `npm run check` 的提示词架构保护检查通过。

## 验证命令与结果

所有项目 npm 命令在对应仓库执行。工具脚本位于 `E:/chatgpt/artifacts/dengta-music-lifecycle-20261001`，保存全量日志及 JSON 回执。

| 实际命令 | 结果 |
| --- | --- |
| 前端 node test/co-watch-lock-release.test.js | 0；原控制器可复现 busy 锁残留，修复后通过。 |
| 前端 node test/music-sync-lifecycle.test.js | 0；稳定请求编号（含夹杂其他操作）、409 有限重试、无效回执、身份/会话变化、旧锁不能释放新锁、最新进度合并和原生曲目匹配。 |
| 前端 node test/together-music-lifecycle.test.js | 0；实际 React 组件和实际 API 适配器配模拟服务，双击开始/结束、失败错误码、队列单独重试编号相同、结束失败保留会话、卸载后不创建队列。 |
| 前端 npm test | 0；93 个 .test.js 文件全部接入，另外按既有脚本运行其他测试。 |
| 前端 npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 各 0。 |
| 后端 npm test、npm run check、npm run typecheck | 各 0；125 个 .test.js 文件全部接入，后端无 lint 脚本。 |
| 前端 .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 0，BUILD SUCCESSFUL；本轮原生 Java 未变，单测任务使用已有最新结果；核对 33 用例/10 suites，无失败。 |
| 前后端 git diff --check | 各 0。 |
| Python -X utf8 extract-apk.py；node verify-apk.cjs；node secret-check.cjs；Python -X utf8 verify-native.py | 各 0；90 public assets 与本次 dist 相同；DEX 含既有原生保护；3 个私密配置值只在内存比较，未发现暴露。Python 使用 Codex bundled runtime 的绝对路径。 |
| E:/chatgpt/DengTa-production-tools/android-sdk/build-tools/35.0.0/apksigner.bat verify --verbose --print-certs 本轮APK | 0；v2 签名有效，沿用稳定 debug 证书。 |
| E:/chatgpt/DengTa-production-tools/android-sdk/build-tools/35.0.0/aapt2.exe dump badging 本轮APK | 0；home.dengta.app / 2.10.46 / 94 / min31 / target36。 |
| E:/chatgpt/DengTa-production-tools/android-sdk/platform-tools/adb.exe devices | 0；设备列表为空，真机未验证。 |

开发中组件测试初次误选另一 select 导致 starts=0，改为按歌单 option 选择后运行通过；首次全量 lint 因测试 setImmediate 未导入退出 1，显式导入后完整前端检查重新通过。React test renderer 弃用、Vite 大 chunk 和 Gradle 弃用警告仍存在；没有将这些改写为零警告。

APK：`E:/chatgpt/artifacts/dengta-music-lifecycle-20261001/DengTa-2.10.46-94.apk`，36,256,369 字节，SHA256 `443a674c333bdd20b8371ca4b627cdce8303599c6acc727522c0d87021fb88eb`。Android 12+，稳定 debug 签名测试包；证书 SHA256 `38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6`。

## 上线与验收边界

本文写入时本地检查与 APK 完成，提交/推送/网站/发布状态以 artifacts 的 final-audit.md 和 final-state.json 的最终实时回执为准。GitHub 仓库此前确认私有，匿名下载返回 404；本轮会重新核对，不能称为免登录下载。保留仓库可见性。

本轮内置浏览器 inventory 可读取，但绑定灯塔 tab 仍然 30 秒超时、内核重置。没有完成真实账号交互、Android 真机播放、多账号生产操作、Supabase 管理面检查或供应商真实调用。自动化测试及 APK 静态检查不代表这些通过。

下一步仍需检查收藏/供应商导入等其他听歌入口的范围与取消、跨设备服务器会话替换的原子性、原生配置保存/暂停入口和真机验收。本轮原生切歌只匹配当前歌单，其他歌单须手动选择；不会自动拉取或导入不明歌曲。整体长期目标保持进行中。
