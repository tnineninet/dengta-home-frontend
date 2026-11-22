# DengTa 设置、媒体与大文件导入修复验收记录

日期：2026-09-30；前端 2.10.34，后端 0.29.10，APK 82。

## 用户最新决定

性别数据库迁移暂缓。没有执行生产 SQL，也没有修改任何账号人设、记忆或世界书。现阶段性别功能显示“暂待启用”，使用原有角色设定，其他设置可正常保存；未来用户登录 Supabase 后再单独处理。现有 060_companion_gender.sql 只在本地 PGlite 中执行两次并验证约束，生产未执行。

## 已确认根因与修复

- 生产性别字段只读探测返回数据库 42703（缺列）；不是内容限制或模型错误。以前任一性别字段会阻断整份设置保存。现在后端移除尚未支持的三个字段，前端能力标记禁用控件并排除载荷，其他字段继续保存。迁移后的实例仍可保存性别。
- 背景永久删除函数存在，但路由 operations 未注册 deleteAssetPermanently；点击永久删除会失败。现已注册，清除偏好出错时在删文件前停止，跨账号仍 404；前端删除成功即清除列表和选择，避免冗余请求再次产生假失败。
- 媒体异步请求在组件清理后仍可能创建 objectURL，造成未释放资源。现在取消旧请求并在已失效时停止创建，避免旧图片迟到。头像固定为 38px 圆角方形；窄屏设置说明换行，降低重复背景模糊。没有测定真机帧率或承诺固定 60/120FPS。
- CSV 曾按换行拆开带引号的多行字段；JSONL 和部分多层导出、GBK/UTF-16、邮件 MIME 也存在误读。现在按实际格式解析，JSONL 世界书保留关键词等元数据，PDF/DOCX 真实样本通过，DOCX 复用 48MB/5000 条目资源限制。旧 DOC/ZIP/表格在新入口明确提示转换，不伪装已支持。
- 原导入曾将超长 JSON 截断后再解析。现在完整 JSON 超 100 万字返回明确错误，不截断、不保存。
- Kiwi 本地当前网关 AI 只读前 3 万字，回退只取 200 段×2000字，不能把成功响应当作所有历史都已保存。现在说明真实覆盖；文件/历史导入即便 HTTP200 但 ok=false 也失败，提供具体原因及日志。超时不自动重放，以免重复保存。未修改 Kiwi 的既有未提交代码。
- Ombre 某些版本只有 breath 读取工具，原白名单未识别；已补充 breath/breath_advanced/source_read，保留授权和写删工具排除。真实用户 Ombre 服务未在本轮验证。官方来源：[工具定义](https://github.com/P0luz/Ombre-Brain/blob/main/docs/INTERNALS.md)、[旧版工具](https://github.com/P0lar1zzZ/Ombre-Brain/blob/main/README.md)。

## 容量与格式的实际范围

| 入口 | 容量与行为 |
|---|---|
| 风格提纯 | 纯文本最多 1GiB；>20MB 在 Worker 全文件分块扫描并按位置取样，模型仅分析最多 6 万字；文档直传 20MB |
| 数据导入 | TXT/MD/LOG/CSV/TSV/JSONL/NDJSON 最多 1GiB，约 64KiB 起始分页，保持编码和 CSV/JSONL 记录边界，逐段预览与确认，不自动覆盖用户字段 |
| 完整 JSON | 直传最多 100MB，解析最多 100 万字，超限返回明确错误 |
| PDF/DOCX/EML | 20MB；扫描 PDF 需 OCR，加密/损坏文件有具体错误 |
| 其他文本 | HTML、SRT/VTT、XML、YAML、INI/CONF 等；不是任意二进制格式都支持 |
| 旧记忆网关 | 文件 20MB，历史最多 5000 条/30 万字；还受上述网关整理限制 |

1GiB 本地实体文件测试：1073741824 字节，1024 个批次，每次读取最多 1048576 字节，抽样 60000 字，耗时 1439ms，桌面 Node 峰值 RSS 141201408 字节。临时实体文件已精确删除。此证据不等于 Android/浏览器 1GiB 性能验收，也不代表模型可接收 1GiB 上下文。

## 提示词与用户数据保护

主 ai-service.js SHA256 保持 E8068639957B20F51D8814421BF01516BDE99752CB588B5873BA41C65202B9CD；没有改动主提示词装配、上游路由、安全过滤器或供应商策略。现有顺序沿用既有架构：用户个性化指令和详情进入最高应用级 system/instructions，稳定记忆、会话历史和本轮背景独立装配；没有将记忆升级为新的固定最高规则。性别仅在已有配置启用时补充低层角色称谓；未配置返回空块。原文保留由 settings/companion-gender/content-import 回归验证。所有新增解析验收使用虚构星灯样本或本地假数据库，没有对真实账号提交测试记忆或应用提纯人设。上游模型限制不由本轮修改绕过；没有新增主题词拦截。

## 修改文件

### frontend

| 文件与位置 | 修改目的 |
|---|---|
| [android/app/build.gradle:18](E:/chatgpt/dengta-home-frontend/android/app/build.gradle:18) | APK 2.10.34 / 82，与前端版本一致 |
| [package-lock.json:3](E:/chatgpt/dengta-home-frontend/package-lock.json:3) | 依赖锁定，兼容修复与 sharp 0.35.5 安全更新 |
| [package.json:4](E:/chatgpt/dengta-home-frontend/package.json:4) | 版本、测试入口和后端 MIME 解析依赖 |
| [src/App.jsx:53](E:/chatgpt/dengta-home-frontend/src/App.jsx:53) | 大文本扫描、取消读取与真实覆盖说明；记忆导入失败判定及日志入口 |
| [src/CompanionGenderFields.jsx:4](E:/chatgpt/dengta-home-frontend/src/CompanionGenderFields.jsx:4) | 未迁移时禁用性别控件并说明其他设置仍可保存 |
| [src/ContentImport.jsx:2](E:/chatgpt/dengta-home-frontend/src/ContentImport.jsx:2) | 大文件逐段预览与确认，切换来源清空旧预览 |
| [src/ExternalMemoryConnections.jsx:3](E:/chatgpt/dengta-home-frontend/src/ExternalMemoryConnections.jsx:3) | 显示外部记忆错误码及上下游 HTTP |
| [src/MediaSettings.jsx:2](E:/chatgpt/dengta-home-frontend/src/MediaSettings.jsx:2) | 删除后即刻清除本地选择，取消重复清偏好请求，明确恢复默认 |
| [src/content-import-api.js:2](E:/chatgpt/dengta-home-frontend/src/content-import-api.js:2) | 1GiB 文本分页、编码边界、CSV/JSONL 完整记录边界与精确错误 |
| [src/main.jsx:14](E:/chatgpt/dengta-home-frontend/src/main.jsx:14) | 最后加载设置与媒体修正样式 |
| [src/settings-service-errors.js:4](E:/chatgpt/dengta-home-frontend/src/settings-service-errors.js:4) | Ombre 和私密媒体具体原因与操作提示 |
| [src/settings.js:105](E:/chatgpt/dengta-home-frontend/src/settings.js:105) | 排除服务端能力标记与未启用性别字段，保持人设原文 |
| [src/style-distill.js:11](E:/chatgpt/dengta-home-frontend/src/style-distill.js:11) | 文档解析错误反馈 |
| [src/use-private-media.js:19](E:/chatgpt/dengta-home-frontend/src/use-private-media.js:19) | 取消失效媒体请求，避免清理后创建未释放的对象地址 |
| [test/android-release.test.js:75](E:/chatgpt/dengta-home-frontend/test/android-release.test.js:75) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/companion-gender.test.js:34](E:/chatgpt/dengta-home-frontend/test/companion-gender.test.js:34) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/content-import-api.test.js:85](E:/chatgpt/dengta-home-frontend/test/content-import-api.test.js:85) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/mobile-layout.test.js:117](E:/chatgpt/dengta-home-frontend/test/mobile-layout.test.js:117) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/settings.test.js:78](E:/chatgpt/dengta-home-frontend/test/settings.test.js:78) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [src/large-text-file.js:1](E:/chatgpt/dengta-home-frontend/src/large-text-file.js:1) | 1MiB 分块扫描、UTF-8/UTF-16/GB18030 边界与位置取样 |
| [src/large-text-reader.js:1](E:/chatgpt/dengta-home-frontend/src/large-text-reader.js:1) | Worker 调用、进度与取消 |
| [src/large-text-worker.js:1](E:/chatgpt/dengta-home-frontend/src/large-text-worker.js:1) | 后台文本扫描，减少主线程工作 |
| [src/settings-media-polish.css:1](E:/chatgpt/dengta-home-frontend/src/settings-media-polish.css:1) | 设置窄屏布局、文字换行、头像稳定几何与移动端降低重复模糊 |
| [test/content-import-paging.test.js:1](E:/chatgpt/dengta-home-frontend/test/content-import-paging.test.js:1) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/large-text-file.test.js:1](E:/chatgpt/dengta-home-frontend/test/large-text-file.test.js:1) | 回归：读取、容量、隔离、数据原文或错误行为 |

