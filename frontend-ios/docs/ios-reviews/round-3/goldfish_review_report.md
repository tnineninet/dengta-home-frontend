# Goldfish Annotated Review Report

**Target:** `docs/IOS-IMPORT-PLAN.md` and current implementation (full files), reviewed from `f8b8f51` plus working changes.

Real fresh-context, read-only reviewers: `goldfish_r3_auth`, `goldfish_r3_native`, `goldfish_r3_drift`. Root alone applied repairs. Findings were received from actual agents; this is not simulated review. The autonomous user request authorizes ordinary fixes without an intermediate approval gate.

## Prioritized Findings & AI Suggestions

### R3-01 — Cross-tab logout notification disappears [codebase details] — P1

- **Affected Scope:** `src/auth-session.js`, retirement/disposal and getRequestContext.
- **Discrepancy Description:** Retirement disposed GoTrue before logout. Disposal closed its BroadcastChannel; direct admin revocation and sealed-lease cleanup did not notify a peer, which could retain a cached bearer.
- **Rationale:** A Web logout/invalidation regression could keep another tab authenticated until token expiry.
- **AI Suggestion:** PROPOSE FIX.
- **Proposed Edit / Resolution:** Add manager-owned real-localStorage event handling, independent of SDK channels. Where Web Locks/crypto exist, serialize auth-key operations with a nonsecret origin epoch and fence old leases before storage events arrive. Preserve an ordinary removal-event fallback where locks are unavailable; do not claim strict cross-tab serialization there. Native stores do not use the Web protocol. Later adversarial refinements are recorded in rounds 4/5.
- **Verification:** Actual GoTrue fixtures in `test/auth-web-lifetime.test.js`; actual Windows Chromium Web Locks/storage/BroadcastChannel audit outside Git (`browser-auth-audit.json`). Fully synthetic auth provider, no real account or iOS claim.

### R3-02 — Invalid callback destroys the existing durable login [codebase details] — P2

- **Affected Scope:** `src/auth-session.js`, handleAuthCallbackUrl/freshIdentityRecord.
- **Discrepancy Description:** The current identity was destructively retired before setSession validated a syntactically accepted URL's tokens.
- **Rationale:** A malformed or provider-rejected external URL could erase an otherwise valid login.
- **AI Suggestion:** PROPOSE FIX.
- **Proposed Edit / Resolution:** Validate through an isolated nonpersistent/non-refreshing SDK first. Failure/timeout leaves the current account intact. Commit only the validated full session, including any rotated refresh token, through a fresh persistent lease; retain identity cancellation and recovery semantics.
- **Verification:** Actual SDK malformed JWT/provider rejection/timeout/late success/logout/rotated refresh cases in `test/native-auth-candidate.test.js`; round-3 and round-5 auth logs outside Git. Candidate commit-slot and rejected-seed refinements are in rounds 4/5.

### R3-03 — Reveal helper uses a weaker rectangle [implementation readiness] — P2

- **Affected Scope:** `ios/App/AppUITests/KeyboardSmokeTests.swift`, shared App scheme, `scripts/ios-simulator-smoke.mjs`.
- **Discrepancy Description:** XCUITest's reveal helper used window top zero, while the final geometry validator required actual native safeAreaTop (62 points in the executed run).
- **Rationale:** Scrolling could stop before a control fully reached the rectangle used for acceptance.
- **AI Suggestion:** PROPOSE FIX.
- **Proposed Edit / Resolution:** Forward measured native safe top/bottom through xcodebuild/scheme to test setup, validate numeric bounds, and use the same safe rectangle for reveal/visibility and final evidence.
- **Verification:** Full run 43279364936 at ca3f0f7 passed native environment forwarding, all seven phases and final geometry parsing. The earlier f8b8f51 raw XCTest passed but its overall run failed on a separate overstrict keyboard-bottom parser; revalidation alone was never counted as green.

### R3-04 — Compiled API/redirect verification absent [documentation drift] — P2

- **Affected Scope:** Import plan, workflow and `scripts/verify-public-auth-build.mjs`.
- **Discrepancy Description:** The plan promised compiled API/redirect verification, but the verifier checked only public Supabase values; source behavior tests and process env checks did not inspect emitted API/callback literals.
- **Rationale:** Documentation overstated what build validation established.
- **AI Suggestion:** PROPOSE FIX.
- **Proposed Edit / Resolution:** Add `verify-ios-build-policy.mjs`, tests and workflow step for the exact reviewed HTTPS API/native callback literals. Clearly distinguish literal presence, source redirect behavior and actual authenticated transport.
- **Verification:** `web-build-round4.log` passes public auth, CSP and new emitted-literal verification; negative policy fixtures pass. No runtime routing/allowlist success is inferred.

### R3-05 — Shared lease boundary understated [documentation drift] — P2

- **Affected Scope:** `docs/IOS-IMPORT-MATRIX.md`, auth manager/provider integration.
- **Discrepancy Description:** The matrix called the lifetime adoption iOS-only, although the manager also wraps Web and Android storage and applies cleanup barriers.
- **Rationale:** Reviewers need the real regression boundary.
- **AI Suggestion:** PROPOSE FIX.
- **Proposed Edit / Resolution:** State shared lifecycle/lease behavior, platform-specific persistence, Web coordination capability limits, and relevant Web/Android regression evidence.
- **Verification:** Matrix corrected; existing shared authentication/full suite and real browser checks recorded separately.

### R3-06 — Stale external import status [documentation drift] — Nit

- **Affected Scope:** `docs/IOS-EXTERNAL-HANDOFF-REVIEW.md` opening status.
- **Discrepancy Description:** It still said candidates had not been imported after selective implementation existed.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Separate historical Stage 0 audit status from current selective reuse; retain unverified business limits.

### R3-07 — Stale Clipboard build status [documentation drift] — Nit

- **Affected Scope:** `docs/IOS-PLUGIN-MATRIX.md`, Clipboard row.
- **Discrepancy Description:** Native build was described as pending despite the successful earlier CI compiling the linked plugin.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Distinguish successful historical compilation, current-SHA rebuild and unverified Clipboard interaction.

No finding was contested, declined, escalated or silently reclassified. The native gate is verified by ca3f0f7; compact-device expansion is tracked separately and cannot inherit that result.
