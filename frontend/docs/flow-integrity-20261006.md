# DengTa 2.10.64 设置保存与媒体流程交接

2026-10-06。前端基线 `842570b1d1b4451f6f843d43d7770352dd0f7766`；后端基线 `8dd525b2d15cada57cacf80d293e9c9cabcf2ad9`。APK 版本 2.10.64 / Android 112，沿用已有 debug 签名。最终外部回执见 `E:/chatgpt/artifacts/dengta-flow-integrity-20261006/report.md` 和同目录 JSON。

## 根因与修复

| 位置 | 实际复现 | 修复后行为 |
| --- | --- | --- |
| `src/main.jsx:81`、`src/App.jsx:2459` | App 只按账号重建；伴侣变化时旧设置保存队列仍可存活 | 账号和伴侣共同决定 App 生命周期，旧设置请求取消，卸载后的成功/失败回执不能继续写入、更新或重试 |
| `src/settings-save-scope.js:5` | 异步鉴权或跨标签页的 localStorage 伴侣变化可能让页面快照与请求伴侣不同 | 发请求前后校验快照和实际 companionId；只保留原作用域的诊断元数据，保留原 API 鉴权 |
| `src/App.jsx:2185` | bootstrap 旧读取晚于新 PUT 返回，覆盖新设置 | 设置读取记录写入修订号，旧读取不能回滚已确认的设置；聊天恢复部分仍继续处理 |
| `src/App.jsx:5126`、`:5177`、`:5340` | 每次输入都序列化长文本；撤回编辑时旧 PUT 迟到失败会复活旧草稿 | 输入只标记版本，停输入 800ms 后才序列化；失败仅重排仍有效的草稿，恢复原值时如有在途失败则重新确认最新值 |
| `src/AuthGate.jsx:422`、`src/settings-save-scope.js:40`、`src/App.jsx:7888` | 退出前未确认保存；等待退出期间继续编辑的文字可丢失 | 先临时锁定设置编辑/导入并确认保存，再退出；保存或退出失败保留页面、解锁并允许继续编辑 |
| `src/PrivateMedia.jsx:16`、`src/use-private-media.js:6` | img 的 loading=lazy 没有阻止提前 fetch/Blob；相同 URL 的旧账号图片可能仍显示 | 首次进入视口才读取私人图片，作用域变化立刻隐藏旧 URL，取消旧请求并销毁 Blob；eager/无 IntersectionObserver 环境即时读取 |
| `src/MusicSettings.jsx:143` | 导入在途时填写新草稿，成功回调清空新内容 | 只清空仍与已提交内容一致的草稿 |
| `src/music-queue-requests.js:12` | 迟到的旧队列 GET 覆盖已经确认的新操作结果 | 按队列 revision 选择回执，旧 revision 不倒写；切会话清除版本记录 |
| `src/App.jsx:5902`、`:7459` | 同一 tick 连击成就提交造成两个 POST；回执清空后来输入的草稿 | 同步提交锁和按钮 busy 状态，只清空未变化的已提交草稿；失败说明结果待确认，先刷新核对；列表刷新错误与提交成功区分 |

保留 2.10.63 的四组设置入口、搜索、可选引导、长文本展开/复制/txt-md 追加导入、陪伴灵感签和错误原因/操作指引。未修改太阳、月亮和涂鸦设计，也没有增加强制入门流程。

## 数据与提示词保护

只使用虚构内存内容与本地测试回执，没有读取或改写生产用户的个性化正文、记忆、世界书、聊天记录、邮箱确认状态或密码。没有生产数据库迁移。

`protected-check.json` 核对 13 个受保护文件与当前基线全部一致，包括前端 `api.js`、`auth-session.js`、聊天错误/幂等模块和后端 AI 服务、设置存储、提示词安全、流协议、持久记忆、输出判定及架构检查脚本。本轮不改变提示词装配顺序、角色或业务优先级，不增加内容限制；沿用现有个性化原文进入应用级 instructions/system 的架构。长文本不做 trim/概括，保存回归比对包含空格和 CRLF 的虚构字段原文。

输入没有新固定字数上限；既有 HTTP JSON 请求上限、模型真实上下文窗口和供应商行为仍独立存在。已有长文本保存测试不代表无限上下文或供应商兼容性全部通过。此次故障属于本地异步生命周期和界面逻辑，未据此推断供应商限制。

