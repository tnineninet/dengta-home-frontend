# Round 7 — isolated WKWebView transport fixture

Fresh-context reviewer `wkwebview_transport_feasibility` performed read-only design and code review. Root alone writes implementation. Scope: separate test-only UIKit/WebKit host, loopback HTTP server, actual api.js fixture bundle and CI publication. No credentials, product native probe or production configuration changed.

## Findings and resolution

- **P1 — IIFE cannot emit top-level await.** PROPOSE FIX. Root reproduced the locked-Vite build failure (`transport-fixture-build.log`), wrapped execution in an async function, and obtained a successful isolated bundle (`transport-fixture-build-fixed.log`). Native success remains unclaimed.
- **P2 — cancellation close can be the fixture fallback.** PROPOSE FIX. Require response close before fallback and `!response.writableFinished`; normal timeout termination cannot pass cancellation.
- **P2 — failure receipts discarded.** PROPOSE FIX. Copy the native allowlisted receipt after schema/nonce/source/runtime validation and before checking passing booleans. Generic failure output remains fixed and contains no provider/page data.
- **Hardening — inherited VITE values.** PROPOSE FIX. Disable env directory and env prefix, and define only loopback URL/empty public authentication configuration. No environment files are read by the fixture build.

## Evidence boundaries

The ACK is emitted from streamChat's real text callback; terminal event/EOF is withheld until then. This proves callback delivery before EOF without relying on a short timing threshold. UTF-8 text must match exactly, but transport packet coalescing prevents a claim about one write per reader chunk. Cancellation requires one callback, rejection, and server-observed premature response close.

The separate host uses nonpersistent website data, same-origin CSP, a distinct bundle ID, only loopback navigation and its own newly created Simulator UUID. Its generated test-only ATS exception never enters the product Info.plist. Standard ad hoc codesigning applies only to this disposable Simulator fixture; no Developer Team/certificate identity is invented.

Native execution is pending. A passing fixture would not prove actual account login, production TLS/CORS, Capacitor interception/configuration, upstream buffering or chat UI. The previously successful product run remains separate evidence.

## Closure reread

At `07455585988ead7fd7cff99d8bb638c2c52931f3`, the reviewer confirmed all four findings closed. The EGM review/review-loop skills and exact `../../docs/codex.md` reference were read, with implementation_readiness/codebase_details/style personas and the implementation-readiness standard. Two additional `fork_turns=none` reviewers, `round7_protocol_readiness` and `round7_protocol_evidence`, independently returned no further concrete findings. All were read-only; no reviewer ran native builds or accessed credentials. Native CI evidence remains a separate pending step.

Subsequent runtime evidence: complete run43286170878 at0745558 passed the isolated iOS26.5 WKWebView transport and both product Simulator paths. Bound native/server receipts and downloaded ZIP hashes are recorded in the Phase report. The earlier pending language describes review time; authenticated business remains unexercised.
