# Goldfish Annotated Review Report

**Target:** current authentication implementation (full files).

Real fresh-context read-only reviewer: `round5_web_protocol`; root alone implements/tests. Reviewer inspected installed GoTrue semantics, not just tests. All three findings accepted.

## Prioritized Findings & AI Suggestions

### R5-01 — Replacement SDK restores A before signing into B [codebase details] — P1

- **Affected Scope:** freshIdentityRecord and coordinated main-session write.
- **Discrepancy Description:** Retiring an out-of-date anonymous lease can preserve a peer's newer A. The replacement may restore A, start auto-refresh and then be reused for B login. Its mutable coordinator epoch would authorize A's late write after B.
- **Rationale:** Cross-tab account isolation still fails if the old refresh and new login use the same SDK/lease.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Require an anonymous replacement before identity mutation. Bounded retirement/restoration retries discard a restored peer's SDK; competing logins beyond the bound cancel rather than mutate a nonempty SDK. Native anonymous behavior remains unchanged.
- **Verification:** Actual SDK fixture holds B password response after peer A has roughly 100 seconds remaining. The selected SDK/persistence must be empty and never refresh A while B waits; final B persists. Existing old-peer write/remove and real Chromium cases also pass. `round5-auth-complete.log`.

### R5-02 — Retired refresh creates an orphaned rejection [codebase details] — P2

- **Affected Scope:** `auth-storage-lease.js`, actual GoTrue refresh Deferred/error handling.
- **Discrepancy Description:** An ordinary storage Error rejects GoTrue's internal Deferred without a guaranteed observer, even if the public refresh rejection is caught.
- **Rationale:** Logout during a successful refresh could generate an unhandled rejection.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** AuthStorageLeaseError extends the exported AuthRetryableFetchError with its inherited exact name, safe fixed message and our stable storage code. GoTrue resolves the recognized error; manager retirement remains permanent and no storage fallback is added.
- **Verification:** Reproduced actual orphaned rejection before repair (`round5-refresh-reproduction.log`). A real SDK refresh with a gated storage write during exit now returns the safe error, clears persistence and leaves anonymous state; `round5-refresh-fix.log` and `round5-auth-complete.log` pass.

### R5-03 — Detached initial-subscription read rejects after retirement [codebase details] — P2

- **Affected Scope:** manager SDK lease reads; installed onAuthStateChange initial-session IIFE.
- **Discrepancy Description:** The SDK's initial subscription read has no public promise observer; an ordinary/recognized thrown read still rejects before its callback-level catch.
- **Rationale:** Retiring a client while that read is pending could produce a separate unhandled rejection.
- **AI Suggestion:** PROPOSE FIX.
- **Resolution:** Only SDK-configured lease reads map retirement to absence, never to credentials, including the seeded no-persistent-storage memory path noted during follow-up. Generic lease reads still reject. Active provider failures remain errors. Writes/removes remain fenced; record/epoch checks suppress stale publication.
- **Verification:** Actual public GoTrue API fixture gates INITIAL_SESSION's storage read, retires and resumes it, observes null and waits a task turn without an orphaned rejection. Separate test confirms active storage failure is not silently converted to absence. `round5-auth-complete.log`.

## Callback rejection follow-through

The reviewer also advised bounding rejected candidate seed restoration. The callback now requires a committed active user matching the validated candidate; a seed rejected by the SDK fails and is cleared rather than returning success or repeatedly reseeding. Actual SDK corruption fixture verifies rejection, absent credentials and a finite client count.

No item was contested, declined, escalated or silently reduced. Runtime evidence continues to be scoped to the actual fixtures and separately recorded native CI SHA.

Reviewer follow-up re-read the fixes and reported no unresolved P0/P1 among these findings. The additional memory-path option was applied after that completeness note; root reuses the same verified SDK-read adapter.