## 验证命令与结果

以下均已实际执行；详细输出在 artifact 目录。第一次前端全量测试因旧测试要求“仅账号 key”失败；更新为账号+伴侣后，第二次因版本号仍断言 111 失败；随 112 更新后完整重跑通过，没有跳过检查。

| 命令（前端/后端各自目录） | 结果 |
| --- | --- |
| frontend `npm test`、`npm run lint`、`npm run typecheck`、`npm run build:web`、`npx cap sync android` | 全部退出 0 |
| backend `npm test`、`npm run check`、`npm run typecheck` | 全部退出 0 |
| `node --test test/settings-save-lifecycle.test.js test/settings-save-scope.test.js` | 25/25 通过，退出 0；提取 App 实际函数，真实 AccountMenu / apiRequest + 虚构数据 |
| `node --test test/custom-achievement-submit.test.js` | 7/7 通过，退出 0；实际提交函数和表单 JSX，真实刷新 helper |
| `node --test test/music-draft-queue-regression.test.js` | 4/4 通过，退出 0；实际组件和队列 helper |
| `node test/private-media-image.test.js`、`npm run test:private-media`、`npm run test:music-listening` | 退出 0；视口启用、作用域/URL 变化、StrictMode、取消与 Blob 回收 |
| `npx eslint src/App.jsx src/AuthGate.jsx src/main.jsx src/settings-save-scope.js` 和新增测试/媒体源定向 ESLint | 退出 0 |
| `git diff --check` | 退出 0；仅系统 LF/CRLF 提示 |
| `.\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug` | 退出 0；152 项任务，27 执行、125 up-to-date；原生测试任务 UP-TO-DATE，35 项/11 套报告零失败，未重新执行 |
| artifact `extract-apk.py`、`verify-apk.cjs`、`verify-tools.cjs`、`verify-native.py`、`secret-check.cjs`、`protected-check.cjs` | 退出 0；93 份 APK public 资源与 dist/Capacitor 一致，配置/功能标记/证书核对通过，已配置私密值未发现写入资源 |

新增测试已纳入 package 对应脚本。代码检查、组件测试、APK 静态检查和生产端到端分别记录。

## 本地浏览器与限制

实际浏览器中的 AuthenticatedImage，使用本地虚构账号与 SVG 回执：首次离屏媒体请求 0，进入视口后 1，伴侣切换立即隐藏旧图片并请求新回执后 2，新图片显示；本地控制台未捕获 error。截图 `image-browser.png`、回执 `browser-verification.json`，预览服务 127.0.0.1:5181，独立 artifact fixture 未放入产品。

选择生产网页标签页超时，未验证当前生产登录态/操作；该浏览器工具失败不能证明网站打不开。生产 HTTP 与构建资源比对另记。ADB 可用设备 0：Android 安装、真实帧率、真实供应商、实际账号设置保存、多账号/Supabase 管理面和所有功能完整端到端均未验收。

新的 scoped session 只覆盖设置 PUT 及其后续模型目录读取，不宣称全 App 每个 GET/工具副作用都有相同保护。当前无可见伴侣切换按钮调用 setActiveCompanionId；本次伴侣变化是能力层的模拟回归。浏览器硬关闭、强制会话失效及长于 keepalive 限额的请求不能保证完成。没有把私密长文缓存在本地磁盘作隐式备份。

私人图片一旦加载，滚出视口不卸载；无 IO 回退即时读取，WebView 解码/FPS 未测。成就同步锁防止本次界面连击，不是服务端全局幂等保证，超时后应先刷新核对再重试。

## 外部同步与回滚

只对前端 main、GitHub APK prerelease 和 CNB frontend-main/标签执行已授权同步；后端推送继续暂缓，后端代码和数据库没有修改。最终提交/标签/资源/Render 状态以最终 JSON 回执为准，不能把准备发布当成已上线。

回滚候选为前端基线 842570b1 / v2.10.63 与已保留的 2.10.63-111 APK。无需数据库回滚；不得以 CNB 覆盖 GitHub 或强制推送。旧版取消的是本轮流程修复，仍需重新构建并验证，不能只手动修改版本名。

后续可继续评估可见的“最近打开设置”入口、只存技术元数据的诊断摘要复制，以及由用户主动保存的设置版本快照。本轮优先解决已复现的丢失/重复问题，没有自动保存或上传新的私密备份。
