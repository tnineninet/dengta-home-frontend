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
