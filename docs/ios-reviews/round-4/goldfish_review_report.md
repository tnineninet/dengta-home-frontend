# Goldfish Annotated Review Report

**Target:** working implementation, full files.

Fresh read-only reviewers: `goldfish_r4_auth` and `round4_native_policy`. Root alone writes/fixes. Review reports are source analysis; executed checks below were performed separately by root.

## Prioritized Findings & AI Suggestions

### R4-01 — Delayed SIGNED_IN can replace B with cached A [auth] — P1

- **Affected Scope:** auth-session SDK listener; installed GoTrue recovery/BroadcastChannel path.
- **Discrepancy Description:** An old SDK may broadcast its captured A after another tab restores B. The old cross-user guard excluded SIGNED_IN, allowing B's cache to become A while B persistence/epoch remained current.
- **Rationale:** Subsequent requests could carry the wrong cached account token.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Accept coordinated session events only when the captured record remains current and the actual persisted identity/access/refresh token matches under the origin lock. Do not trust delayed null events as logout of a current persisted B.
- **Verification:** Actual SDK callback fixtures and actual Chromium BroadcastChannel messages for SIGNED_IN/TOKEN_REFRESHED/PASSWORD_RECOVERY/SIGNED_OUT; B remains current and supplies B context. `round4-identity-events.log`, `browser-auth-audit.json`.

### R4-02 — Anonymous clients retain another identity's epoch [auth] — P1

- **Affected Scope:** freshIdentityRecord, coordinator main-session writes, SDK Web callback initialization.
- **Discrepancy Description:** Two anonymous tabs could share an epoch; stale-anonymous B login or SDK Web callback could replace A without fencing A's lease.
- **Rationale:** An old account's authorized refresh/remove could alter newer-account persistence.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Rotate coordinated clients for every identity attempt. Main-session writes also detect account transitions atomically and rotate the writer's origin epoch, covering SDK Web URL initialization. Require an anonymous replacement before identity mutation (round-5 refinement).
- **Verification:** Stale anonymous A-to-B test and identity-changing SDK-write test reject A writes/removes after B; real Chromium cross-page case passes. Same-lease restored-A refinement is tracked in round 5.

### R4-03 — Callback seed loses the replacement slot [auth] — P2

- **Affected Scope:** callback commit, cleanup publication and ensureClient.
- **Discrepancy Description:** A subscriber invoking initialize when cleanup clears could create an empty replacement before the callback supplied B.
- **Rationale:** A validated callback could report success while remaining anonymous.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Reserve the validated full session/recovery state before retirement, tagged with identity epoch. Any winning replacement consumes the reservation before SDK construction. Explicit exit/destroy clears it; callback finally clears only its own reservation.
- **Verification:** Deterministic cleanup-subscriber race, partial seed write and cancellation tests in `native-auth-candidate.test.js`; `round5-auth-complete.log`.

### R4-04 — SDK-generated logout bypasses fanout [auth] — P2

- **Affected Scope:** Web coordinator, lease removeItem, storage-event/request validation.
- **Discrepancy Description:** GoTrue invalid-refresh removal did not change the origin epoch, so a peer could retain cached A with BroadcastChannel absent.
- **Rationale:** Autonomous session loss needs the same cached-token fence as explicit exit.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Main auth-key removal atomically fences epoch and verifies all three keys cleared. SDK tail removals no-op without touching a newer account; reads/writes remain fenced. Verify actual missing-key loss before/after request refresh and on storage events; ignore old event payloads.
- **Verification:** Actual SDK expired-refresh rejection with held event delivery; real Chromium equivalent; direct raw-localStorage removal; invalid-session startup recovery. No real server/account used.

### R4-05 — Failed capture retry deletes referenced PNG [native evidence] — P2

- **Affected Scope:** `scripts/ios-screenshot-evidence.mjs`, simulator manifest.
- **Discrepancy Description:** A retry deleted the original PNG before capture, while failure handling retained the earlier manifest's file/hash.
- **Rationale:** A failed run could claim a missing evidence file, despite remaining failed overall.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Capture into a unique temporary candidate, validate it, then replace the target. Failure preserves existing PNG; temporary files are removed.
- **Verification:** New failed-retry test preserves byte-identical original PNG and leaves no candidate. Current capture/nonce/anonymous-state policy tests pass.

## Runtime question, not a verified defect

The native reviewer could not establish whether Xcode expands the scheme's safe-area build settings without MacroExpansion. Root added explicit App MacroExpansion. Full run 43279364936 at ca3f0f7 passed the test setup's numeric-inset guards, seven phases and final safe rectangle validator, closing the runtime question for that run. It was not marked passed from static review.

All confirmed findings are PROPOSE FIX. No severity was downgraded or original report treated as executed runtime evidence.
