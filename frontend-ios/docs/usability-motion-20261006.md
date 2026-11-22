# 设置导航、长指令编辑与动态效果回归（2.10.66 / 114）

本轮继续优化整套界面的使用体验。前端起点 `ff654edf465390adeedb6cb7bfc20cc3e50688a8`，后端起点 `8dd525b2d15cada57cacf80d293e9c9cabcf2ad9`。开始委派前工作树干净；稍后生成的 inventory 中两个未跟踪测试文件是本轮代理刚创建的文件，不是用户遗留改动。

## 已确认的原因与行为变化

- 个性化编辑器读文件时只检查返回那一刻是否禁用，禁用后又启用会接受旧回执。现在禁用立即使导入操作失效，解除按钮等待并解释取消；原文不变。File.arrayBuffer 本身没有本实现可调用的取消接口，取消的是回执及草稿追加，不是磁盘读取。
- 大指令连续修改原来每次启动 Worker 并复制整段文本。超过 20000 UTF-16 单元的字符统计现在等待最后一次输入 150ms；编辑和保存原文仍即时传递。真实 hook 的百万 UTF-16 虚构样例连续更新夹具中，Worker 启动由 9 次变为 1 次；这不是 Android 帧率或生产耗时测量。
- 应用内“减少动画”原来没有传递到天空、设置 WebGL、状态 WebGL 和通用按钮/弹窗 CSS。现在应用和系统偏好共同控制这些装饰。太阳、月亮、静态天空仍保留；减少动画时背景循环停止，状态拖尾不分配引擎。静态设置背景在尺寸变化、滚动结束时重新绘制一帧，修复旧版只绘制初始帧的尺寸问题。CSS 也隐藏前奏遮罩，避免取消动画后遮罩留到旧有限定时器结束。
- 设置清空搜索、关闭可选引导或入口整理后，焦点原来会掉到页面根部。现在返回对应操作入口；唯一搜索结果可按回车打开，中文输入组合期间不会误跳转。
- 新增可选“整理常用入口”：最多固定四个分类，初始仍为三个入口。只保存此设备当前账号与伴侣的分类 ID，支持取消全部和恢复默认；没有身份范围时不持久化，存储失败仍可临时使用并给出反馈。
- 听歌、成就、发现、外卖、工作区以及隐式放映厅原来顶部标题缺项。现在使用导航已有中文名称，聊天仍保留会话名，未知入口有回退标题。其余已有英文标题改为与导航一致，是视觉统一，不是运行错误。
- 浏览器实际打开空播放器时 React 报告空字符串 src。TogetherMusic 现在没有歌曲时不传 src，有歌曲时保留原 URL，避免空地址请求当前页的风险。

## 源码落点

| 文件与行号 | 目的 |
| --- | --- |
| `src/App.jsx:7971` | 向设置首页传递账号与伴侣作用域 |
| `src/App.jsx:9205`、`:9215` | 动态偏好 root 标记生命周期与模块标题 |
| `src/SettingsHome.jsx:39`、`:44`、`:49`、`:60`、`:95`、`:187` | 作用域、搜索/组合输入、存储反馈、可选整理与引导焦点 |
| `src/settings-navigation.js:79`、`:82`、`:88`、`:98` | 分类 ID 白名单、最多四项、限定作用域读写 |
| `src/settings-home.css:104` | 整理控件、可换行选项与状态反馈样式 |
| `src/PersonalizationEditor.jsx:46` | 禁用时旧读取失效，保持原文 |
| `src/use-personalization-character-count.js:5`、`:23`、`:39` | 150ms 后台计数、Worker 和定时器清理 |
| `src/use-reduced-visual-motion.js:5`、`:10`、`:24` | 应用/系统偏好共享订阅与清理 |
| `src/visual-loop.js:2`、`:13` | 静态绘制与动态循环控制 |
| `src/CelestialBackdrop.jsx:309`、`:334` | 天空遵循应用和系统偏好 |
| `src/SettingsFlowField.jsx:248`、`:283`、`:294` | 静态背景、滚动结束与 resize 单帧重绘 |
| `src/StatusFlowField.jsx:38`、`:266` | 减少动画时不创建拖尾资源 |
| `src/ThemeStudio.jsx:201` | 动态开关说明与真实行为一致 |
| `src/interface-polish.css:41`、`:49` | 通用 CSS 减动态和前奏遮罩隐藏 |
| `src/TogetherMusic.jsx:894` | 无音频时省略 src |
| `test/settings-home-usability.test.js:1` | 新增 10 项实际 React 组件导航与存储回归 |
| `test/personalization-editor-lifecycle.test.js:1` | 新增 8 项导入和计数生命周期回归 |
| `test/feature-title.test.js:1`、`test/app-motion-preference.test.js:1` | 新增 38 项实际接线、偏好、静态绘制与清理回归 |
| `test/settings-home.test.js:1`、`test/personalization-editor.test.js:1`、`test/together-music-lifecycle.test.js:1` | 保留原断言；适配计数启动，加入真实播放器 src 检查 |
| `package.json:1`、`package-lock.json:1`、`android/app/build.gradle:1`、`test/android-release.test.js:1` | 2.10.66 / 114 与新测试进入常规套件 |

