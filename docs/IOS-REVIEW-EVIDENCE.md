# DengTa iOS review evidence

## Protocol

Real fresh-context read-only subagents perform Goldfish review; root alone resolves and writes. Local EGM review, review-loop, resolve and drift-report skills are used. The user's long-run request explicitly authorizes applying ordinary fixes without the skills' interactive gates. Reviews establish findings, not executed build/runtime success.

## Round 1 — selective import plan

Target: `docs/IOS-IMPORT-PLAN.md` (original 63 lines). Reviewers: `goldfish_r1_readiness`, `goldfish_r1_design`, `goldfish_r1_codebase`, all spawned with `fork_turns=none`. No code execution or credential access.

| Finding | Severity | Resolution | Evidence/verification |
|---|---|---|---|
| Cleanup retry API/UI and failed lease retention unspecified | P1 | PROPOSE FIX; define retained barrier, rejecting exit and explicit retry | Lifetime contract added; implementation/tests pending |
| CI toolchain, scripts, timeouts and receipt contract unspecified | P1 | PROPOSE FIX; explicit runner/Xcode/env/event/smoke contract | CI contract added; run pending |
| Rollback can restore plaintext/stale account credentials | P1 | PROPOSE FIX; retain secure boundary; require corrective build | Rollback paragraph amended |
| Business acceptance table missing | P1 | PROPOSE FIX; separate runtime/business rows | Report contract added; report pending |
| Late/duplicate 401 can invalidate current session | P1 | PROPOSE FIX; request identity and one invalidation point | Lifetime contract added; implementation/tests pending |
| Native HTTPS redirect override conflicts with callback | P1 | PROPOSE FIX; iOS platform-specific precedence | Callback/redirect contract added; tests pending |
| Callback destination grammar unspecified | P1 | PROPOSE FIX; exact parser before initialization | Callback grammar added; tests pending |
| iOS inherits Android marker/touch recovery | P1 | PROPOSE FIX; explicit Android platform guards | Platform files added to plan; tests pending |
| CI API URL missing; would fall back to localhost | P1 | PROPOSE FIX; explicit existing production API endpoint | Exact CI env contract added; bundle check pending |
| Workflow event/ref/secret behavior ambiguous | P1 | PROPOSE FIX; trusted same-repository event policy and config failure | CI contract added; fixture checks pending |
| Timeout/401 regression files omitted and storage seam unspecified | P1 | PROPOSE FIX; exact commands and injected resolver | Lifetime contract added; tests pending |

All findings accepted as plan gaps; no severity was silently reduced. Round 1 plan resolution is complete; corresponding implementation evidence remains open until executed.

Full annotated artifact: `ios-reviews/round-1/goldfish_review_report.md`.

## Round 2 — authentication, native host and CI

Fresh read-only reviewers `goldfish_r2_auth` and `goldfish_r2_native` delivered 5 P1 and 2 P2 findings. Root reproduced the auth races, applied all fixes and added meaningful API/facade, actual GoTrue disposal, real bundled-readiness and screenshot-evidence tests. Deferred authentication checks pass; native/XCUITest execution of the new source is pending. No contested/escalated/declined items.

Full findings, rationale, exact repair and executed evidence: `ios-reviews/round-2/goldfish_review_report.md`. First actual CI success at `11b08ce` precedes these fixes; it is not used as proof that the new readiness/keyboard changes passed.
