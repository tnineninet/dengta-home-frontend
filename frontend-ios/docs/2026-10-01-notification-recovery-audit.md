# DengTa 2.10.52 / code100：音乐授权监听恢复

## 根因和本轮变更

2.10.51的授权读取和打开设置已有12秒截止，但App.addListener的注册Promise没有截止。原生桥接若不返回，就不能知道是否已经建立监听。另外手动“重新检查”原来只读取授权状态，注册失败后仍不能恢复返回前台时的自动刷新。

src/notification-access-monitor.js:18 的公共截止机制支持迟到成功回执清理；:28 新增ensureListener，最多保留一个有效注册尝试，注册成功复用，失败/超时后重新检查会重试。:23 产生仅本控制器能识别的超时标记，:43 使用固定错误码music_notification_listener_timeout或music_notification_listener_failed；两者不会显示原生私密异常。:48 refresh同时恢复监听并读取权限，:75 stop取消截止、使旧代次和注册回调失效并移除已取得的句柄。注册失败本身不会把已授权状态改成未授权，错误不会擅自结束其他并行操作的opening/checking状态。

已经超时的回调不再触发新的授权读取；注册Promise稍后返回句柄时执行remove。卸载后不更新React；正常刷新不重复注册。不调用removeAllListeners，以免干扰DLNA等独立监听。

test/notification-access.test.js:36 扩充控制器实际运行测试：注册独立截止、超时固定错误码、过期回调、重新检查恢复、健康监听复用、迟到句柄清理、无效句柄和注册拒绝。test/notification-access-hook.test.js:1 是新增的实际React挂载测试：生产useNotificationAccess、生产适配器、生产控制器均执行，只把Capacitor OS插件替换成虚构对象；覆盖StrictMode、前后台回调、撤销授权、重试注册、迟到句柄、卸载及网页不支持时不请求原生。没有把静态源码断言当作实际挂载验收；不等于真机。

package.json/package-lock.json版本2.10.52，新测试接入test:device-activity。android/app/build.gradle:18 为code100/name2.10.52；test/android-release.test.js:75 同步版本断言。use-notification-access.js、App.jsx与原生Java源码本轮没有变更。

## 验证命令及证据

前端main基线a7756a92a9bfec382deafc618f0c7a12076b96c4，后端main基线7bd54da3d6fd1fba3c8ac9532281bf3e1f8e78b1，开始时均干净。后端保持0.29.22，没有源码/SQL/Storage变化，没有Supabase操作，不读取或修改用户数据。提示词、记忆、人格、供应商过滤与模型路由不变；后端现有提示词守卫通过，冻结装配顺序没有改动。本轮是本地生命周期问题修复，不产生新的外部供应商兼容或成人场景结论。

证据目录E:/chatgpt/artifacts/dengta-notification-recovery-20261001，所有测试只用虚构权限和句柄：

| 实际命令 | 结果 |
| --- | --- |
| node test/notification-access.test.js、node test/notification-access-hook.test.js | 定向执行退出0；新增超时码后又由完整npm test覆盖 |
| 前端npm test、npm run lint、npm run typecheck、npm run build:web、npx cap sync android | 均退出0；101个测试文件全部接入脚本；增加具体超时码后重新跑这五项，本次回执见frontend-checks.json，第一次检查另存frontend-initial-checks.json |
| 后端npm test、npm run check、npm run typecheck | 均退出0；129个测试文件均接入脚本，后端源码不变 |
| .\android\gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug | 退出0，testDebugUnitTest为UP-TO-DATE，未宣称重新执行35项原生测试；读取的既有35项/11套件无失败，原生Java未变 |
| extract-apk.py、verify-apk.cjs、secret-check.cjs、verify-native.py | 均退出0，90项APK资源与当前构建一致，新增超时错误码在APK中，私密配置值未发现泄露 |
| apksigner verify --verbose --print-certs、aapt2 dump badging | 退出0；code100/name2.10.52/min31/target36；稳定debug签名，未使用release JKS |
| git diff --check；git diff --cached --check | 提交前需退出0；发布脚本成功时包含该步骤，真实同步回执另列 |

APK大小36,266,113字节，SHA256 6afc9448a234afbae1c2b11ca0a6b0721d8ef9ebc2fd07e27dac4460c1800a3b；签名证书SHA256 38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6。React test-renderer弃用及既有Gradle提示不是测试失败。

最后逐个比对12个保护文件与本轮基线，规范化CRLF；检查后端全部源码和supabase目录无变化。实际GitHub/CNB、Render健康版本、网站入口/Together动态资源哈希、APK上传digest与访问权限列在artifact的final-audit.md/final-state.json。不能以HTTP静态哈希作为整个功能端到端验收。

## 限制与下一步

如果原生平台永远不返回监听句柄，应用无法指定删除未知句柄；本次使该回调失效，拿到迟到句柄再清理，不能声称强制释放平台未知资源。若remove失败，失效回调不会读取权限，但OS资源清理仍受平台影响。12秒为JS活跃执行时的截止，后台计时可能受系统调度影响。真实桥接、OS授权、QQ/网易云控制仍需要Android真机；本轮ADB无设备。先前内置浏览器清单10秒/绑定40秒超时，本轮未重复尝试相同阻塞，没有截图/点击或生产登录账号验收。

Supabase管理面、多账号生产、实际供应商、成人场景、所有功能流畅性和真机仍未完成。此前Vercel管理API403/404本轮未重试，平台READY和构建/运行日志未验收。音频上传仍20MB，1GB分块上传与跨设备播放领取租约尚未实现。整体目标保持active。

回滚可部署前端基线a7756a9并恢复前版APK；无数据库迁移可回滚。不要修改私有仓库可见性或清理用户数据。

依据：[Capacitor App生命周期](https://capacitorjs.com/docs/apis/app)、[React StrictMode效果清理](https://react.dev/reference/react/StrictMode)。
