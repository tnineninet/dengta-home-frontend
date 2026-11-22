# DengTa home frontend

DengTa home 的 React + Vite 前端，包含聊天、会话、朋友圈、Supabase 对话摘要、Ombre 记忆浏览和 PWA 安装支持。

## 手机网页版

正式入口：[https://www.dengtahome.com/](https://www.dengtahome.com/)。旧的 `https://dengta-home.vercel.app/` 仅作为兼容入口保留；部分网络会污染或阻断 `vercel.app`，请优先使用正式域名。

兼容镜像：[https://dengta-home-backend-rkmq.onrender.com/web/](https://dengta-home-backend-rkmq.onrender.com/web/)（仅在正式入口暂时不可达时使用）。

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

- `npm run build` 只执行 `vite build`，产出 `dist/`。
- `npm run build:web` 额外执行 `verify:public-auth-build`，校验公开认证配置已打进产物（CI 用这个）。

公开认证（Supabase 登录）依赖两个**公开**变量，必须在构建时注入：

| 变量 | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目地址 |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable/anon key（**不是** service role 密钥） |

注入方式：本地写进 `.env.local`（已 gitignore），CI/生产由构建平台 secrets 注入；模板见 `.env.example`。
缺失时：`AuthGate` 显示“登录服务尚未接通”页，且 `npm run build:web` 会因 `verify:public-auth-build` 报错 `Missing required public auth environment variables: ...`。

聊天接口统一在“多供应商 API 控制台”中配置。每个账号自行保存活动接口、
API 地址、密钥和默认模型；部署环境不会替账号锁定供应商或地址。
OpenAI Responses 会把 `xhigh` 作为 `reasoning.effort` 发送；保留函数工具的
Chat 兼容接口只允许 `none`。

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
