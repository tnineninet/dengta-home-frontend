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

Fresh-context reviewer `wkwebview_transport_feasibility` found one P1 and two P2 in the new test-only host/runner: IIFE top-level await, fallback close counted as cancellation, and failed receipts discarded. Root reproduced/fixed the build error, required premature pre-fallback close, preserved allowlisted failure receipts and disabled inherited Vite prefixes/environment files. Local fixture build and actual native run43286170878 at0745558 passed. Full artifact: `ios-reviews/round-7/goldfish_review_report.md`. This synthetic loopback test cannot establish private-account business acceptance.

## Round 8 — callback intent and asynchronous consent

Fresh-context reviewer `native_callback_intent_review` found three P2: valid foreign-account callbacks silently selecting B (pre-existing Android weakness newly exposed on iOS), blocking native-confirm completion when another controller is presented, and stale deferred approval after retirement. All PROPOSE FIX. Provider validation now precedes explicit async in-page account/purpose approval; no seed/retirement before true. Dialog availability/cancel/timeout/logout/destroy/id/epoch guards fail closed, stable App/drafts remain mounted, active approvals cannot authorize anonymous screenshots. Fifty focused actual-SDK/broker/readiness cases and component script pass; public build/CSP/literal checks pass. Full test rerun/current-source CI tracked separately. Reviewer reread closure; no new findings in narrow scope. PKCE is not claimed. Full artifact: `ios-reviews/round-8/goldfish_review_report.md`.

## Executed evidence and drift

- `test-ios-round5.log`, `npm-test-full-round5.log`, `web-build-round5.log`: local exit 0. Broad tests follow the shared auth changes; emitted config/CSP checks passed. The later memory-path option uses the same tested adapter and is covered by the branch's macOS checks.
- `round5-refresh-reproduction.log`: intentional pre-fix failure, retained as reproduction. `round5-auth-complete.log`: all 57 focused checks passed afterward.
- `browser-auth-audit.json`: five real Windows Chromium 156 cases, actual Web Locks/storage/BroadcastChannel, entirely synthetic provider, zero pageerrors/blocked external requests. It is not iOS/WKWebView evidence.
- [Full native success at ca3f0f7](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43279364936): Xcode/launch/Keychain/three stable readiness samples/PNG/seven keyboard phases passed. [Run 43280829367 at 0431a82](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43280829367) subsequently passed both iPhone 17 and compact iPhone SE 3, each with separate safe-area/readiness/Keychain/PNG/seven phases. The settings install-guard change was verified by the subsequent ffeb441 run below.
- `browser-auth-interleaving.json`: fixed seed `0xD3A6105`, 120 three-tab cycles with concurrent A/B sign-in, sign-out, delayed storage delivery, stale SDK channel messages and tab recreation. Settled request contexts matched persisted identities; zero pageerrors/external requests. Thirty stale-lease and six identity-cancelled competing operations were fenced as expected. Windows Chromium/synthetic provider only.
- [Run 43283653297 at ffeb441](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43283653297) passed the two-device product workflow including the settings guard. Artifact/log ZIPs downloaded, hashed, receipts parsed and both anonymous PNGs inspected.
- [Run43286170878 at0745558](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43286170878) passed dual-device product startup/Keychain/seven phases and the independent real iOS26.5 WKWebView synthetic transport fixture. Native/server receipts share source/nonce, all six booleans pass, three valid POST/zero unexpected requests. Artifact/log ZIPs hashed outside Git. Round8 consent changes came afterward and require a new source CI; actual private account and real email interactions remain open.
- Fresh `final_document_drift` historically read all eleven IOS documents sequentially and corresponding code, rechecked external hashes and found no new P0/P1. Two stale summary/evidence sections were reported in `ios-reviews/drift-initial/2026-11-13_DRIFT_REPORT.md`; repairs passed a sequential reread, saved in `ios-reviews/drift-final/2026-11-13_DRIFT_REPORT.md`.
- Subsequent fresh `final_drift_after_security` read all eleven documents sequentially after transport/consent changes and verified their corresponding current source and downloaded 0745558 hashes/receipts. No P0/P1 overclaim was found, but current approval contracts, latest evidence and audit scope needed synchronization; initial findings are preserved in `ios-reviews/drift-round8-initial/2026-11-13_DRIFT_REPORT.md`. Root classified all as PROPOSE FIX, corrected each summary/contract and kept native approval interaction separate from ordinary CI. A sequential closure reread found no remaining drift at c84f0a7 while its native CI was pending; strict per-document results are in `ios-reviews/drift-round8-final/2026-11-13_DRIFT_REPORT.md`. Later CI facts are appended only from executed receipts.
- Round8 `test-ios-round8.log`, `round8-consent-final.log`, `round8-approval-component-fixed.log` and `web-build-round8-async.log` pass their tested conditions. `npm-test-full-round8.log` completed all 59 scripts through test:style-distill without failure markers; `round8-complete-test-log-check.json` checks completion, with no separately persisted exit code. Current-source native regression [43294494055](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43294494055) at c84f0a7 succeeded: test:ios/build:web/native policy/two-device product startup/Keychain/seven anonymous phases/PNG and independent WKWebView synthetic transport. Both actual PNGs were inspected and hash-matched; XCTest59.697s/50.974s, zero failures. Archive hashes and exact receipts are in the Phase report and downloaded evidence. Ordinary anonymous CI does not exercise the email/approval dialog.
- `browser-native-approval.json` adds four executed Windows Chromium cases with the real AuthGate/dialog and a fictional manager: actual showModal/background inert, cancel focus/Tab/Escape/focus restoration, explicit true, unavailable-dialog rejection, and 320x568 long-email scrolling with each 44px control reachable. App/draft/node stay mounted; zero pageerrors/external requests. The initial harness CJS import timeout and overstrict all-content-visible assertion remain in logs; corrected reachability checks pass without product changes. This is not iOS/email/native-picker evidence.
- The same independent drift reviewer additionally checked only the later external commit-comparison and Chromium dialog additions against their exact JSON/harness receipts and returned no findings. This supplemental check does not claim another source review round or native dialog acceptance.

All local logs/browser harnesses/downloaded CI artifacts remain in `D:/GZdeepseek/_audit/ios-longrun-20261113/`. None of the reviews or anonymous runs establishes real private-account login, companion/SSE/personality/memory/settings or chat-composer acceptance.