### backend

| 文件与位置 | 修改目的 |
|---|---|
| [package-lock.json:3](E:/chatgpt/dengta-home-backend/package-lock.json:3) | 依赖锁定，兼容修复与 sharp 0.35.5 安全更新 |
| [package.json:3](E:/chatgpt/dengta-home-backend/package.json:3) | 版本、测试入口和后端 MIME 解析依赖 |
| [routes/external-memory.js:17](E:/chatgpt/dengta-home-backend/routes/external-memory.js:17) | 附稳定错误码与受限上游状态 |
| [routes/v2/imports.js:4](E:/chatgpt/dengta-home-backend/routes/v2/imports.js:4) | 异步文档解析、JSONL 世界书元数据、未知扩展 JSON 结构保留 |
| [routes/v2/private-media.js:31](E:/chatgpt/dengta-home-backend/routes/v2/private-media.js:31) | 永久删除函数注册到路由，修复实际缺失的调用 |
| [server.js:3](E:/chatgpt/dengta-home-backend/server.js:3) | 旧记忆上传限制反馈、失败进统一日志、返回安全业务错误码 |
| [services/adaptive-file-parser.js:6](E:/chatgpt/dengta-home-backend/services/adaptive-file-parser.js:6) | CSV/TSV/JSONL/编码/MIME/PDF/DOCX 解析与格式明确拒绝 |
| [services/ai-provider-center.js:439](E:/chatgpt/dengta-home-backend/services/ai-provider-center.js:439) | 根据实际返回字段报告性别可用性，不暴露供应商密钥 |
| [services/chat-attachments.js:943](E:/chatgpt/dengta-home-backend/services/chat-attachments.js:943) | 复用既有 DOCX 解压资源限制，保留附件隔离 |
| [services/companion-gender.js:45](E:/chatgpt/dengta-home-backend/services/companion-gender.js:45) | 已启用时准确区分他/她/TA 和直接自述我，未配置不注入 |
| [services/content-import.js:2](E:/chatgpt/dengta-home-backend/services/content-import.js:2) | 多编码导入；完整 JSON 超限明确失败，防止截断损坏 |
| [services/diagnostic-errors.js:8](E:/chatgpt/dengta-home-backend/services/diagnostic-errors.js:8) | 新导入与媒体错误码、元数据日志与外部记忆来源识别 |
| [services/external-memory.js:27](E:/chatgpt/dengta-home-backend/services/external-memory.js:27) | 补充 breath/breath_advanced/source_read 读取工具，仍排除写/删工具 |
| [services/private-media.js:307](E:/chatgpt/dengta-home-backend/services/private-media.js:307) | 清除偏好失败先报错，不继续删文件 |
| [services/settings-store.js:218](E:/chatgpt/dengta-home-backend/services/settings-store.js:218) | 兼容旧客户端，忽略未启用性别字段并保存其余受支持字段 |
| [test/companion-gender.test.js:35](E:/chatgpt/dengta-home-backend/test/companion-gender.test.js:35) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/content-import.test.js:249](E:/chatgpt/dengta-home-backend/test/content-import.test.js:249) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/diagnostic-errors.test.js:25](E:/chatgpt/dengta-home-backend/test/diagnostic-errors.test.js:25) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/external-memory.test.js:32](E:/chatgpt/dengta-home-backend/test/external-memory.test.js:32) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/private-media-routes.test.js:28](E:/chatgpt/dengta-home-backend/test/private-media-routes.test.js:28) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/private-media.test.js:41](E:/chatgpt/dengta-home-backend/test/private-media.test.js:41) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [services/memory-import-feedback.js:1](E:/chatgpt/dengta-home-backend/services/memory-import-feedback.js:1) | 网关原因映射、超时防重复提示、真实覆盖限制 |
| [test/adaptive-file-parser.test.js:1](E:/chatgpt/dengta-home-backend/test/adaptive-file-parser.test.js:1) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/companion-gender-migration.test.js:1](E:/chatgpt/dengta-home-backend/test/companion-gender-migration.test.js:1) | 回归：读取、容量、隔离、数据原文或错误行为 |
| [test/memory-import-feedback.test.js:1](E:/chatgpt/dengta-home-backend/test/memory-import-feedback.test.js:1) | 回归：读取、容量、隔离、数据原文或错误行为 |


