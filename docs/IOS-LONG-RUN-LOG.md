# DengTa iOS long run log

## Run contract

- Start: 2026-11-12T15:56:50Z / 2026-11-12 23:56:50 Asia/Shanghai.
- Minimum engineering window: four hours; maximum: eight hours. Time does not establish acceptance.
- Source: `D:/GZdeepseek/_refs/frontend-gh`, fetched `origin/main` = `f8fa26aed2bdff46505b32a0115952fa3b92c896`.
- Isolated checkout: `D:/GZdeepseek/_worktrees/ios-import-75ad3da`. Original feature checkout remains untouched.
- Target branch: `feat/ios-import-75ad3da` (created after intake, from fetched main).
- Environment B: GitHub Actions macOS, then simulator build, install, launch and evidence.
- Required scope A: login, POST SSE chat, personalization, memories and settings. Voice and foreground notifications are assessment only.
- No production/backend/database changes, main push, merge, device signing or distribution.
- The user's autonomous-run authorization supersedes earlier phase approval gates and skill interaction gates for ordinary fixes. Review findings and decisions remain recorded.
- EGM skills: local `egm_review`, `egm_review_loop`, `egm_resolve`, `egm_drift_report`; reviewers use fresh contexts and read-only tools. Root alone changes implementation.

## Intake checkpoint

- Reused the already verified fixed-commit handoff download rather than downloading it again.
- Rechecked ZIP and raw SHA-256; extracted 1,507 files / 46,701,058 bytes only under the existing external isolation directory after validating every destination path.
- Fetched frontend main. Working tree still equals production main's file tree; local `main` is older and will not be used as the branch base.
- Desktop managed-worktree request did not return and no new worktree appeared; canceled the pending request and created an isolated native Git worktree at the fetched main instead.
- GitHub API confirmed repository write/workflow permission and Actions enabled. No token values were printed or persisted.
- External candidate review is in progress. Early exclusions: old business files, fabricated simulator signing identity, whole-file AuthGate/auth-session/main/viewport replacement.
- Existing external simulator failure is historical evidence, not a new run result.
- Next: finish module decisions, write the import plan, then create the target branch and apply small reviewed modules.

## Evidence locations

- External audit: `D:/GZdeepseek/_audit/ios-stage0-external-20261112-153403955/`.
- Extracted candidate: `unpacked/dengta-home-75ad3daa42689bdb48ba46e47b61c494e03d20d7/` under that audit directory.
- Command/test/CI evidence for this run will be stored outside the repository; final documents will point to exact paths and run URLs.

## Checkpoint 1 — 2026-11-12T16:42:08Z (45 minutes)

- Stages 0/1 completed; stage 2 in progress. Generated a real Capacitor iOS SPM host using CLI 8.4.3 on Windows. This is project generation, not native compilation.
- Round 1 used three independent fresh-context Goldfish reviewers. Accepted the plan gaps and recorded contracts/resolutions in `IOS-REVIEW-EVIDENCE.md`.
- Selectively imported credential Keychain, revocable storage lease, native plugin/store and reviewed fixtures. Preserved the current 2.13.43 business code and auth error/deadline/connectivity behavior.
- Added lifecycle fences, pending resolver ownership, verified cleanup/retry, request-bound 401 invalidation and companion response ownership. Added exact callback parsing and native platform scoping. Existing viewport scroll guard remains in place with shared ownership.
- Executed evidence: 53 auth/storage/refresh/401 checks passed; 12 new lifecycle race checks passed. AuthGate components and the explicit auth-timeout/viewport regressions passed after adapting fixture semantics to the new lease. Initial failures remain in outside-Git logs rather than being hidden.
- CI workflow/smoke scripts now exist but are unexecuted. Native policy test and actual Simulator Keychain/launch remain pending. No authenticated account checks or production writes have occurred.
- Capability audit identified camera/mic/foreground location purpose strings for existing exposed controls; added truthful strings without background/APNs entitlements. iOS notification startup now checks permission without auto-prompting; user action remains explicit. Native Android-only NetEase playback is guarded.
- Primary runner inventories were fetched HTTP 200; `macos-26` lists Xcode 26.6 at the planned path. GitHub action release tags and immutable commit refs were checked live. The web search service returned HTTP 500, so primary-source HTTP reads were used for these verifications.
- Next: finish meaningful regression fixtures, run `build:web`/sync, commit and push the feature branch, create draft PR, inspect actual CI failures, then fresh code/security review rounds and drift resolution.

## Checkpoint 2 — 2026-11-12T17:27:11Z (90 minutes)

- Stages 2/3 executed; stage 4 and round-2 resolution in progress. Feature branch pushed and draft PR opened: https://github.com/DengTaHome/dengta-home-frontend/pull/2 (attached to this chat; no merge).
- First workflow failed before jobs due unsupported runner context in job env; fixed paths through GITHUB_ENV. The corrected run 43264739171 at `11b08ce142103d02d1879a3eb7835df04b8209bd` completed successfully: test:ios, build:web, cap sync, native policy fixtures, Xcode26.6/SDK26.5 Simulator build, install/launch/liveness, real Keychain and anonymous screenshot. No manual re-sign or fabricated Team/access group.
- Downloaded artifact ZIP 928,554 bytes, SHA-256 `1203F47D0B15F302A2C361C6D6094818EA42132D8260AAC957433CF001B46239`; logs ZIP SHA-256 `75F0EB6ACF30433E394A1E6A82368A8E7D2017F587161D6EFF7849DA5C2AE9C4`. Stored only in `D:/GZdeepseek/_audit/ios-longrun-20261113/ci-43264739171/`. Inspected actual login-form PNG. Probe add/read/delete returned 0, roundtrip true, deleted read -25300. Historical external -34018/launch failure did not recur in this source SHA.
- Two real fresh-context round-2 reviewers delivered 5 P1 and 2 P2 findings. Accepted all: internal identity queue rotation, facade context drops, destructive restoration timeout, auth scrollport, invisible-control readiness, retained/revived SDK resources and optional screenshot acceptance. Reproduced races before fixes. Actual GoTrue fixture proves immediate and settlement disposal; seven facade/identity cases and blocked cleanup cancellations pass.
- Added bounded native auth scrolling, actual bundled readiness tests (clipping/occlusion/prelude), three advancing samples, required new PNG/hash, and one genuine XCUITest target for seven anonymous login/register/forgot keyboard stages. New native/XCUITest source has not yet run; cannot use the preceding CI as proof of these changes.
- `npm run test:ios` and `npm run build:web` passed after round-2 changes (logs `ios-regressions-round2.log`, `web-build-round2.log`). Full npm test advanced through nursery after a stale-SDK fixture repair, then found the stylesheet-inventory assertion missing ios.css; corrected inventory and targeted mobile-layout tests passed. Full-suite final rerun remains pending.
- 17:24Z read-only unauthenticated transport probes: OPTIONS chat/stream=204 allowing capacitor origin/POST/headers, GET health=200 with matching origin/HSTS. No POST/business write. Evidence `transport-cors-20261112-1724.json`; actual authenticated WKWebView SSE remains unverified.
- Full annotated round artifacts now exist under docs/ios-reviews. Credentials remain local; no private password sent to CI. Original frontend checkout/backend/production untouched.
- Next: push round-2 fixes, inspect fresh CI/XCUITest failures and fix from actual logs; run fresh-context round 3 and drift audit; finish full-suite verification and honest business/keyboard acceptance boundaries. Minimum four-hour window ends at 19:56:50Z; this checkpoint is not completion.
