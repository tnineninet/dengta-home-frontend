# DengTa 播放可靠性与伴侣恢复隔离审查

本轮版本：前端 2.10.43 / Android versionCode 91；后端 0.29.18。基线前端 f963d31c2878f9c3b13e96fb082ba00657490f7d，后端 b5dd9db328ef11acffaa2de97b620b6b17fb1d91。

## 根因与修改

- `server.js:582` 实际在登录中间件前注册 `routes/public-bilibili.js`，播放器走该公开路由。`routes/co-watch.js` 的同名路径被前面的路由覆盖，本轮没有误把它当生产入口，也没有改变认证、租户或平台登录逻辑。
- 后端 `routes/public-bilibili.js:86`：原接口不核验 HTTP/API 成功状态，把没有视频字段的返回重试后归为 404。现在只把明确的 -404 标为下架；网络、HTTP 失败、无效 JSON、平台访问限制及缺少字段各有固定错误码。原始平台正文、网络异常文本、签名媒体地址不出现在反馈中。指纹 Cookie 和 WBI 播放方式保留；指纹并发不再依赖不可取消的共享 Promise。
- 后端 `services/media-stream-relay.js:7`、`:26` 和 `routes/public-bilibili.js:126`：原逐块 `res.write` 不检查返回值，慢速手机可能造成后端持续缓存；关闭播放器仍读取上游。现有元数据 30 秒截止，开始转发后取消总时长截止，每次读取/等待 drain 独立 30 秒停滞截止；正常长视频不受元数据时长限制。客户端关闭取消请求及 reader，失败清理计时器/监听器。Range、206 与 Content-Range 保留，416 原样反馈。首次字节前失败清除媒体响应头后发送诊断 JSON，已经发出字节后中断连接，不向二进制流拼接 JSON。
- 前端 `src/direct-media.js:9`、`:161`、`:188`、`:216`：恢复缓存改为 v2，以 JSON 编码的账号/伴侣组合为作用域；缺少作用域不能写入。旧 v1 未删除或猜测迁移，不自动套给当前伴侣，升级后旧视频需重新选择一次。仅临时 sessionStorage 的新键变化，无用户数据库迁移。
- 前端 `src/App.jsx:1257`、`:6304`：清理恢复记录时传入当前伴侣。
- 前端 `src/media-playback-errors.js:1`、`src/Together.jsx:615`、`:699`：依据 MediaError 的 1/2/3/4 分别反馈中止、网络、解码、视频源不可用；未知类型明确表示尚未确认，不根据内容猜余额、权限或过滤。忽略浏览器原始 message，避免媒体签名地址泄露。
- 前端 `src/Together.jsx:617`、`:821`、`:857`：错误后可以重新载入视频；按钮仅调用 load，不自动播放、不重复建立共看会话。真实组件测试捕获并修复了按钮最初放在网页编辑区域的问题。

## 验证命令与实际结果

- 前端 `node test/direct-media.test.js` 退出 0，含账号/伴侣隔离、缺少作用域拒写、旧缓存不迁移不删除。
- 前端 `node test/activity-query-flow.test.js` 最初失败（重试按钮区域错误），修复后退出 0；覆盖真实 Together JSX 的五类错误、手动重新载入、跨伴侣恢复和 B站视频错误，不自动调用会话启动。
- 后端 `node --test test/media-stream-relay.test.js` 退出 0，10 个用例：慢速 drain 背压、关闭客户端、停滞读取/写入、真实 Express 路由分类、隐私字符串不外泄、元数据截止、Range 字节、416、首次字节前响应头清理、长于元数据截止的正常播放、真实 HTTP 断开取消。
- 前后端分别 `npm test` 退出 0；前端 88、后端 124 个测试文件均已接入脚本。全量后端通过时该测试文件含 8 个用例；后增的两个长视频/真实断线用例单独全部通过，生产代码未再更改。
- 前端 `npm run lint`、`npm run typecheck`、`npm run build:web`、`npx cap sync android` 均退出 0。静态检查是项目 JS/JSX 检查器，没有 TypeScript 编译器。
- 后端 `npm run lint` 退出 1，原因是仓库没有配置该脚本；没有伪称通过，也没有为此引入整库新 lint 配置。已有 `npm run check`（含提示词架构保护）和 `npm run typecheck` 退出 0，新增运行时文件 `node --check` 退出 0。
- `.\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug` 退出 0。
- 前后端 `git diff --check` 退出 0。React 检查指南复核：没有新增定时器或播放器状态订阅；错误由事件驱动，恢复只在初始化读取，新增按钮有文本名称并复用样式，无新依赖。测试渲染器弃用、已有宠物 chunk 大小及 Gradle 弃用提示仍存在。
- apksigner 校验退出 0，稳定 debug 证书 SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。aapt2：home.dengta.app，2.10.43(91)，minSdk31/target36。
- APK 36,248,009 字节，SHA256 a8ce2b992da0cf9bf9e4c6da3aa08fee5459633ec962a1ffae11147762585cff；90 个解压 web 资源与本轮 dist 对比一致。配置的 3 个私有凭据只在内存比较，未发现写入资源，没有打印凭据值。

## 数据、提示词与验收边界

本轮没有调用用户数据保存接口、数据库迁移/删除、提示词或记忆修改接口。没有增加 AI 提示词入口或更改现有装配优先级；播放与缓存修复不调用 LLM，不属于成人内容拦截修改。账号认证、租户及媒体地址校验保持原样。受保护源码与基线比较结果及最终 GitHub/CNB/部署回执保存在 `E:\chatgpt\artifacts\dengta-playback-reliability-20261001`。

内置浏览器 getState 成功列出灯塔页，getTab 仍 30 秒超时，真实账号播放未验收。adb devices 没有设备，Android 真机安装、画面、帧率未验证。供应商真实调用、多账号生产隔离、Supabase 管理面均未在本轮执行；没有动待授权的 8 表 RLS。B站可能因平台权限、网络、机房 IP 或媒体格式拒绝播放，修复不承诺所有视频可播。媒体元素只能给出粗粒度错误类型，不能从中确定上游 HTTP/API 细节。

共看开始/结束操作的重复点击和切换伴侣后的迟到回执仍需继续专项修复；本轮完成的是媒体代理取消与临时恢复隔离，不能等同所有共看会话竞态已经解决。公开代理重复的已遮蔽同名路由未重构，以免影响原协议。整个软件的持续优化目标保持 active。

依据：[Node 24 writable.write/drain](https://nodejs.org/download/release/v24.0.0/docs/api/stream.html#event-drain)、[MDN MediaError.code](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code)。生产、GitHub、CNB 与 APK 发布真实状态见本轮最终回执，不能把本地构建写成已上线。
