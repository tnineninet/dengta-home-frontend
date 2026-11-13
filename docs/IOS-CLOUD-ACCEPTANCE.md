# Cloud iOS business acceptance

No personal Mac is required for this path. Windows edits the isolated feature
branch; GitHub Actions macOS runs the actual Capacitor app in iOS Simulator.
Apple Developer, APNs, device signing and distribution remain outside this task.

## Separate evidence

1. The existing `ios.yml` Simulator job builds production-configured assets and
   proves anonymous launch, Keychain, login/register/recovery keyboard layout on
   iPhone 17 and SE 3. It does not submit credentials.
2. The new synthetic business job uses the real product entry, AuthGate, SDK,
   Keychain and React UI, but an isolated runner-local auth/API fixture. XCTest
   submits the login form, sends a safe message, sees the first Chinese/emoji
   chunk before acknowledging a nonce gate, then checks completion, history and
   native-session restoration. It edits both personalization fields, relaunches
   to read them, restores them, reads memory, and attempts logout. These are the
   intended full-flow checks; completed results and open failures are below.
   Its screenshots and
   raw XCTest logs contain synthetic data only. This is not production business
   acceptance.
3. Live business execution is currently disabled, including manual dispatch. A
   dispatch returns `live-driver-safety-incomplete` before reading credentials,
   building or contacting a service. A future live run requires a separate,
   approved automation scope.
   The guard requires the exact expected account UUID, active member role,
   stable companion, and no initial conversations. No fallback to the existing
   owner account is allowed. The current live test does not deterministically
   observe a partial reply before the real server's terminal event; it must
   fail until that gap is resolved. It also needs a successful assistant-reply
   assertion and interruption-safe remote cleanup before this gate can open.

## Implementation boundary

`scripts/ios-business-fixture.mjs` binds only loopback and rejects unknown routes,
wrong identities, companion mismatches, nonlocal origins and invalid gate
nonces. Chat is a multipart POST with persisted meta/text/done messages. Its
terminal event is withheld until native XCTest sees the first text. Fixture
receipts publish counters and booleans, never internal auth or content state.

`scripts/ios-business-smoke.mjs` copies the iOS source into a private runner
workspace, symlinks installed dependencies, builds actual product assets with
explicit public configuration and no env-file loading, then synchronizes SPM.
Only the temporary synthetic copy gets a localhost-only ATS exception. The
tracked source Info.plist and release policy are unchanged. Xcode builds for
testing without account credentials. A temporary `.xctestrun` puts runtime
credentials in the XCTest runner environment, never the app/build settings,
launch arguments or web assets. The build plan remains in Build/Products so its
`__TESTROOT__` paths still resolve.

`BusinessFlowTests.swift` uses native accessibility and actual keyboard/control
frames. Product changes add the composer's ordinary accessibility label
`聊天消息`, make the existing iOS 16px input minimum win over more specific
component rules (the chat textarea otherwise remains 15px and can trigger
WebKit focus zoom), keep iOS chat rows rendered across viewport changes, and
render each exact save/count receipt as a single text node for accessibility.
No seeded auth snapshot, alternate product screen, JavaScript
injection or native callback approval bypass is used.

## Private live execution

After those readiness gaps are resolved, only the live step may receive `DENGTA_IOS_E2E_EMAIL`,
`DENGTA_IOS_E2E_PASSWORD`, and `DENGTA_IOS_E2E_USER_ID`. They are removed from
the process environment before invoking the build. The present workflow passes
no account secrets to any step. All raw live subprocess
output, test plans, xcresult and Simulator containers remain private. No live
screenshots, video, HAR, accessibility/DOM dumps or raw logs may be uploaded,
including on failure. Published live evidence has a strict allowlist: source
SHA, nonce, fixed mode/outcome/stage names, booleans, bounded counts and geometry.

`scripts/ios-business-live.mjs` uses ordinary auth/API requests only. It pins the
production HTTPS origins and companion header, snapshots the complete editable
settings payload (including legacy fields and prompt mode), and refuses
owner/admin or an account with existing conversations before any mutation.
Stop the app before fallback restoration so its 800 ms autosave cannot race
cleanup. Restore and reread the complete baseline, delete only the sole session
created since the empty baseline, verify cleanup, revoke test sessions and delete
the created Simulator. Cleanup failure fails the run. Runs sharing the dedicated
account must be serialized and cannot cancel each other. On rejected preflight,
revoke only the guard's local auth session. After accepting the dedicated account,
global revocation must succeed to cover the UI login too; HTTP 401 cannot prove it.
The present helper implements normal completion cleanup only. Forced cancellation
can skip its `finally`, so interruption recovery is an explicit open blocker and
the live execution gate stays closed.

