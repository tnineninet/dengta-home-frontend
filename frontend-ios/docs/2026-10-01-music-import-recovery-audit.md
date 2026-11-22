# 歌曲上传与歌单保存恢复（2.10.50 / 98）

本轮针对“音频上传成功、歌单保存失败后只能重选文件”以及“超时重试重复生成歌单”的实际入口修复。后端版本0.29.21。最终检查、同步、APK、生产回执在 `E:/chatgpt/artifacts/dengta-music-import-recovery-20261001/final-audit.md`，该文件只在最终验证通过后生成。

## 根因与变化

- `src/MusicSettings.jsx:226` 原先上传后立即创建歌单，失败时没有可复用音频回执。现在保留当前面板内的回执，显示“继续保存歌单”，只补做保存。快速连点复用现有music scope锁，关闭面板/切换身份取消后续回调。
- `src/MusicSettings.jsx:37` 以账号和伴侣建立独立面板实例，隔离恢复记录、忙碌状态和错误；没有新轮询、后台监听或人工延时。
- `src/MusicSettings.jsx:131` 文本歌单未改变时保留请求UUID；改变内容、名称、来源或账号后创建新UUID，成功后清除。网易云Provider导入不经过此新机制，不宣称所有远端导入均实现幂等。
- `src/music-import-recovery.js:1` 真实恢复控制器在保存失败时保留原请求和音频回执。恢复仅在本面板有效，不承诺刷新页面、杀进程或跨设备恢复。
- `src/music-listening.js:354` 传递`request_id`，POST不自动重试；上传回执须为公开HTTPS有效地址。格式/容量/无效回执显示稳定错误码。
- `src/together.css:124` 恢复区使用既有布局和44px按钮，不引入持续动画或背景模糊。没有新的FPS测量结论；保留太阳、月亮、既有背景。
- 后端`services/music-import-recovery.js:16` 使用现有表主键和曲目位置约束，生成账号/伴侣/请求/解析内容绑定的稳定UUID。读取实际回执，只补缺失项；已有用户编辑冲突时返回409，不覆写，不删除。不带request_id的旧客户端沿用旧导入路径。
- 后端`routes/v2/music.js:129` 同账号/伴侣、扩展名及相同文件字节生成稳定SHA256路径，`upsert:false`；只认确切的存储“已存在”错误。不同账号或不同内容路径不同。旧随机路径文件不会被清理或迁移。
- 后端上传支持MP3/M4A/AAC/WAV/FLAC/OGG/OPUS；Opus使用audio/ogg。扩展名白名单不等于解码成功；实际能否播放仍以设备播放器为准。Multer超限、错误表单、存储权限、格式、限流和网络故障使用独立技术错误码。

## 生产配置与数据保护

只读核对生产`music-uploads`桶，发现AAC未列入白名单，容量20971520字节、public=true。补充`061_music_upload_aac.sql`仅向此桶的非空白名单追加audio/aac；重复执行无额外变化；不改变容量、public/RLS或其他桶。生产采用Storage updateBucket API执行等效配置更新，具体是否成功以storage-bucket-update.json为准，不谎称SQL Editor已执行。

用户之前已授权“做完全套…需要推送就推送”，并授权登录Supabase进行功能修复。配置更新前保留只含桶元数据的前后快照；rollback-bucket.cjs仅在配置仍与本轮回执一致时允许恢复。没有删除文件、歌单或用户记录，没有访问生产聊天/记忆正文，没有修改提示词、角色档案或个性化字段。前后端12个保护源码文件将与本轮Git基线逐项比较（仅归一化CRLF）。音乐导入不调用LLM，未插入任何系统提示词，本轮不重新宣称已审查整套提示词装配顺序或内容拒答来源。

