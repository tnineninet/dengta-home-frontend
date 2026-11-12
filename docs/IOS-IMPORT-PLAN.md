# DengTa iOS selective import plan

Status: implementation plan; acceptance is not established by this document.

## Feature scope

Keep the existing React/Vite/Capacitor product. Required business scope is login/session restoration, companion load, POST SSE chat, personalization, memories and settings. Voice/foreground notifications are feasibility assessments. APNs, device signing, IPA, TestFlight and public distribution are excluded.

The current private frontend is the source of truth. The external snapshot is a candidate library of modules, not a replacement product. Preserve QQ cloud/AstrBot, update UI behavior on Android, network timeout/retry and account/companion scope protections. Do not change backend/database/production configuration.

Environment B uses GitHub Actions macOS. The repository has Actions enabled and existing public-auth build secrets; neither an Apple account nor a production user password is needed for compilation and an unauthenticated launch check. Real authenticated business checks are separate from startup checks and must not be reported as passed by a login-page screenshot.

## Detailed Implementation Plan

### 1. Isolate and preserve

- Create branch `feat/ios-import-75ad3da` in the isolated worktree at fetched `origin/main=f8fa26ae`.
- Do not switch/reset the original feature checkout or alter the dirty summary repository.
- Keep downloaded source, test logs and CI artifacts outside Git. Import no external environment files, screenshots, archives, dependencies or build products.

### 2. Native host and build configuration

- Modify `package.json` and lockfile: add only `@capacitor/ios@8.4.3`; keep Node 24 and all Android dependency versions.
- Create `ios/` using the pinned Capacitor CLI's SPM generator when supported. A failed Windows native command is a recorded failure, never a fabricated successful build.
- Modify `capacitor.config.json`: add native iOS background/mobile/content-inset configuration and disable bridge logging; preserve Android/server fields.
- Create the reviewed `DengTaKeychainStore.swift`, `DengTaKeychainPlugin.swift` and a minimal bridge controller in the generated host. Register Keychain only; do not register AccountVault.
- Modify the generated Xcode source membership and main storyboard to use that controller. Retain standard generated application delegate and SPM structure. Synchronize plugins before Xcode compilation.
- Modify Info.plist: keep Bundle ID `home.dengta.app`, register `dengta` URL scheme, use truthful optional microphone/photo/camera purpose strings only for exposed capabilities. Do not add location/background/APNs entitlements as a speculative requirement.
- Create PrivacyInfo.xcprivacy for actual required-reason API usage; distinguish it from App Store privacy disclosures, which are not complete in this phase.

### 3. Credential storage and session lifetime

- Create `src/auth-keychain-storage.js` and `src/auth-storage-lease.js` from reviewed candidates. Restrict storage keys to the auth key, code verifier and auth user; never log values/provider errors. Fail closed on iOS bridge/read/write/verification/cleanup failure.
- Modify `src/auth-native-storage.js` incrementally: iOS uses Keychain; Android keeps current Preferences probe/string conversion/fallback; Web returns supplied storage unchanged. Wrap the Preferences proxy in an ordinary object before async return.
- Modify `src/auth-session.js` incrementally: keep one pending client-creation promise, the client's actual storage/lease, a lifecycle generation and a cleanup barrier. A stale initialization/login/callback must not publish or persist a new session after logout. Preserve all existing deadlines, errors, connectivity and request-scope checks.
- Secure exit/invalidation: synchronously retire the old lease, invalidate generation and detach/stop the old SDK; wait for in-flight storage operations, clear all auth keys and verify deletion. Block new secure clients behind cleanup failure, with an explicit retry path after unlock. Do not mark cleanup complete on a timeout. Server logout is best effort and must not delay local revocation.
- Add targeted tests for concurrent creation, logout during pending storage initialization, delayed SDK completion, clear failure/retry, old refresh writes and old remove operations. Run the existing authentication and request-scope suites as well.
- Keep general cache encryption out of scope and document remaining plaintext cache boundaries explicitly.

