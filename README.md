# DengTa home frontend

DengTa home 的 React + Vite 前端，包含聊天、会话、朋友圈、Supabase 对话摘要、Ombre 记忆浏览和 PWA 安装支持。

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

Android 原生壳使用 Capacitor，应用编号为 `home.dengta.app`，最低支持 Android 7。

同步网页资源：

```cmd
npm run build
npm run android:sync
```

`.github/workflows/android-apk.yml` 会在 GitHub Actions 中构建调试版 APK，并上传名为 `DengTa-home-android-debug` 的构建产物。调试版仅用于个人手机测试；正式发布前需要单独配置发布签名。

## 密钥

API Key、Ombre Token、Dashboard 密码和 Supabase Secret 都不得写入本仓库。它们只保存在相应后端部署平台的环境变量中。