容量保持真实20MB；不能把multer内存上传直接扩到1GB。Supabase建议较大文件使用可恢复上传，见[标准上传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)。未来需分块、校验、进度和断点续传。配置接口依据[updateBucket](https://supabase.com/docs/reference/javascript/storage-updatebucket)，重复对象行为依据[Storage错误码](https://supabase.com/docs/guides/storage/debugging/error-codes)。

## 测试与限制

新增前端`test/music-import-recovery.test.js`，执行真实React设置面板和真实API适配器：上传成功保存失败、重试不重传、同tick锁、文本UUID稳定、变更请求、身份切换、卸载取消、错误上传地址。现有`music-operation-ui.test.js`改为按实际上传label定位，与本机试听入口明确区分；Android版本断言同步为98。

新增后端`test/music-import-recovery.test.js`，真实RequestScope过滤+内存DB故障注入、真实Express HTTP multipart：头部响应丢失、部分曲目、并发重复、不同账号/伴侣、用户已改曲目不覆盖、读取失败、重复音频内容、不同字节、AAC/OPUS、容量、未登录、配置及存储错误。文件字节为虚构协议fixture，不是真实音频解码验收。

新增`test/music-upload-migration.test.mjs`：PGlite重复执行迁移，保留其他桶、公私权限、容量、原格式顺序及空白名单。完整多租户PGlite测试现执行000-061迁移；其断言更新为新最后迁移。

本轮没有真实用户上传、播放/暂停或生产多账号功能调用。浏览器自动化getState返回已有灯塔标签，但getTab绑定40秒超时、kernel reset；没有取到页面截图，不能将React fixture说成浏览器点击验收。真机、真实平台音乐版权/解码、跨设备领取与恢复、1GB分块上传均待验收。

全量检查由checks.cjs记录每条命令与真实退出码；最终APK在build:web和cap sync完成后构建，提取assets/public逐项对比dist，并检查版本、签名和私密凭据。GitHub/CNB分支标签、Render健康版本/revision、Vercel公开页面/资源哈希分别核对。Vercel管理API此前403，本轮不重复轮询，不声称平台READY/运行时日志已验收。GitHub仓库私有，不改权限；本地APK为主要交付路径。

后续适合优先增加：可见上传进度与断点恢复、大文件仅本机模式引导、AI点歌试听卡及可选推荐理由、播放队列跨设备领取租约。均为候选，未列为已完成。

## 本轮实际命令结果

| 范围 | 命令 | 退出码 |
| --- | --- | --- |
| frontend | `npm test` | 0 |
| frontend | `npm run lint` | 0 |
| frontend | `npm run typecheck` | 0 |
| frontend | `npm run build:web` | 0 |
| frontend | `npx cap sync android` | 0 |
| backend | `npm test` | 0 |
| backend | `npm run check` | 0 |
| backend | `npm run typecheck` | 0 |
| Android | `.\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug` | 0 |
| 前后端 | `git diff --check` | 0 / 0 |
| APK | `apksigner verify --verbose --print-certs` | 0 |
| APK | `aapt2 dump badging` | 0 |
| APK | Python解包 + verify-apk.cjs + secret-check.cjs + verify-native.py | 0 |
| Storage | inspect-bucket.cjs / update-bucket.cjs /再次inspect-bucket.cjs | 0 / 0 / 0 |

98个前端及128个后端测试文件均已接入实际npm测试链；Java结果包含35例、11套件、零失败，本轮Gradle testDebugUnitTest为UP-TO-DATE，未重新执行这些Java测试。没有新Java源码修改。

本轮最初前端测试因版本断言仍为97失败，更新到98；随后lint发现render读ref和effect同步setState，改为懒初始化控制器和身份key隔离，最后全量检查均退出0。失败日志保留，不把首次失败写成首次通过。

最终APK：DengTa-2.10.50-98.apk，36264489字节，SHA256 `789ca79cba4fb70a5412e64e36666489691a36207a74fa513cab99e010dd51bd`；Android12+，包名home.dengta.app，target36，稳定debug签名。90个解包public资源逐项匹配dist，私密凭据扫描未发现泄漏。只使用apk-public-50-verified目录作为本轮资源证据。
