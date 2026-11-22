# 2026-10-01 AI 点歌消费与外部播放回执专项

本轮前端 2.10.48/96，基线 main ab97a9b0a60506429472543eb6d0dca0875ba8a0（2.10.47/95）；后端 0.29.20，基线 main cd26e20acda6bf696645ede6c603abf0a6c7021e（0.29.19）。开始时两工作树干净；沿用当前任务用户后续明确授权的“全套、需要推送就推送”，原目标文本中暂缓后端推送已经被该授权更新。本轮没有数据库迁移或生产数据修改。

## 根因与最小修复

旧 AI 点歌轮询位于通知识别效果中，只有初次检查已授权通知使用权才启动。未授权时 AI 请求不被消费，之后授权也不自动启动；组件卸载后，迟到权限检查还可能创建没有清理的计时器。消费循环不固定账号/伴侣，不限制重叠，所有错误被吞掉；结果回传失败后，下次轮询会重新打开同一歌曲。原来的标题包含匹配把名字相似视为正在播放，证据不足。

外部打开和服务器链接确认并行 Promise.all；取消原生弹窗返回 opened:false 仍会显示已打开，服务器确认失败会把实际已打开说成整体失败。网页 window.open 返回未获证实的结果也直接声称打开成功。

后端点歌结果 POST 不检查更新是否命中有效行，也不限制 pending 状态；无记录时返回 ok:true，重复结果会重写 processed_at，迟到结果可覆盖 superseded 或已经完成的状态。

| 修改文件及准确行号 | 行为变化 |
| --- | --- |
| frontend/src/ai-music-consumer.js:7 | 独立点歌消费器，固定账号/伴侣；同实例轮询同步锁、每轮最多三项；真实资源编号，不用标题相似度假定已播放。打开后先留技术回执，失败只补传结果。sessionStorage 按账号/伴侣保存最多100条、重建时保留24小时内回执，只含请求ID、状态、固定错误码、时间和确认标记。存储不可用时只保留实例内回执。 |
| frontend/src/ai-music-consumer.js:25 | 结果补传经过范围验证；404/已替换/状态冲突作为明确的终态反馈，不无限阻塞后续歌曲。原生动作开始后无法撤回；迟到返回可保留原身份的本机技术回执，但不能通过新身份写服务器。 |
| frontend/src/App.jsx:16、1075、1084、1097 | AI 请求轮询与通知识别独立；只在实际 Android、有效账号/伴侣、非预览时运行。切换身份或卸载取消消费；通知识别在权限变化后启动，轮询不重叠，清理计时器及迟到结果。点歌错误可见，不再完全吞掉。 |
| frontend/src/music-listening.js:233、239 | 新增两个现有点歌端点的作用域适配器；请求列表必须为数组，结果必须 ok:true，新回执带 request 时还核对 ID 和状态。兼容旧后端仅返回 ok:true；前后端发布可分步。 |
| frontend/src/music-external-launch.js:4、10 | 本地资源校验后先获取设备 opened 回执；取消不调用服务器确认，无回执报稳定代码。实际打开后若服务器链接确认失败，明确已打开及确认失败，不自动重复打开。 |
| frontend/src/netease-playback.js:7、27、38 | 网页弹窗被阻止时报 music_popup_blocked；取得窗口后断开 opener 并跳转官方链接。原生桥和原有确认方式不改变。打开回执不代表歌曲已实际播放。 |
| frontend/src/MusicSettings.jsx:159；src/TogetherMusic.jsx:400 | 设置和播放器使用相同实际打开/取消/部分失败反馈，避免两个入口行为不一致。 |
| backend/routes/v2/music-cookie.js:87、113、117 | 校验UUID和结果枚举；RequestScope 固定用户及伴侣；只更新 pending 并返回 id/status，0行更新后按同一作用域读取确认。相同结果幂等重放；其他终态409、无记录404，不再假成功；保存固定错误码，避免持久化调用方原始错误或密钥。 |
| frontend/test/music-delivery.test.js:1 | 实际消费器与打开辅助函数；丢失结果、恢复、账号切换、轮询重叠、迟到原生返回、终态旧请求不阻塞新歌曲、取消/缺少回执/服务器失败、真实网页打开函数的弹窗拦截和 opener 隔离。App 绑定关系采用源码断言；没有称 Android 权限流程已实测。 |
| frontend/test/music-request-scope.test.js:1；test/music-operation-ui.test.js:34 | 范围测试从28扩至全部30个异步适配器，缺失点歌回执分类；旧组件模拟桥改为真实形状的 opened 回执。原组件竞态测试保留。 |
| backend/test/music-ai-results.test.js:1 | 启动实际 Express 路由，使用真实 RequestScope 加模拟数据库；认证、不同账号/同账号不同伴侣、UUID/状态无效、精确回执、重复上报、已替换/已完成、错误元数据和数据库失败。 |
| 前后端 package.json:3/4、package-lock.json:3；frontend/android/app/build.gradle:18、test/android-release.test.js:75 | 版本2.10.48/96和0.29.20；测试均接入既有入口。依赖版本不变；稳定debug测试签名，无release JKS。 |

这些是应用轮询、生命周期、回执和请求范围问题。本轮没有调用模型，未判断模型是否会选用点歌工具；没有新增成人内容检查或模型回退。外部网易云可用性、登录、版权、音频是否开始仍须供应商和实际设备验收。

## 提示词及数据保护