- Shared Web compatibility: actual localStorage with Web Locks uses a nonsecret origin epoch and exclusive auth-operation lock. Explicit/SDK logout, identity-changing writes and manager-owned storage events fence older clients independently of SDK BroadcastChannel. Session event payloads must match current persistence before publication. Without Web Locks only ordinary removal-event fanout is claimed. Android retains its Preferences resolver and iOS its Keychain resolver; the shared manager lease/cleanup affects all platforms.
- Validate native callback tokens in an isolated nonpersistent SDK before touching the active identity. Then require explicit account/purpose approval through the async in-page dialog before reserving the full session/recovery seed or retiring the active identity. Only a strict affirmative decision commits; dialog unavailability, cancellation, a 60-second deadline, logout, destruction and stale identity/approval IDs refuse the candidate. Keep the existing App/drafts mounted. Reserve the approved seed before cleanup publication, commit once through a fresh lease, and reject a failed/anonymous restoration rather than reporting callback success. Require an anonymous replacement SDK for new identity attempts; bounded competing Web restoration cancels safely. The manager, native-auth-approval helper, NativeAuthApprovalDialog and AuthGate implement this boundary; real native email/picker interaction remains unverified and PKCE binding is deferred.
- SDK-facing retired reads return absence; generic lease reads reject. Retired writes/removes stay sealed. Safe lease errors use the SDK's exported retryable error type/name to resolve refresh waiters without an orphaned rejection; no error/provider value is exposed and no persistence fallback is added.

#### Lifetime and cleanup contract (round 1 resolution)

- Inject `resolveStorageFn` into `createAuthSessionManager`, defaulting to the existing platform resolver. One pending client record owns its generation, resolved storage and revocable lease. Every SDK result/event checks that record before publishing.
- Account exit immediately increments the generation, stops refresh, unsubscribes and retires the owned lease; a still-pending resolver is retired before it can create a client. Cleanup remains a barrier until deletion of all three auth keys is verified. New initialization rejects with fixed `auth_cleanup_failed` while failed cleanup is retained. `retryAuthCleanup()` explicitly retries the same sealed record, and AuthGate exposes an unlock/retry button. `signOut()` rejects on local cleanup failure while keeping the shell anonymous/error; server revocation is best effort.
- Request contexts carry an opaque lifecycle identity. Invalidation accepts that originating identity; stale identities are ignored and concurrent calls share the same exit. Remove the duplicate invalidation in `requestJson`. Bind companion-response capture to the same request identity.
- Existing timeout regression commands explicitly include `node --test test/auth-timeout.test.js test/auth-401-scope.test.js test/auth-refresh-scope.test.js test/auth-email-callback.test.js`. New manager race fixtures inject deferred storage and verify pending initialization, stale writes/removes/events, failed clear/retry and late old-account 401.

### 4. Platform, deep links and layout

- Create `src/native-app-runtime.js` and tests for exact callback parsing, cold/hot launch deduplication and lifecycle cleanup. Modify `src/main.jsx` only at integration points; retain current Android compatibility.
- Modify Android download/update entry conditions in `src/App.jsx`; do not alter APK execution/signing/feed behavior. Audit optional native calls for platform/plugin availability.
- Borrow viewport reference counting in `src/mobile-viewport.js`, preserving current keyboard-scroll scheduling behavior. Add AuthGate installation/cleanup without replacing its 20-second loading recovery.
- Create narrowly native-scoped iOS CSS only as justified by layout evidence. Test shared viewport leases, focus/resize/scroll and final cleanup.

- Include `src/android-compat.js` and Android touch recovery in the platform correction: native iOS gets neither the Android marker nor Android recovery; shared Web viewport adaptation remains. Restrict the two APK download links to platforms other than native iOS.
- Callback grammar is exactly `dengta://auth` with empty or `/` path, no credentials/port/query, and a fragment containing one nonempty access token, one refresh token and optional recognized Supabase metadata. Reject duplicate fields and invalid types before initialization, including direct manager calls. `type=recovery` retains password recovery semantics. Provider validity alone cannot authorize account selection: the explicit async approval and cancellation/lifetime guards above must run before seed reservation. Cold/hot duplicate dispatch shares the pending callback; failed dispatch may be retried.
- Add an explicit `platform` redirect parameter. Native iOS always selects `dengta://auth`; preserve the existing configured HTTPS precedence for Android/Web. CI sets no HTTPS redirect override, checks the emitted reviewed API/native callback literals and separately runs source redirect behavior tests. Literal presence is not a runtime request or production allowlist assertion.

### 5. CI and evidence

