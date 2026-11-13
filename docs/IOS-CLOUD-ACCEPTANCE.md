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
   to read them, restores them, reads memory, and logs out. Its screenshots and
   raw XCTest logs contain synthetic data only. This is not production business
   acceptance.
3. Live business is manual and requires a separate, approved automation account.
   The guard requires the exact expected account UUID, active member role,
   stable companion, and no initial conversations. No fallback to the existing
   owner account is allowed. The current live test does not deterministically
   observe a partial reply before the real server's terminal event; it must
   report partial acceptance and exit nonzero until that gap is resolved.

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
frames. The only product edit is the composer's ordinary accessibility label
`聊天消息`. No seeded auth snapshot, alternate product screen, JavaScript
injection or native callback approval bypass is used.

## Private live execution

The live step alone may receive `DENGTA_IOS_E2E_EMAIL`,
`DENGTA_IOS_E2E_PASSWORD`, and `DENGTA_IOS_E2E_USER_ID`. They are removed from
the process environment before invoking the build. All raw live subprocess
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
account must be serialized and cannot cancel each other.

## Current account boundary

The account supplied for cloud testing was checked locally through normal login
and bootstrap. It is the existing owner account and has conversations. The
temporary audit login was revoked with local scope. No credentials were uploaded
and no conversation or settings writes were made. It does not satisfy the live
guard; the live job remains unavailable until a suitable separate account exists.
Do not put the owner credential file into Actions or commit any account values.

## Verification and limits

Run focused fixture, live-guard and evidence-policy tests before cloud execution.
A local browser preflight can expose missing fixture routes but proves no native
behavior. Only completed macOS XCTest and inspected artifacts prove Simulator
results. Keep failed run links and do not replace them with inferred success.
Cloud automation does not establish physical-device camera/microphone/background
behavior, mail delivery/native callback-picker coexistence, APNs or distribution.
