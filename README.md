# DengTa home frontend

DengTa home 的 React + Vite 前端，包含聊天、会话、朋友圈、Supabase 对话摘要、Ombre 记忆浏览和 PWA 安装支持。

## 手机网页版

公开入口：[https://dengta-home.vercel.app/](https://dengta-home.vercel.app/)

- iPhone / iPad：用 Safari 打开入口，点“分享”→“添加到主屏幕”，然后从新图标打开并登录。
- Android：用 Chrome 打开入口，点浏览器菜单里的“安装应用”或“添加到主屏幕”。
- 电脑：直接在浏览器使用，支持时也可从地址栏或设置页安装。

网页版与 Android App 使用同一套账号、聊天和服务器数据，但需要联网。锁屏主动通知、后台活动感知和屏幕共看等依赖 Android 原生能力的功能，暂时只在 Android 安装版中提供；网页会显示明确的不可用提示，不会阻塞聊天、记忆和设置等通用功能。

## 本地运行

只使用 CMD：

```cmd
npm install
npm run dev
```

默认本地后端地址为 `http://localhost:3000`。生产构建使用 `.env.production` 中的线上后端地址。

## 检查

```cmd
npm run lint
npm run build
```

旧版单接口设置现在也提供 OpenAI Responses 与推理强度选择。Responses 会把
`xhigh` 作为 `reasoning.effort` 发送；保留函数工具的 Chat 兼容接口只允许
`none`。多供应商控制台和旧版设置页共用同一套校验规则。

## Android

Android 原生壳使用 Capacitor，应用编号为 `home.dengta.app`，最低支持 Android 12（API 31）。

同步网页资源：

```cmd
npm run build
npm run android:sync
```

`.github/workflows/android-apk.yml` 会在 GitHub Actions 中构建调试版 APK，并上传名为 `DengTa-home-android-debug` 的构建产物。调试版仅用于个人手机测试；正式发布前需要单独配置发布签名。

## 密钥

API Key、Ombre Token、Dashboard 密码和 Supabase Secret 都不得写入本仓库。它们只保存在相应后端部署平台的环境变量中。