## 实际验证

| 目录 | 命令 | 退出码 |
|---|---|---|
| backend | npm run check | 0 |
| backend | npm run test:content-import | 0 |
| backend | npm run test:diagnostic-errors | 0 |
| backend | npm run typecheck | 0 |
| backend | npm test | 0 |
| frontend | npm run build:web | 0 |
| frontend | npm run lint | 0 |
| frontend | npm run test:content-import | 0 |
| frontend | npm run typecheck | 0 |
| frontend | npm test | 0 |
| frontend | npm run android:sync | 0 |
| frontend/android | gradlew :app:testDebugUnitTest :app:assembleDebug | 0 |
| artifact | node scan-one-gib.cjs | 0 |
| artifact | node verify-apk.cjs | 0 |
| Android tools | apksigner verify --verbose --print-certs | 0 |
| Android tools | aapt2 dump badging | 0 |
| backend | npm audit --omit=dev --json | 0，0 个已知漏洞 |
| 两仓库 | git diff --check | 0；仅行尾转换提示 |

初次前端全量测试发现新增 CSS 顺序和 APK versionCode 的旧断言，已修正后全量通过；不存在以跳过失败项冒充通过。完整日志在 E:\chatgpt\artifacts\dengta-media-import-20260930。

APK：36368207 字节，88 个资源与构建一致；SHA256 e894cf868d25d3c6bf0b3c0fe92ac98a973b3c0d369f1859e271f064e4219d85；稳定 debug 证书 SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6；包名 home.dengta.app，minSdk31（Android12）。没有使用或变更 release JKS。公开 Supabase 配置和生产后端地址存在，未发现所扫描的私密凭据模式；不能据此断言任意秘密类型全部不存在。

## 未验证与发布边界

- adb devices 无设备，未执行 Android 真机安装、媒体操作、聊天或帧率测试。
- Windows computer-use 因无法可靠确定浏览器 URL 而拒绝界面检查；没有改用其他方式绕过。当前版本新界面实操、生产账号保存验证与真实 Ombre 接入仍待验收。此前版本真实默认模型提纯调用与日志读取证据不可替代本版本全功能验收。
- 未执行本版本实际账号成人场景、Supabase 管理面检查、生产多账号隔离或所有供应商真实请求。跨账号行为由本地隔离回归覆盖。
- 本报告提交时 GitHub/CNB 推送和 Render/Vercel 发布尚待执行；最终实际同步版本及下载链接以工作区 production-state.json/published-apk.json/git-sync.json 和最终说明为准。回滚方式：将本次前后端提交分别 revert 并重部署，不回滚用户数据库；本次没有执行迁移。