## Current account boundary

The user has specified the account for testing. It was checked locally through
normal login and bootstrap: it is the existing owner and has conversations. The
temporary audit login was revoked with local scope. No credentials were uploaded
and no conversation or settings writes were made. It does not satisfy the live
guard's current empty-member policy. That is an implementation restriction, not
an iOS, Apple or GoTrue requirement. Supporting the specified existing account
needs exact test-session ownership and local-only revocation (both the current
guard and normal product logout can revoke globally), in addition to successful
reply and interruption recovery. Do not ask the user to provide the same account
again, treat an existing conversation as test-owned, or upload the owner
credential file. No current job reads account secrets.

## Verification and limits

Run focused fixture, live-guard and evidence-policy tests before cloud execution.
A local browser preflight can expose missing fixture routes but proves no native
behavior. Only completed macOS XCTest and inspected artifacts prove Simulator
results. Keep failed run links and do not replace them with inferred success.
Cloud automation does not establish physical-device camera/microphone/background
behavior, mail delivery/native callback-picker coexistence, APNs or distribution.

## Executed supplemental checks (2026-11-13)

Windows `test:ios-business` passes all 31 fixture/SDK/cleanup/evidence cases.
`test:ios` passes, and `build:web` passes with the required public auth build
configuration. A first invocation without that configuration failed the public
auth verifier; it is not counted as success. Desktop and 402x874 Chromium
preflights each pass six synthetic product cases with zero unknown routes or
external requests. They are browser evidence only.

Native business runs 43355244162, 43356331374 and 43357224935 did not pass.
The first used an invalid keyboard-container hit-test assertion; native key and
frame checks replaced it. Later runs prove real UI login, composer/send keyboard
geometry, and first text before the nonce acknowledgement; the fixture then
persists the complete reply. Native terminal-text lookup still failed even
though the failure screenshot shows both chunks. Shortening a text selector did
not resolve run 43357224935 and is not recorded as a fix. The next run includes
the input minimum repair, the actual phone settings path (status capsule then
gear), and a synthetic-only accessibility-tree failure diagnostic. Run
43358580545 passes chat completion/settings opening, then fails scrolling back
past the fixed settings header before a settings write. The gesture repair in
0947466 is independently reviewed. Run 43359416288 again fails terminal text:
its screenshot has both chunks, while its AX tree has no user/assistant body
texts. The iOS override in 5c240db disables mobile `content-visibility:auto` for
chat rows; software history windowing remains. New source also exposes the two
count receipts as whole text nodes. Run 43360513467 passes chat but fails before
settings writes because full-height drags overshoot a field. Adaptive-distance
drags with a hold before lift in 1ba7e3a resolve that observed failure in run
43361811216: login, first-text/ACK/terminal, session/history restoration, persona
save/relaunch readback/baseline restoration and memory-page opening pass. The
fixture confirms baseline restored, persisted user/assistant messages and zero
violations. The 441.155-second XCTest then fails querying the account button:
WebKit exposes its aria-haspopup=menu control as AX Other. Logout remains false,
so business/overall is failed although the standard Simulator job succeeds.

Commit ca121ae69016ac2b41295a46413800821f52baee uses the exact account and logout
labels across ordinary native AX types, retaining full visibility and normal
tap requirements. It also requires the synthetic memory-card body to be visible
before marking memoryOpened; the previous run only checked the page/read status.
Local business policy tests pass 31/31, and independent static review finds no
new P0/P1. These statements are not native verification of the patch.

PR run [43363465042](https://github.com/DengTaHome/dengta-home-frontend/actions/runs/43363465042)
is completed/failure before either runner starts: both jobs have no steps and
GitHub's failure annotation says recent account payments failed or the spending
limit needs increasing. No new build, XCTest or screenshot exists. Capacity is
only a separate notice. The administrator must restore Billing & plans before
rerunning this SHA; no payment or spending settings were changed by this task.
The Phase 1 report records downloaded hashes and all evidence boundaries.
