# iOS import matrix

Comparison baseline: frontend `f8fa26ae`, package `2.13.43`, Capacitor `8.4.3`. Candidate: fixed external snapshot `75ad3daa`, public business baseline `2.10.74`.

Scores range from 1 to 5. Compatibility, security, evidence, maintainability and necessity: higher is better. Regression risk: higher is worse. Evidence scores describe inspected assets, not a claim that this run executed them.

| Module | Compatibility | Security | Evidence | Maintainability | Necessity | Regression risk | Decision and boundary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Native Xcode/SPM project | 2 | 3 | 1 | 2 | 5 | 5 | Borrow structure; generate a clean 8.4.3 project, then explicitly add only reviewed Keychain sources and bridge registration. No Vault/browser dependency. |
| Keychain Swift store/plugin | 5 | 4 | 3 | 4 | 5 | 2 | Adopt after inspection and native policy/runtime checks. Keep three-key allowlist, unlocked/device-only access, no shared group, fixed errors and disabled bridge logs. |
| iOS auth storage adapter | 4 | 4 | 3 | 4 | 5 | 3 | Adopt with tests for migration failure, serialization, revocation and no plaintext fallback. Android retains its existing Preferences path. |
| Storage lease | 4 | 4 | 3 | 4 | 4 | 3 | Adopt a shared per-client lifecycle/verified-cleanup guard for iOS/Android/Web. Providers remain Keychain/Preferences/browser storage respectively. Verify in-flight writes drain before clear. Web localStorage additionally coordinates epochs under Web Locks where available; native stores do not use that protocol. Without Web Locks only ordinary storage-event logout fanout is promised across Web tabs. |
| External auth-session/AuthGate | 2 | 4 | 3 | 2 | 4 | 5 | Reject whole-file replacement. Integrate a client-creation singleton, generation checks and secure-storage retirement barrier into current code. Preserve timeout/retry, refresh deadline, connectivity and request/companion scope protection. |
| AccountVault/cache/cleanup | 2 | 4 | 3 | 2 | 2 | 5 | Defer. Thirty-four source consumers and async hydration/flush semantics exceed credential migration. No claim that all private caches become encrypted. |
| Native runtime/deep-link helper | 4 | 5 | 3 | 4 | 4 | 2 | Adopt independently after tests; preserve existing Android compatibility and current product boot logic. Accept only supported, strictly parsed callback URLs. |
| Viewport lease | 4 | 4 | 3 | 4 | 4 | 3 | Borrow reference counting, preserving the current keyboard-scroll feedback guard. Test shared AuthGate/App installation and cleanup. |
| iOS CSS | 3 | 4 | 2 | 3 | 4 | 4 | Borrow only native iOS scoped rules. Exclude broad Safari/PWA changes. Native anonymous login/register/reset layout and keyboard checks passed on iPhone 17/SE 3 in run 43286170878 at 0745558; authenticated chat layout remains unverified. Later callback-consent changes require new source CI. |
| macOS workflow/capture | 2 | 3 | 2 | 2 | 5 | 4 | Rewrite for the standalone frontend. Keep build:web validation, explicit Xcode, simulator lifecycle, readiness and failure evidence. Use existing public-auth build secrets; no account password or service role. |
| Fabricated simulator signing script | 1 | 1 | 1 | 1 | 1 | 5 | Reject. Use Xcode's Simulator signing/ad-hoc build settings and inspect the resulting identity/entitlements. Never synthesize a Team/group. |
| Keychain policy fixture/OCR concepts | 4 | 4 | 3 | 4 | 4 | 2 | Adopt reviewed fixtures and fixed-output readiness classification. Policy injection is separate from actual Simulator Keychain evidence. |
| Old business/backend/research plugins/screenshots | 1 | 2 | 1 | 1 | 1 | 5 | Reject import. Research remains reference only; historical screenshots are not current evidence and were not privacy-audited. |

Independent read-only comparison agents inspected the native/CI/layout and authentication boundaries. Implementation changes are made only by the root executor. Fresh-context EGM findings, fixes and disposition will be recorded separately in `IOS-REVIEW-EVIDENCE.md`.