没有 SQL 或生产用户设置、聊天、记忆的写入/删除；只进行了不存在的虚构用户/伴侣/请求ID的只读查询，结果为0行。测试只有虚构样例，原始歌曲标题、Cookie、模型内容和私密错误不写入新增本机回执。

保护文件相对本轮 Git 基线逐字核对，仅规范化 CRLF：前端 api.js、chat-errors.js、chat-idempotency.js；后端 ai-service.js、persistent-memory-filter.js、provider-output-guard.js、chat-stream-contract.js、settings-store.js、chat-request.js、prompt-security.js、server.js、scripts/check-prompt-architecture.mjs，12处源码不变。数据库目录、身份范围注册表及主聊天提示词不变。

现有 ai-service.js:387、3640 的 agents.md 首块为用户详情、统一个性化指令（未配置则 legacy 原字段）、选中记忆摘要及知识文件块；已有后续 system、心声/世界书和历史/动态上下文装配保持基线。没有改写字段、角色、长度或顺序；没有修改无限上下文、长期记忆选择等其他模块。

## 实际验证

全部工具日志在 E:/chatgpt/artifacts/dengta-music-delivery-20261001。npm/Gradle 命令在各自仓库执行。

| 命令 | 退出码及覆盖范围 |
| --- | --- |
| 前端 node test/music-delivery.test.js、node test/music-request-scope.test.js、node test/music-operation-ui.test.js | 各0；实际控制器/适配器/已有组件配模拟服务。 |
| 后端 node test/music-ai-results.test.js | 0，实际本机HTTP路由和真实RequestScope配模拟DB。 |
| 前端 npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 各0；96个测试文件全部接入，另有原脚本。 |
| 后端 npm test、npm run check、npm run typecheck | 各0；126个测试文件全部接入；提示词架构守卫通过。后端无lint脚本。 |
| 前后端 git diff --check | 各0。 |
| 前端 .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 0，BUILD SUCCESSFUL；原生Java未变，单测UP-TO-DATE，核对已有33用例/10suites无失败，不称本轮重新执行了原生测试。 |
| Codex bundled Python -X utf8 extract-apk.py；node verify-apk.cjs；node secret-check.cjs；Python -X utf8 verify-native.py | 各0；90个public资源与dist匹配、新功能标记存在、DEX保护存在；3个已配置私密值仅在内存比较，未发现打包暴露。 |
| SDK35.0.0/apksigner.bat verify --verbose --print-certs 本轮APK；aapt2.exe dump badging 本轮APK | 各0；v2签名有效，home.dengta.app/2.10.48/96/min31/target36。 |
| SDK/platform-tools/adb.exe devices | 0，设备列表为空。 |
| node probe-music-schema.cjs | 0；2026-09-30T23:41:57.497Z，生产Supabase只读、虚构不存在身份、id/status列及pending过滤，HTTP200/errorCode:null/noRow:true。未验证生产UPDATE、多账号操作或管理面。 |

本轮检索过 Supabase changelog 及当前 [update 官方文档](https://supabase.com/docs/reference/javascript/update)：更新默认不返回行，过滤后链 select 可取得更新回执。maybeSingle网页及附加.md路径在检索工具不可用，实际安装SDK和生产只读查询确认0行maybeSingle表现。没有为了验证写操作而改动真实用户的点歌行。没有新的迁移顺序/重复执行测试，因为没有迁移。

初次试图读取不存在的test/netease-cookie.test.js，以及Windows目录通配符rg搜索失败；改用实际目录和现有脚本。定向、全量、构建均最终通过。React测试渲染器、Vite大chunk、Gradle弃用警告仍在，不声称零警告。

APK：E:/chatgpt/artifacts/dengta-music-delivery-20261001/DengTa-2.10.48-96.apk，36,260,645字节，SHA256 dc1eddf20df2f97e334b107853d33b5fe09dd30a2fb5a0176d16d0b1ce5eabcf。证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6，Android12+稳定debug测试包。

## 发布、风险与剩余验收

本报告写入时本地验证和构建完成；GitHub/CNB、APK上传以及生产前后端具体状态以同目录 final-audit.md、final-state.json 实时回执为准。前端/后端普通main提交分别同步CNB frontend-main/backend-main及标签，不强推；保留仓库私有状态，匿名下载可能404，提供本机APK。回滚使用本轮提交普通revert后再构建发布，无数据库回滚。

仍未验证：真实Android权限变化、App安装和网易云播放、真实模型选用点歌工具、Supabase管理面、多账号生产操作、两台设备同时消费、实际FPS与视觉验收。网页HTTP/资源和自动化不是这些验收。通知识别需要用户系统权限；消费AI点歌只与这项权限解耦，没有移除其他权限机制。

技术回执有100条/24小时及sessionStorage边界；在原生打开开始与回执落本机之间进程被杀、或多台设备同时消费，仍无法保证全局只执行一次。服务器结果确认是幂等的，但尚无跨设备领取租约；表仍沿用played表示原有请求处理结果，界面只声明已交给网易云打开，不推断听到了声音。30方法作用域测试不代表所有外部供应商均兼容。

服务端导入幂等、上传后歌单失败的文件残留、跨设备一起看/一起听替换原子性及原生配置/暂停入口仍需继续审查。下一项趣味候选为可选择的AI点歌试听卡，尚未实现；本轮没有把建议记成已落地功能。整体长期目标仍在进行。
