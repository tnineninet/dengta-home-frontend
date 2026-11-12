# Goldfish Annotated Review Report

Status: fixes verified by actual run 43279364936 at ca3f0f7; authenticated business acceptance remains unverified.

**Target:** `docs/IOS-IMPORT-PLAN.md` and implementation (full files).

Real fresh-context read-only reviewers: `goldfish_r2_auth` (codebase details), `goldfish_r2_native` (implementation readiness). They read the specified EGM standards/personas, plan, source and related tests. No reviewer changed files or accessed credentials. Root alone resolved findings. User authorization permits applying ordinary fixes without an intermediate skill approval gate.

## Prioritized Findings & AI Suggestions

### R2-01 — Internal identity replacement breaks serialization [codebase details] — P1

- **Affected Scope:** `src/auth-session.js`, retireCurrent/freshIdentityRecord/serializeIdentity.
- **Discrepancy Description:** Internal retirement reset identityQueue. A callback held in setSession and subsequent password login could run concurrently on the replacement lease; the late callback remained current and could overwrite the login.
- **Rationale:** A stale identity operation could publish/persist a different account after the user selected another account.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Separate identity cancellation epoch from SDK lifecycle. Preserve the queue across internal rotation; reset only on explicit cancellation/exit. Check the epoch across each freshIdentityRecord barrier. Also reject ensureClient waiters whose lifecycle changed while awaiting cleanup, and cancel a rotation even if explicit logout arrives during its cleanup.
- **Verification:** Deferred callback-versus-password, logout-during-rotation and stale-cleanup-waiter tests in `ios-auth-lifetime.test.js`; passed in `round2-auth-final.log`.

### R2-02 — Request facades discard originating context [codebase details] — P1

- **Affected Scope:** `src/settings-save-scope.js`, `src/co-watch-request-scope.js`, `src/import-request-scope.js`.
- **Discrepancy Description:** Settings/co-watch invalidation forwarded only message; all three companion-capture facades dropped context. Account/companion IDs alone cannot distinguish old and refreshed tokens.
- **Rationale:** A delayed a1 401 after a2 refresh could clear a2, or stale headers could select the wrong companion.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Forward response/message and context unchanged through every facade.
- **Verification:** Six real API/manager/facade race fixtures cover late 401 and companion headers after same-account token refresh. Reproduced failures in `round2-auth-reproduction.log`; fixes pass in `round2-auth-final.log`.

### R2-03 — Restoration timeout erases durable login [codebase details] — P1

- **Affected Scope:** `src/auth-session.js`, initialization timeout and retirement barrier.
- **Discrepancy Description:** Initialization auth_timeout called destructive retirement on every platform, contradicting offline/reconnect behavior and the loading screen's preservation promise.
- **Rationale:** Slow/offline restoration became a logout and discarded the saved session.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Seal/drain the timed-out lease without deletion; fence SDK events/results. Explicit exit/invalidation upgrades a pending preserve-only retirement to verified clear.
- **Verification:** Seeded credentials survive timeout and restore on retry; late SDK writes/events fail; signOut during blocked timeout drain waits and removes all auth keys. Real SDK disposal fixture also passes. Logs: `round2-auth-reproduction.log`, `round2-real-sdk-disposal.log`, `round2-auth-final.log`.

### R2-04 — Native auth content lacks a bounded scrollport [implementation readiness] — P1

- **Affected Scope:** `src/ios.css`, shared fixed/clipped document and mobile auth-panel layout.
- **Discrepancy Description:** min-height plus overflow:auto did not constrain auth-page height. Tall content could extend past the clipped root. align-items changed a display:block element and could not repair keyboard states.
- **Rationale:** Login/register/recovery controls might be unreachable on small/keyboard-reduced viewports.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Bound native auth height to --app-height, remove minimum expansion and reduce the decorative mobile offset; preserve actual internal scrolling. Add a genuine anonymous XCUITest for tapping/typing/scrolling seven login/register/forgot phases. Assert complete native frames above the keyboard and within the safe frame.
- **Verification:** Actual XCUITest passed all seven phases at f8b8f51, although the overall run failed on our overstrict keyboard-bottom parser. Full run 43279364936 at ca3f0f7 passed with repaired parser and measured safe-area forwarding. This proves the tested anonymous forms on iPhone 17; no chat composer or private-account inference.

### R2-05 — Readiness accepts invisible/covered controls [implementation readiness] — P1

- **Affected Scope:** `DengTaBridgeViewController.swift`, bundled `DengTaReadiness.js`, `ios-simulator-smoke.mjs`.
- **Discrepancy Description:** Positive box dimensions passed for offscreen/clipped/hidden/covered controls and startup prelude. Smoke accepted the first positive sample.
- **Rationale:** A splash or clipped form could be accepted as a ready login page.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Evaluate computed/ancestor visibility, visual viewport and clipping, five hit-test points and explicit prelude absence. Require three advancing nonce-bound samples. Share the actual bundled reader with executable fixtures.
- **Verification:** Eight fixtures against the actual resource reject offscreen/clipped/hidden/transparent/disabled/covered/prelude controls. Passed `round2-evidence-fixes.log`; actual tightened native readiness and stable sampling passed at f8b8f51 and ca3f0f7. The latter full run succeeded.

### R2-06 — Retired SDK resources can revive [codebase details] — P2

- **Affected Scope:** `src/auth-session.js`, installed GoTrueClient lifecycle.
- **Discrepancy Description:** stopAutoRefresh alone leaves BroadcastChannel, and late initialization finally can reinstall visibility/refresh work after retirement.
- **Rationale:** Repeated client replacement accumulates resources and old background work.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Track real SDK initialize; dispose immediately and again after it settles. Keep the storage lease sealed independently of SDK disposal.
- **Verification:** Actual installed GoTrueClient with deferred storage and no-network fetch proves immediate channel close, late finally execution, then zero listeners/null channel/null timers and zero fetches. Passed `round2-real-sdk-disposal.log`.

### R2-07 — Screenshot failure still passes startup [implementation readiness] — P2

- **Affected Scope:** `scripts/ios-simulator-smoke.mjs`, `ios-screenshot-evidence.mjs`.
- **Discrepancy Description:** Optional screenshot failure left loginReady true and startup-passed, violating the explicit capture acceptance contract.
- **Rationale:** CI could publish success with missing visual evidence.
- **AI Suggestion:** PROPOSE FIX.
- **Justification / Proposed Edit:** Separate screenshotCaptured; require successful command plus a new bounded PNG/hash. Refuse stale launch receipts after XCTest relaunches. Failure must keep a nonzero result.
- **Verification:** Command failure, missing/malformed file, failed command with existing PNG and authenticated/unknown state tests pass in `round2-evidence-fixes.log`. Actual ca3f0f7 smoke captured/hashed a new PNG, passed keyboard evidence and succeeded. Round 4 also preserves an earlier PNG during failed retry.

## Related full-suite fixture repairs

The nursery fixture emitted a login through an SDK listener that a preceding real 401 had retired. Its cleanup now initializes a replacement before emitting the next test's login. All 53 nursery lifecycle cases and 115 combined affected tests passed. Music cookie mocks explicitly declare their Android plugin availability, matching the real Capacitor contract; this preserves their original behavior assertions.

No finding was contested/escalated/declined or silently downgraded. Five P1 and two P2 fixes are applied and the native gates passed at ca3f0f7. Authenticated private-account business acceptance remains a separate unverified item.
