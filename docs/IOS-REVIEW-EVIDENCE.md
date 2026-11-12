# DengTa iOS review evidence

## Protocol

Real fresh-context read-only subagents perform Goldfish review; root alone resolves and writes. Local EGM review, review-loop, resolve and drift-report skills are used. The user's long-run request explicitly authorizes applying ordinary fixes without the skills' interactive gates. Reviews establish findings, not executed build/runtime success.

## Round 1 — selective import plan

Target: `docs/IOS-IMPORT-PLAN.md` (original 63 lines). Reviewers: `goldfish_r1_readiness`, `goldfish_r1_design`, `goldfish_r1_codebase`, all spawned with `fork_turns=none`. No code execution or credential access.

| Finding | Severity | Resolution | Evidence/verification |
|---|---|---|---|
| Cleanup retry API/UI and failed lease retention unspecified | P1 | PROPOSE FIX; define retained barrier, rejecting exit and explicit retry | Manager/AuthGate retry and failed-clear fixtures passed |
| CI toolchain, scripts, timeouts and receipt contract unspecified | P1 | PROPOSE FIX; explicit runner/Xcode/env/event/smoke contract | Actual toolchain/receipts/full run 43279364936 passed |
| Rollback can restore plaintext/stale account credentials | P1 | PROPOSE FIX; retain secure boundary; require corrective build | Rollback paragraph amended |
| Business acceptance table missing | P1 | PROPOSE FIX; separate runtime/business rows | Phase report separates executed anonymous native and unverified business |
| Late/duplicate 401 can invalidate current session | P1 | PROPOSE FIX; request identity and one invalidation point | Actual manager/API/facade race fixtures passed |
| Native HTTPS redirect override conflicts with callback | P1 | PROPOSE FIX; iOS platform-specific precedence | Redirect/override behavior tests passed |
| Callback destination grammar unspecified | P1 | PROPOSE FIX; exact parser before initialization | Direct invalid destination/duplicate/field tests passed |
| iOS inherits Android marker/touch recovery | P1 | PROPOSE FIX; explicit Android platform guards | Platform tests and anonymous native readiness passed |
| CI API URL missing; would fall back to localhost | P1 | PROPOSE FIX; explicit existing production API endpoint | CI env plus emitted literal verification passed; actual transport distinct |
| Workflow event/ref/secret behavior ambiguous | P1 | PROPOSE FIX; trusted same-repository event policy and config failure | Restricted workflow and actual same-repo PR source SHA checked |
| Timeout/401 regression files omitted and storage seam unspecified | P1 | PROPOSE FIX; exact commands and injected resolver | Targeted timeout/scope tests and test:ios passed |

All findings accepted as plan gaps; no severity was silently reduced. Corresponding implementation/evidence now exists, with private-account acceptance explicitly open rather than inferred.

Full annotated artifact: `ios-reviews/round-1/goldfish_review_report.md`.

## Round 2 — authentication, native host and CI

Fresh read-only reviewers `goldfish_r2_auth` and `goldfish_r2_native` delivered 5 P1 and 2 P2 findings. Root reproduced the auth races and added meaningful API/facade, actual GoTrue disposal, bundled-readiness and screenshot tests. At f8b8f51, the real seven-phase XCUITest passed but overall CI failed on our overstrict keyboard-bottom parser. Full run 43279364936 at ca3f0f7 subsequently passed the repaired parser, measured safe-area forwarding, native readiness, required PNG and all seven phases. No contested/escalated/declined items.

Full artifact: `ios-reviews/round-2/goldfish_review_report.md`. First actual CI success at 11b08ce precedes the round-2 changes and is not used to prove them.

## Round 3 — Web exit, callback safety and drift

Fresh read-only reviewers `goldfish_r3_auth`, `goldfish_r3_native`, `goldfish_r3_drift`: 1 P1, 4 P2, 2 Nits. All PROPOSE FIX. Root added independent Web lifetime fanout/fencing, isolated callback validation, shared safe rectangles, emitted-literal assertions and corrected platform/history wording. Native forwarding passed ca3f0f7; actual SDK and real-browser compatibility checks are separate evidence. Full artifact: `ios-reviews/round-3/goldfish_review_report.md`.

## Round 4 — adversarial identity/evidence refinements

