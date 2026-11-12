# Round 8 — native callback intent

Fresh-context read-only reviewer `native_callback_intent_review` used the local EGM review skill, exact Codex integration, codebase_details persona and implementation-readiness standard. Root is the sole writer. This narrow review investigated local intent, not another generic reread.

## R8-01 — valid foreign-account callback silently selects B — P2

- **Evidence:** a structurally valid custom URL plus provider-valid B tokens previously sufficed to retire A and seed B. Candidate verification proves identity, not that the local user intended that login. Baseline `f8fa26a` already had this Android weakness; new iOS scheme registration exposed it on iOS.
- **Impact:** attacker-controlled B credentials and a followed custom-scheme link could silently select B. Subsequently entered content could be saved under B. This does not demonstrate takeover of A or transfer of A's existing server data.
- **Disposition:** PROPOSE FIX. Keep provider validation isolated in memory, then request explicit local approval naming the provider-returned account and recovery purpose before reserving a seed or retiring A. Cancel preserves current credentials. No production allowlist or cryptographic flow change.
- **Verification:** actual SDK tests cover anonymous/A states, denial, affirmative consent, public-only metadata, invalid IDs/nonboolean decisions, logout/destruction/timeouts and delayed decisions. Existing candidate/seed cases now inject explicit trusted approval. Native email/provider acceptance remains unexecuted.

## R8-02 — blocking native confirm can lack a completion — P2

- **Evidence:** installed Capacitor `WebViewDelegationHandler.swift` directly presents a UIAlertController, and its missing-controller path returns without completing. A file picker/share sheet can be open when AppDelegate forwards a custom URL. This was a source finding; no native reproduction was executed.
- **Disposition:** PROPOSE FIX. Removed window.confirm. An asynchronous HTML dialog sits beside stable AuthGate content, uses showModal/top-layer modality, defaults focus to Cancel, and fails closed if unavailable. JS timeout remains runnable beneath a native picker. Existing App/drafts remain mounted.
- **Verification:** actual React component tests prove modal show/cancel, unavailable-dialog rejection and preservation of a fictional unsaved draft/mount. A real email/native-picker interaction remains in local Mac acceptance.

## R8-03 — deferred approval can start after retirement — P2

- **Evidence:** logout/destroy could run between candidate validation and the deferred approval microtask, then a stale prompt could be published with a retired epoch and resist dismissal until timeout.
- **Disposition:** PROPOSE FIX. Recheck identity epoch/destruction before any approval callback or prompt creation; recheck again before commit. Each prompt has an ID and owning entry; cleanup only resolves its own entry.
- **Verification:** a controlled microtask test retires between validation and approval and verifies no approval work runs. Default broker timeout/logout/destroy tests prove prompt removal and stale-response refusal. Readiness classifies active approval as authenticating, refusing anonymous screenshot authority.

## Closure

Reviewer reread the async broker/dialog/guard and reported no further findings in this narrow scope. Source review does not establish execution. Explicit consent closes silent account selection; PKCE/one-use challenge binding remains a future hardening option. Shared native callback behavior changes on Android as a narrow security fix; its actual device UI still needs regression acceptance.

Local `round8-consent-final.log`: 50 focused cases passed. `round8-approval-component-fixed.log` passed actual component assertions. Build/CSP/public-auth/emitted-literal checks passed in `web-build-round8-async.log`. Complete test-chain rerun and current-source native CI are tracked in the Phase report.
