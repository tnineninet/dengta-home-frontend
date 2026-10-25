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
   git push cnb main:frontend-main
   ```
3. Vercel Git 集成自动部署前端；Render `autoDeploy` 自动部署后端。
4. 检查：
   ```powershell
   node scripts/deployment-health.mjs
   node scripts/deployment-status.mjs   # 需要 GITHUB_TOKEN/GITHUB_REPOSITORY
   ```
5. APK 发布走显式 workflow：
   - GitHub Actions → `Publish Android APK`
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
git revert <bad-commit> --no-edit
git push origin main
```

Render `autoDeploy` 会部署 revert；检查 `/health` 的 revision。

## Vercel 历史存储清理

需要一次性 `VERCEL_TOKEN`：

- GitHub Actions：`Vercel deployment storage cleanup` → Run workflow
  - 默认 dry-run
  - `apply=true` 才删除旧部署
  - 默认保留最新 10 个
- 或本地：
  ```powershell
  $env:VERCEL_TOKEN="..."
  node scripts/vercel-cleanup.mjs          # dry-run
  $env:APPLY="1"; $env:KEEP="10"; node scripts/vercel-cleanup.mjs
  ```

## 定时健康检查

- 前端：`.github/workflows/deployment-health.yml`
  - 每 30 分钟检查 feed/APK/后端 health
  - 校验 GitHub Production deployment 最新状态为 success
- 后端：`dengta-home-backend/.github/workflows/deployment-health.yml`
  - 每 30 分钟检查 Render `/health` revision

## 注意

- 不再把 APK 写入 Vercel 部署；否则每次部署增加 41MB。
- `public/updates/android.json` 的 `apk_url` 指向 Supabase。
- Vercel 旧 13.63GB 历史记录不会自动消失；只有加 `VERCEL_TOKEN` 后才能清理。
