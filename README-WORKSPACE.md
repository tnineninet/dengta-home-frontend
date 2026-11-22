# DengTa Workspace Snapshot 2026-11-22

This branch/repo is a **source snapshot** of the local DengTa workspace, created because the
Google account used for some platforms was banned. It is intentionally a flat, reviewable
snapshot, not a replacement for the Git repositories.

## Layout
- `frontend/` — production React/Vite/Capacitor frontend (Android source included; no build output)
- `frontend-ios/` — the iOS import worktree, including the native `ios/` project and uncommitted changes
- `backend/` — Express backend source
- `docs/` — latest project documentation, including iOS and account-migration handovers
- `tools/` — operational scripts (repo watch, bridge helpers)

## Excluded
`node_modules`, build output, Pods, DerivedData, `_audit`, screenshots/logs, `.env*`,
credentials, certificates, keystores, provisioning profiles, APK/IPA/archives.

## Source of truth
- GitHub: https://github.com/DengTaHome/dengta-home-frontend
- GitHub: https://github.com/DengTaHome/dengta-home-backend
- GitHub: https://github.com/DengTaHome/dengta-home
- CNB mirror: https://cnb.cool/dengtahome/dengtahome

## Rule
Every future update must be synchronized to CNB after tests. See `docs/SYNC-POLICY.md`.
