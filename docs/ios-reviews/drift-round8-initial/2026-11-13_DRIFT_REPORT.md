## IOS-BUILD.md

No drift detected.

## IOS-DECISIONS.md

No drift detected.

## IOS-EXTERNAL-HANDOFF-REVIEW.md

No drift detected.

## IOS-IMPORT-MATRIX.md

- L17 still says runtime layout lacks simulator evidence. Anonymous seven-phase layout passed on iPhone 17/SE 3 at 0745558/run 43286170878; authenticated chat and landscape remain unverified.
- L23 says review dispositions will be recorded, although eight rounds already exist.

## IOS-IMPORT-PLAN.md

- Credential/callback contracts at L41/L59 omit the new approval step between provider validation and seed reservation. Require explicit account/purpose approval, strict true, 60-second deadline, unavailable-dialog refusal and cancellation/logout/destroy/epoch guards. Native email/picker execution is still unverified; approval is not PKCE.

## IOS-INFO-PLIST.md

No drift detected.

## IOS-KNOWLEDGE-BASE.md

- L18 jumps from provider validation to seed reservation and omits explicit async approval plus its cancellation/lifetime guards. Component/SDK tests do not prove native showModal/email/picker interaction.
- L37 omits the latest successful dual-device product source 0745558/run 43286170878, which still predates round8.

## IOS-LONG-RUN-LOG.md

No drift detected.

## IOS-PHASE1-REPORT.md

- L66–69 report old round5/6 local passes without qualification. Record current round8 evidence separately; successful build log is web-build-round8-async.log, while web-build-round8.log retains the initial lint failure.
- L74–75 omit the latest successful native 0745558/run 43286170878 and the subsequent source's pending CI status.
- L77 conflates pending new-source native build/startup regression with unexecuted email/approval/picker interaction. The ordinary anonymous CI never opens the approval dialog; a green run cannot establish that behavior.
- L153 describes the earlier clean drift report and leaves later transport documentation unreviewed. Preserve its historical scope, then append this audit and dispositions.

## IOS-PLUGIN-MATRIX.md

- POST SSE row omits passed independent iOS 26.5 WKWebView synthetic loopback transport at 0745558/run 43286170878. Product origin/production TLS/CORS/private business stay unverified.
- Login/deep-link rows omit isolated validation followed by explicit async approval. Actual cold/hot email and native-picker interaction remain unverified.

## IOS-REVIEW-EVIDENCE.md

- Local evidence summary lacks current round8 focused/component/build results and actual broader-test status.
- Final drift paragraph describes only the historical earlier audit. Append current audit and corrections without attributing these later findings to the earlier reviewer.