Fresh read-only reviewers `goldfish_r4_auth`, `round4_native_policy`: 2 P1 and 3 P2. All PROPOSE FIX. Persisted-session matching rejects delayed identity/null broadcasts; identity-changing writes fence older peers; SDK auth-key removal fences autonomous loss; callback seed reservation wins subscriber races; capture candidates preserve existing evidence on retry failure. MacroExpansion uncertainty was verified by actual ca3f0f7 native execution. Full artifact: `ios-reviews/round-4/goldfish_review_report.md`.

## Round 5 — installed SDK race semantics

Fresh read-only reviewer `round5_web_protocol`: 1 P1, 2 P2. All PROPOSE FIX. An anonymous replacement is required before a new identity; inherited SDK retryable errors resolve refresh waiters; SDK-only retired reads return absence, including seeded memory storage, while active provider errors remain visible. Root reproduced the orphaned rejection before fixing it. Actual SDK gated write and detached initial-read schedules pass, as do rejected-seed/partial-write/cancellation cases. Reviewer re-read the repairs and reported no unresolved P0/P1 among the findings. Full artifact: `ios-reviews/round-5/goldfish_review_report.md`.

## Round 6 — logged-in capability/transport source paths

Fresh read-only reviewers `ios_loggedin_capabilities` and `ios_core_transport_review` found one P3 misleading PWA installation control in native settings. Root included it in the iOS installation guard; Web/Android behavior stays. Relevant PWA/update/platform checks passed. No introduced core P1/P2 bridge, SSE or composer blocker was confirmed. Existing optional voice/creative context omissions are recorded as follow-up, not silently counted as fixed. Full artifact: `ios-reviews/round-6/goldfish_review_report.md`.

## Round 7 — disposable WKWebView transport fixture

Fresh-context reviewer `wkwebview_transport_feasibility` found one P1 and two P2 in the new test-only host/runner: IIFE top-level await, fallback close counted as cancellation, and failed receipts discarded. Root reproduced/fixed the build error, required premature pre-fallback close, preserved allowlisted failure receipts and disabled inherited Vite prefixes/environment files. Isolated local fixture build passed; actual native execution is pending. Full artifact: `ios-reviews/round-7/goldfish_review_report.md`. This synthetic loopback test cannot establish private-account business acceptance.

## Executed evidence and drift

- `test-ios-round5.log`, `npm-test-full-round5.log`, `web-build-round5.log`: local exit 0. Broad tests follow the shared auth changes; emitted config/CSP checks passed. The later memory-path option uses the same tested adapter and is covered by the branch's macOS checks.
- `round5-refresh-reproduction.log`: intentional pre-fix failure, retained as reproduction. `round5-auth-complete.log`: all 57 focused checks passed afterward.
- `browser-auth-audit.json`: five real Windows Chromium 156 cases, actual Web Locks/storage/BroadcastChannel, entirely synthetic provider, zero pageerrors/blocked external requests. It is not iOS/WKWebView evidence.
- [Full native success at ca3f0f7](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43279364936): Xcode/launch/Keychain/three stable readiness samples/PNG/seven keyboard phases passed. [Run 43280829367 at 0431a82](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43280829367) subsequently passed both iPhone 17 and compact iPhone SE 3, each with separate safe-area/readiness/Keychain/PNG/seven phases. The later settings install-guard change still needs its new source CI.
- [Run 43283653297 at ffeb441](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43283653297) passed the two-device product workflow including the settings guard. Artifact/log ZIPs downloaded, hashed, receipts parsed and both anonymous PNGs inspected. The separate WKWebView fixture is a subsequent source change, pending native CI.
- Fresh `final_document_drift` read all eleven IOS documents sequentially and corresponding code, rechecked external hashes and found no new P0/P1. Two stale summary/evidence sections were reported in `ios-reviews/drift-initial/2026-11-13_DRIFT_REPORT.md`; repairs passed a sequential reread, saved in `ios-reviews/drift-final/2026-11-13_DRIFT_REPORT.md`. New transport/evidence documentation will be checked again once CI settles.

All local logs/browser harnesses/downloaded CI artifacts remain in `D:/GZdeepseek/_audit/ios-longrun-20261113/`. None of the reviews or anonymous runs establishes real private-account login, companion/SSE/personality/memory/settings or chat-composer acceptance.
