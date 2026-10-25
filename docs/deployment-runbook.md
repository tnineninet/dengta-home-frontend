# DengTa 部署与回滚 Runbook

## 生产地址

- 前端：`https://www.dengtahome.com`
- 前端 feed：`https://www.dengtahome.com/updates/android.json`
- 后端：`https://dengta-home-backend-rkmq.onrender.com`
- 后端健康：`https://dengta-home-backend-rkmq.onrender.com/health`

## 正常发布

1. 本地检查：
   ```powershell
   cd E:\chatgpt\dengta-home-frontend
   npm test
   npm run lint
   npm run build
   ```
2. 提交并推送：
   ```powershell
   git push origin main
   ```
   CNB 镜像由 GitHub Actions 的 `sync-cnb.yml` 自动同步，不再需要手动 push。
3. Vercel Git 集成自动部署前端；Render `autoDeploy` 自动部署后端。
4. GitHub Actions 会自动：
   - 等待并验证本次 commit 的 Vercel/Render production revision
   - 清理旧 Vercel deployment，保留最新 10 个
   - 校验 feed / APK / 后端 health
5. 人工检查：
   ```powershell
   node scripts/deployment-health.mjs
   node scripts/deployment-status.mjs   # 需要 GITHUB_TOKEN/GITHUB_REPOSITORY
   ```
6. APK 发布走显式 workflow 或 `android-v*` tag：
   - GitHub Actions → `Publish Android APK`
   - 或推送经确认的 `android-v*` 标签
   - APK 上传 Supabase `dengta-updates/apk/DengTa-latest.apk`
   - 只提交 `public/updates/*.json`，不提交 41MB APK

## 回滚

### 前端

```powershell
cd E:\chatgpt\dengta-home-frontend
node scripts/rollback-frontend.mjs <bad-commit>          # dry-run
node scripts/rollback-frontend.mjs <bad-commit> --apply  # 生成 revert 提交
npm test; npm run build
git push origin main
```

推送后 Vercel 自动部署 revert 结果；用 `node scripts/deployment-health.mjs` 验证。实测：临时 heartbeat 文件部署后 200，revert 后 404，feed 不受影响。

### 后端

```powershell
cd E:\chatgpt\dengta-home-backend
node scripts/rollback-backend.mjs <bad-commit>          # dry-run
node scripts/rollback-backend.mjs <bad-commit> --apply  # 生成 revert 提交
npm test; npm run check
git push origin main
```

Render `autoDeploy` 会部署 revert；`verify-production.yml` 会等到 `/health` revision 等于 revert commit。

## Vercel 历史存储清理

已配置自动清理：

- `.github/workflows/vercel-storage-cleanup.yml`
  - 每周一 03:17 UTC
  - 也可手动触发
  - 保留最新 10 个 deployment
- `verify-production.yml` 每次部署验证成功后也会自动清理，保留最新 10 个

本地手动清理（可选）：

```powershell
$env:VERCEL_TOKEN="..."
$env:VERCEL_PROJECT_ID="prj_P6wMEPflv6ZGrwz9Aef92RWSCAqP"
$env:VERCEL_TEAM_ID="team_yr64LG4a6KOkuZ6WFpHqb7KA"
node scripts/vercel-cleanup.mjs
$env:APPLY="1"; $env:KEEP="10"; node scripts/vercel-cleanup.mjs
```

## 定时健康检查

- 前端/后端都配置了 `deployment-health.yml` 和每次 push 的 `verify-production.yml`
- GitHub schedule 历史上有成功运行：
  - 前端 `Production deployment health`：2026-10-25T17:52:43Z success
  - 后端 `Production backend health`：2026-10-25T17:53:26Z success
- 近期 schedule 触发存在延迟，**仍以每次 push 的 verify-production 和本地监控为主**
- 本地 8 小时监控作为兜底：
  `E:\chatgpt\artifacts\dengta-goal-monitor-20261026.log`

## 注意

- 不再把 APK 写入 Vercel 部署；否则每次部署增加 41MB。
- `public/updates/android.json` 的 `apk_url` 指向 Supabase。
- Vercel 旧部署已从 369 清理到 10，后续由自动清理维持。
- CNB 分支/tags 自动同步，不再需要手动 push。
