# 2026-10-01 大歌单性能与选择回执修复

前端 2.10.40 / Android 88；后端保持 0.29.16。前端基线 af1e7b94f25b4703dc37869834a610fa92ff6d6e；后端 27e5f9f723d01f8b423039445cd72ef70c401a6e。

## 根因与改动

原来歌单详情每一首都创建 audio 元素，队列和选曲也一次渲染全部条目；2000 首歌会创建 2000 个音频控件。旧歌单读取没有请求序号，完成后会覆盖新选择；loading 还会阻止用户切换。网易云分享保存后 await 列表刷新，再通知播放器，列表慢时已保存的歌曲迟迟不出现。Together 原 key 只含页面模式，切换伴侣不重新创建组件。

- `src/MusicPagedList.jsx:3`：新增每页50条的列表、上一页/下一页/页码跳转；保持全量数据以及原始全局索引，限制音频控件和按钮节点数量。
- `src/TogetherMusic.jsx:335`：请求序号和 mounted 判断保护选择结果、错误及 loading；清空选择取消旧回执。允许读取期间更换歌单；导入后的选择使用同一序号并正确释放 loading。队列和选曲采用分页。
- `src/MusicSettings.jsx:131`：分享保存后优先通知播放器，普通设置页再异步刷新，紧凑面板不做不必要的刷新；歌单详情分页音频控件。
- `src/App.jsx:7931`：将账号、伴侣、模式纳入 Together key，切换时销毁旧音乐视图。父组件其他状态仍依赖既有生命周期，本版不声称覆盖全部租户端到端。
- `src/together.css:532`：分页触控布局；曲目行选择器适配新容器，避免将分页导航误排为曲目行。
- `src/apple-high.css:466`：轻量主题保持曲目行和按钮原有布局。
- `test/music-import-flow.test.js:55`：真实 React 组件+虚构 API 回执，覆盖慢旧请求、清空后回执、2000首/50控件/最后一首可访问、数据未截断、页码操作全局索引1999、列表卡住时分享导入仍通知播放器。
- `android/app/build.gradle:18`：APK升级版本号88；package.json/package-lock版本2.10.40；Android版本回归同步。

## 提示词、数据与供应商

后端工作树无改动；ai-service、记忆过滤、供应商守卫、settings-store、chat-stream-contract 与当前后端基线 unchanged=true。未新增成人内容限制或改变上游策略；没有读写用户保存的提示词、记忆、数据库。原 agents.md 在 systemInstructions 首位、原 plan 块相对顺序、性别末尾指令、历史/运行时上下文独立路径均保持原有架构。此次只优化本地渲染、消息回执和界面生命周期，不能改变网易云登录、版权或模型工具选择。

## 验证

- 前端 npm test、npm run lint、npm run typecheck、npm run build:web、npm run android:sync、git diff --check：exit 0。86 个测试文件接入 npm test。增加最终分页索引断言后 npm run test:companion-activities 再通过。
- Android gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug：exit 0。
- 后端 npm run check：exit 0；后端代码未改，不重复执行上一轮刚通过的全量测试。
- apksigner verify --verbose --print-certs、aapt2 dump badging、extract-apk.py、verify-apk.cjs、secret-check.cjs、inventory.cjs：exit 0。89个网页文件与最终 dist 一致；3个配置私密值未暴露。
- 首次 prepare.cjs 因 Android 测试没有 versionName 字面量退出1；已保留中间变更并修复为可重入脚本，再次执行exit0，没有因失败覆盖代码。
- Web 仍有大分包警告，Gradle有既有弃用警告，React测试渲染器有弃用提示。

## 交付与限制

无数据库迁移、无数据删除、无供应商/平台配置修改。Android minSDK31 / targetSDK36，home.dengta.app，稳定 debug 证书与上一版一致。APK大小 36243693；SHA256 32db05beec22e6ae55e2e3f47edd9a355939f5ab83436b6cf183529ba05fb3ff。

CUA 已有网站标签连接再次30秒超时；adb设备0。真实账号播放、供应商调用、Supabase管理面、多账号端到端、真机安装和FPS未验证。组件测试证明渲染音频元素从2000降到50（97.5%），不代表真机帧率提升97.5%。仍有完整歌单数据下载与内存占用，未把分页宣称为无限容量。

GitHub/CNB、APK发布和生产版本的最终状态请看本轮 final-audit.md；提交前此报告不提前宣称上线。回滚使用前端基线正常新增回滚提交，无数据库回滚，不强推。
