# 第二十二轮：原生权限补丁与播放超时恢复

日期：2026-10-14。原私有前端 main / HEAD `71f4df765aee78ca4d76714a6a4e5c922f7eb6e3`；后端 main / HEAD `8dd525b2d15cada57cacf80d293e9c9cabcf2ad9`。从累计 204/18 项未提交改动继续，未覆盖原有工作。本轮构建 2.10.70 / 118，并将六个前端文件与公开发行说明发布到公开父仓库；私有工作树没有提交，后端推送仍暂缓，未部署生产服务。

## 根因与实际变化

1. **Android WebView 同源权限漏洞**：原安装的 `@capacitor/android 8.4.2` 在官方 GHSA-rvm3-566m-v7fv 受影响范围。外部文档可经内部代理路径进入应用同源环境；这是原生技术权限问题，不是聊天内容限制。固定 Android/Core/CLI 到同一补丁版 8.4.3，并重新编译 APK。[维护方公告](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv)。
2. **旧图标工具依赖链**：源码实际直接使用 Sharp，却经未使用的 `@capacitor/assets` 间接引入旧 CLI、Sharp、Xcode 等工具。移除该工具依赖，直接声明 Sharp 0.35.5，并更新现有版本范围内的安全补丁。锁文件节点 598→308；这些多数是开发工具，不能据此宣称 APK 也减少 290 个运行包。23 个既有图标输出哈希不变。
3. **恢复播放超时后又开始播放**：候选下一首已有释放逻辑，但恢复当前歌曲等待 `Audio.play()` 超时时，只结束了等待。迟到的 play 事件仍可让声音与卡片恢复。新增回归在修复前 10/11、修复后 11/11；现在失败/取消会清除播放意图并暂停，迟到事件只在仍允许播放时生效。新的明确重试不会被旧完成回调暂停。
4. **播放器错误解释**：恢复超时说明“已保持暂停，点播放重试”；下一首超时说明保留当前歌曲；初次启动超时说明未开始播放并指向一起听手动选歌。没有回显供应商原始错误。
5. **后端代理库补丁**：只把锁文件中的 proxy-addr 2.0.7 升级到 2.0.8。当前 `trust proxy = 1` 不走公告的受影响子网编译路径，未证实本项目已遭利用；升级不能代替生产代理拓扑验证。未修改服务器运行逻辑、提示词或用户数据。

## 文件位置

| 文件 | 位置与目的 |
| --- | --- |
| frontend/package.json:4、86、89、101、112 | 版本 2.10.70，Capacitor 补丁，移除旧资源工具，直接依赖 Sharp |
| frontend/package-lock.json | 对应锁版本及安全传递依赖；其他既有脚本和工作保持 |
| frontend/android/app/build.gradle:18 | versionCode 118 / versionName 2.10.70，沿用已有测试签名 |
| frontend/test/android-release.test.js:75 | 新安装包版本门禁 |
| frontend/src/built-in-now-playing.js:17、30、36、55、111、125 | 播放意图、失败暂停、迟到事件与明确超时反馈 |
| frontend/test/built-in-now-playing.test.js:171、190 | 超时后迟到播放与新重试所有权回归 |
| backend/package-lock.json:2920 | 唯一 proxy-addr 锁节点补丁 |

## 已执行验证

| 实际命令 / 范围 | 结果 |
| --- | --- |
| 前端、后端 `npm ci` | 最终退出码 0；前端首次 manifest 比较脚本拒绝复制 lock，修正深相等比较后安装成功 |
| 前端 `npm audit --json`、`--omit=dev` | 各退出码 0，已知公告受影响节点 0 |
| 后端 `npm audit --json` | 退出码 1；critical 0，moderate 3，未虚报清零 |
| Sharp 同 API 烟测 | 9 项通过；23 个既有资源哈希保持 |
| 前端最终 `npm test` | 退出码 0 |
| 后端 `npm test` | 退出码 0 |
| 前端 `npm run lint`、`npm run typecheck` | 退出码 0 |
| 后端 `npm run check`、`npm run typecheck` | 退出码 0 |
| `node --test test/built-in-now-playing.test.js test/built-in-now-playing.component.test.js test/local-playback-handoff.component.test.js` | 26/26，退出码 0；Audio 替身和实际 React 组件，不是真机音频 |
| `node capacitor-proxy-probe.cjs` | 从安装的上游源码提取 3 个实际方法，Java 框架替身下 44 个断言通过；无外部请求 |
| `npm run build:web` | 退出码 0；已配置公开认证值存在于产物，不输出实际值 |
| `npm run test:android-release`、`npx cap sync android` | 退出码 0 |
| `android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug` | 退出码 0；47 项原生测试 / 15 套 XML，零失败 |
| `verify-candidate.py` | 104 项网页资产与当前 dist 逐字节匹配；53 项既有静态功能标记存在，静态标记不证明业务端到端 |
| `verify-native.cjs` | 版本、签名、SDK 校验通过；ADB 设备数 0 |
| `verify-capacitor-dex.py` | APK 实际 DEX 中 7 项导航/启用/文档请求守卫检查通过，不是真机 WebView 验收 |
| 冻结数据与源码校验 | 12 整文件、17 提示词片段、12 shader 保持；生产数据库与用户数据写入 0 |
| 定向 `git diff --check` | 退出码 0 |

后端剩余 3 个告警来自同一 Mammoth→argparse→sprintf-js 链。上游没有兼容修复，未执行强制降级；虚构 DOCX API 提取测试未加载这条命令行依赖。不等于包本身漏洞消失，详见后端依赖报告。