- Create `.github/workflows/ios.yml` for only this feature branch/PR/manual invocation, with `contents: read`, bounded jobs and artifact retention. No deploy, artifact deletion or production changes.
- Select an explicit macOS/Xcode 26.x toolchain, print tool versions and source SHA, use Node 24 and `npm ci`, run targeted regressions, `npm run build:web`, `npx cap sync ios`, native policy fixtures, then Simulator Debug build.
- Use standard Xcode Simulator signing settings (`CODE_SIGNING_ALLOWED=YES`, `CODE_SIGN_IDENTITY=-`); no invented Team, group or manual re-sign chain. If startup fails, inspect actual signatures, nested products and system logs before changing settings.
- Create a reviewed simulator smoke script: discover available device/runtime identifiers, boot, wait for boot completion, install, launch with an explicit diagnostics flag, verify process/readiness, capture screenshots and collect failures. Require actual Keychain probe add/read/delete success and roundtrip=true.
- Record build, launch, Keychain and login-readiness independently. A failed/loading/error page fails readiness. Never include private account content or full callback URLs in diagnostics/artifacts.
- Upload safe logs, screenshots, manifest/source SHA and test results even on failure. Download and hash artifacts outside the repository.
- Real account login, SSE and settings persistence remain unverified until they have distinct executed checks. Do not count fake configuration, policy mocks or OCR as those checks.

#### Exact CI contract (round 1 resolution)

- Workflow push branch: `feat/ios-import-75ad3da`; PR base: `main` with that head branch and same-repository source; manual invocation only on that branch. Never use `pull_request_target`. Checkout the event source SHA (PR head for a trusted same-repository PR), record it in the receipt. Fork/unrelated PRs receive no privileged build job.
- Runner `macos-26`, `DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer`, Node 24, job timeout 35 minutes, artifact retention 7 days. Validate toolchain presence rather than silently changing Xcode. Use existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` secrets plus explicit `VITE_API_URL=https://dengta-home-backend-rkmq.onrender.com`. Missing public config fails a named configuration step; it cannot produce accepted readiness.
- Smoke invocation: `bash scripts/ios-simulator-smoke.sh <App.app> <evidence-directory> <source-sha>`. Discover an available iPhone device; boot completion, install and launch must succeed within bounded command/job time. Launch with `--dengta-ci-keychain-diagnostics` and a fresh UUID. Receipt schema records sourceSha, device/runtime, build/launch and native probe status independently from login readiness. The reviewed implementation uses a Simulator-only fixed DOM query and enum marker rather than OCR: require anonymous state, visible enabled email/password/submit controls and no loading/error indicator. Capture failure never counts as ready. Native probe requires add/read/delete status zero, roundtrip true and read-after-delete item-not-found. Preserve safe failure receipts; omit account/token/full callback values.
- Acceptance table in `IOS-PHASE1-REPORT.md` keeps separate rows for build, launch, Keychain, login readiness, authenticated restoration, companion load, live POST SSE, personalization save/restore, memories/settings, and keyboard/safe area. CI startup green establishes only the rows actually exercised.
- Native anonymous geometry coverage uses two separately created devices: iPhone 17 and iPhone SE (3rd generation), each with its own nonce, actual safe-area receipt, screenshot and seven keyboard phases. Missing the explicitly selected type fails rather than silently substituting a taller device. Logs keep each device's results separate; this does not expand business acceptance.

### 6. Review, rollback and delivery

- Run at least three fresh-context EGM rounds. Root classifies each finding as PROPOSE FIX, CONTEST with readable evidence, DECLINE or unresolved blocker; records fixes/tests before the next round.
- Run drift checks against all iOS documents and actual files/CI evidence. No claim may outrun evidence.
- Roll back a failed module by reverting only its isolated changes/commit; never reset unrelated user changes. A Keychain migration rollback may require re-login; never copy credentials back to plaintext.
- Credential rollback retains the Keychain resolver/lease secure boundary. Never restore an older Preferences resolver after migration: stale account A data could otherwise replace account B. If a secure module cannot be repaired, block login and require a secure corrective build/re-login rather than downgrade persistence.
- Commit only reviewed source/docs. Push only `feat/ios-import-75ad3da`, create a draft PR, attach it to this chat, monitor actual CI and fix failures. Do not merge or distribute.
- Complete the requested report/document set and a final four-to-eight-hour checkpoint. Unresolved P0/P1 is reported as incomplete/blocked, never completion.
