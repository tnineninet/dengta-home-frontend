# 第二十三轮本地候选验收：2.10.71 / 119

2026-10-14。当前目标仍进行中，后台推送暂缓。前一轮为实际代码修复与构建进展，本轮完成不同于公开旧包的版本递增和包内校验。

## 当前候选

- 包名 home.dengta.app，版本2.10.71，versionCode119，min31/target36，已通过aapt核对。
- 本地文件 E:/chatgpt/artifacts/dengta-quality-round23-20261014/DengTa-2.10.71-119-local-candidate.apk，37,294,220字节。
- SHA256 437bc63721fd8d9f1cc365056ca7447ac3e830729110506167e335e766acbc46。
- apksigner验证退出0，证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6，与此前发布使用的签名一致；实际安装升级仍未真机验收。
- 包内两档图标、apple-touch图标、manifest、sw及journal-coast插画6项SHA与当前public文件相同。

## 本轮文件

package.json:4、package-lock.json:3/9、android/app/build.gradle:18/19同步版本；test/android-release.test.js:75同步119门禁。未改变应用ID、签名或后台接口。

## 累计本地改进

- 简洁聊天气泡图标；日记/记忆海岸插画和日夜文字对比；彩虹状态胶囊展开时保留入口，原彩色流体互动引擎未替换。
- 真实时钟与太阳绘图时间分开；定位日出日落影响轨迹；日落后太阳隐藏。月亮仍为艺术夜间轨迹，并非真实天文月升月落。
- 雨量分级，小雨/普通/强降水使用不同密度，暴雨不自动添加闪电。
- 定位需当前账号明确授权，天气与坐标缓存按账号保存；撤销权限立即清除显示状态；网络天气请求只用粗坐标；新地点请求失败不保留旧地点天气。
- 歌曲导入的MCP设置入口接通，先关闭导入遮罩再导航。

## 验证范围

此前主前端回归58组已分段覆盖：原npm test因旧缓存断言退出1，修复后继续19组全部退出0。此为分段记录，不是声称新版本单次npm test退出0。

各后续改动运行受影响定向测试：太阳/天空、雨量、动画资源生命周期、天气缓存授权隔离、实际React定位组件、MCP导入导航。具体退出码及作用域见同日artifacts专项报告。指定文件eslint通过；之前全量lint/typecheck通过，天气授权版本typecheck通过。

本候选build:web、Android release gate、cap sync、Gradle testDebugUnitTest与assembleDebug各退出0，编译期间429项产品输入和67项Capacitor原生输入未变化。原生单元测试不等于真机功能验收。

冻结核对12个保护整文件、17个提示词片段、12组原shader退出0，git diff --check退出0。用户个性化字段、记忆和数据库未改；原私有工作树既有未提交内容保持，没有整树覆盖。

## 仍需完成的实际验收

| 要求 | 当前证据与缺口 |
|---|---|
| 聊天实时流、重试、心声补充 | 有本地回归；当前生产供应商实际调用未验收 |
| 日记、记忆、导入、MCP/Kiwi | 有本地回归；真实外部记忆接口和生产双账号/RLS未验收 |
| 音乐/一起看/投屏 | 有控制器及原生单元回归；真实媒体App和设备发现未验收 |
| 图标与各页面视觉 | 新生成素材和包内一致性已核对；浏览器截图/点击最终视觉验收未完成 |
| 动画、海浪与灯塔 | 循环程序视频样片已生成但未接入；真机FPS/耗电未测；付费视频因余额不足未提交 |
| 真实天文月升月落、完整反射光影 | 尚未实现及验收，不能用近似夜间轨迹代替完成声明 |
| APK安装与使用 | 候选构建、签名和资源校验完成；真机安装待验收 |
| 后台上线 | 后台推送继续暂缓，当前生产版本及可用性未完整验证 |

## 外部同步状态

GitHub/CNB本轮未推送；Render/Vercel本轮未部署；Supabase未写入。公开v2.10.70仍为上一次正式上传内容，不能等同本地v2.10.71候选。本轮未创建Release或上传新APK。

## 证据目录

E:/chatgpt/artifacts/dengta-quality-round23-20261014：candidate-proof.json、build-source-proof.json、apk71-artwork-proof.json、segmented-regression-proof.json以及每项专项报告。旧报告包哈希是历史快照，以本页和最新candidate-proof.json为准。