## APK

[本地候选 APK](E:/chatgpt/artifacts/dengta-quality-round22-20261014/DengTa-2.10.70-118-local-candidate.apk)：2.10.70 / 118，36,401,304 bytes。

SHA-256：`ee331b80e766ac04d6335824fac378d4421cfedf14c78bdbe8c2107092e963b2`。

427 产品输入在构建中保持，记录了 67 个原生 Capacitor 上游输入。minSdk 31 / targetSdk 36；测试签名证书 SHA-256 `38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6`，与 117 相同。未读取新的发布 JKS，未卸载设备上的应用或清空数据。

## 生产与整体目标审查

本机对原生默认服务器 `/health` 的 Node 20 秒、curl 45 秒只读探针均超时，没有取得有效 HTTP 回执。只能证明这两条本机观测未完成，不能认定服务器停服、不能确认生产版本，也不能归因为供应商内容策略。未查询租户或执行模型调用。

| 完整目标要求 | 当前证据与仍缺少的验收 |
| --- | --- |
| 操作逻辑、设置布局与引导 | 累计本地测试及旧轮截图；本轮新增播放器恢复证据，仍需实际账号与多端操作 |
| 轻量视觉、背景太阳/月亮、动画 | 原 shader 与素材保持；本轮无新 CG，不声称专业 CG 或真机 FPS 达标 |
| 错误定位与每项功能可用 | 已有本地组件、协议、数据库替身回归；真实供应商、记忆、所有格式、投屏和第三方播放器未全验收 |
| 趣味改进 | 累计故事章节、音乐片段、涂鸦等源码及测试保留；真实长期互动未全验收 |
| 构建 APK | 本轮已完成安装包及静态核验，已上传测试 Release；真机安装、覆盖升级与运行尚未执行 |
| 后端上线 | 后端推送继续暂缓；本轮无 Render/Vercel/Supabase 变更，生产版本未确认 |
| GitHub / CNB | 公开 main、v2.10.70 与 CNB opensource-main/tag 同为 4b8cadb47cdb8329d47fd3151c8c82af3ceef7ad；原私有前后端未提交/推送本轮改动 |

整体目标仍为 active，不能仅凭本轮测试和 APK 构建标记全部完成。正在等待测试手机连接，以验证播放、投屏和滑动性能；继续本地与网页检查不依赖手机回复。

## 公开发布状态

公开项目：[DengTaHome/dengta-home](https://github.com/DengTaHome/dengta-home)。当前发布源码 `4b8cadb47cdb8329d47fd3151c8c82af3ceef7ad`，仅修改 8 个前端/根文档路径。账号 ID 306767933、公开仓库 ID 1329788840 均重新确认；当前公开源码定向旧名扫描 0 匹配，新提交作者使用 DengTa Home 的新 noreply 地址。历史提交和标签未改写。

[GitHub CI 38506966545](https://github.com/DengTaHome/dengta-home/actions/runs/38506966545)：test (frontend)、test (backend)、public-release-audit 全部 success，headSha 与发布源码相同。公开发布审计及 staged diff 检查退出 0。准备脚本第一次因 trim 移除 porcelain 首行前导空格而将 README 文件名读错，停止在外部发布前；修正私有验证脚本后重新核对完整 8 路径清单和 index backend tree，再提交。没有增加或覆盖其他文件。

[2.10.70 测试发布](https://github.com/DengTaHome/dengta-home/releases/tag/v2.10.70)，Release ID 412315079、APK 资产 ID 639110808；服务器 digest、大小与本地 APK 匹配。发布后重新读取资产 URL，避免把草稿临时下载 URL 当作最终入口。

本轮公开 `backend` tree 始终为 `df7c15dbff3f0d2429e284281237151aee821650`，与 c4558b0 前一公开版逐字节一致。因此公开后端仍有 1 critical + 3 moderate；原工作树验证的 proxy-addr 2.0.8 补丁未混入本次公开提交，不能称后端严重告警已上线修复。后台数据库、用户数据、提示词装配没有写入。公开发行文档准确说明该差别及后端旧 README 的 Node 22 文案与实际 Dockerfile Node 24 基础镜像的差异。

CNB `opensource-main`、`v2.10.70^{}` 与 GitHub 为同一源码 SHA；本轮仅推送公开分支和对应标签，没有推送 backend-main。公开本地 clone 通过 ff-only 同步且工作树干净。Render / Vercel / Supabase 本轮没有变更。

免登录访问公开项目、项目简介、APK 均为 HTTP 200；下载后重新计算大小与 SHA-256，与本地构建及 GitHub digest 完全一致。2.10.69 的 37,035,898 bytes 备份重新核验 SHA-256 后，按精确 Release ID 412171341 撤下该旧 Release 和唯一 APK；对应源码标签与历史提交保留。当前公开仓库只保留 v2.10.70 测试 Release。连同更名整理阶段，累计撤下 47 个旧 Release，45 个旧 APK 已有经过校验的本地备份，不删除用户数据或 Git 历史。

完整证据目录：`E:/chatgpt/artifacts/dengta-quality-round22-20261014`。前后端依赖报告、修前/修后日志、源码哈希、构建回执、资产和 DEX 校验均在此目录。后端推送暂缓、未部署与未验收分别记录，未混为完成；发布与整理回执为 `public-hotfix-release-proof.json`、`public-hotfix-ci-proof.json`、`public-hotfix-download-probes.json`、`superseded-release-cleanup-proof.json`。