## 用户数据、提示词与供应商边界

本轮没有访问生产用户正文、修改数据库或迁移。没有改个性化指令、详情、记忆、历史、世界书、身份字段、模型路由、内容处理或供应商策略。前后端 13 个受保护文件按本轮不可变 Git 起点核对均不变；不宣称它们等同于限制器中更早的历史哈希。

个性化输入在当前架构已无固定前端字数上限，本轮改善连续编辑成本，没有把模型上下文变成无限容量。后端整个 JSON 请求仍受现有 30mb 上限约束（`server.js:571`）。原百万 UTF-16 文本经实际后端 updateStoredSettings 加内存数据库适配器保存回读一致测试通过；生产数据库容量和手机巨型文本布局仍未验收。

本轮不重装配提示词，实际装配顺序维持基线。此前详细实码取证见 `docs/interface-update-20261006.md:28`；不能把 UI 中的描述或限制器简写当成对整个最终请求顺序的新证据。当前修复原因属于前端导航/动画/编辑/播放器逻辑，未证实与外部模型内容限制有关。

## 实际验证结果

证据保存在 `E:/chatgpt/artifacts/dengta-usability-20261006/`，含命令日志、JSON 回执与最终截图。所有模拟账号和 API 样例为虚构数据。

| 实际命令 | 退出码/结果 |
| --- | --- |
| `node --test test/settings-home-usability.test.js` | 0；10/10 |
| `node --test test/personalization-editor-lifecycle.test.js` | 0；8/8 |
| `node --test test/feature-title.test.js test/app-motion-preference.test.js` | 0；38/38 |
| `node --test test/personalization-editor.test.js` | 0；原文、编码、作用域、百万文本、后台计数通过 |
| 前端 `npm test` | 0；包含新增 56 项定向回归和原有全套 |
| 前端 `npm run lint`、`npm run typecheck` | 均 0 |
| 前端 `npm run build:web`、`npx cap sync android` | 均 0 |
| 后端 `npm test`、`npm run check`、`npm run typecheck` | 均 0；后端无改动 |
| `node E:/chatgpt/artifacts/dengta-usability-20261006/build-android.cjs` | 0；assembleDebug 与 testDebugUnitTest，35 项原生单测/11 套件通过 |
| `extract-apk.py`、`verify-apk.cjs` | 均 0；93 个 ZIP 网页资源，预期缺失与哈希差异均为 0 |
| `verify-tools.cjs`、`verify-native.py` | 均 0；版本 2.10.66/114，minSdk31/targetSdk36，原证书一致，DEX 标记存在 |
| `protected-check.cjs`、`secret-check.cjs` | 均 0；13/13 不变，检查的三个私密配置值未进入 APK，日志不输出值 |
| `git diff --check` | 0；现有 autocrlf 行尾提示不属于 whitespace error |

基线测试不满足新条件的数量包含新功能要求与额外体验标准，不等于同等数量线上报错。测试开发期间的编译提取、缺失检查文件等待和命令路径错误已经纠正；不计为产品故障。

浏览器使用真实完整 App、虚构账号和拦截 API 的本地夹具。12 个非聊天侧栏模块均显示正确标题；搜索清空焦点和唯一结果回车、手机聊天状态面板进入设置、常用入口保留均通过。390×844、360×740 横向溢出为 0。启用减少动画后根 DOM 标记为 true，检查的按钮 animationName 均为 none。最终页控制台 warn/error 为 0，系统偏好/循环资源/静态重绘由实际组件及适配器测试补充。

初版夹具的 auth alias 未设 pre 优先级，被 Vite 内部解析抢先，造成空认证作用域和音乐加载提示；最终夹具已修复，并用实际模块 HTTP 内容核对别名。这是夹具故障，不是生产认证故障。初版真实播放器空 src 警告确属产品问题并已修复。浏览器未调用生产模型、支付、外卖下单或用户私有内容。

## 安装包与交付状态边界

已构建 `DengTa-2.10.66-114.apk`，36,304,300 字节，SHA-256 `9e93b4ee63a29b8dc61468e370dda729bb8a7e10f2dc0b9a0777bb98b5ae0169`。沿用已有 debug 签名，未创建/替换发布 JKS。minSdk31 要求 Android 12 或以上，未声称支持更早系统。

本报告写入时推送与网站/CDN核对尚未执行；最后的真实 GitHub/CNB、网站资产及 APK 发布结果由阶段目录的 frontend-commit.json、frontend-tags.json、production-state.json、production-extra-assets.json、published-apk.json、release-audit.json 和最终综合报告记录。不能以构建成功代替上线验收。后端 GitHub/CNB 推送仍暂缓；Render 仅进行健康状态读取，不部署、不改配置。Vercel/Cloudflare 没有手工配置写入。

数据库迁移、Supabase 管理面、生产账号/供应商调用、多账号生产隔离、Android 真机安装、帧率/发热/触控手感均未在本轮验收。adb 设备数量为 0。不宣称所有功能端到端全部通过。可回滚到上述前端起点及已有 v2.10.65/113 安装包；不需要数据库回滚。
