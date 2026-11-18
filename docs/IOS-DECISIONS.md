# iOS decisions

The autonomous-run request authorizes recommended ordinary implementation decisions. These are provisional engineering choices for final review, not authorization to publish or change production.

| Decision | A | B | C | Current choice and reason |
| --- | --- | --- | --- | --- |
| Environment | User Mac when available | GitHub Actions macOS | Static only | B, explicitly locked by user. Simulator CI first; no Apple credentials requested. |
| Scope | Core companionship | Core plus APNs/export | Full Android parity | A, explicitly locked. Voice/foreground notifications assessed only. |
| Import | Select modules | Compare whole copy on separate branch | Overwrite product | A. C is prohibited. Current private business source remains authoritative. |
| Keychain/Vault | Adopt if better and tested | Borrow concepts | Exclude | A for credential Keychain/lease; B/defer for account Vault because 34 consumers expand regression risk. This does not encrypt all existing caches. |
| Mac acceptance | User Mac | Actions macOS | Static only | B now. A is available if a Mac is later supplied. |
| Future content/distribution | SFW internal/TestFlight planning | SFW public store | Adult content only on Web | A is a planning recommendation only. No content change, Apple submission or TestFlight action is authorized by this record. |
| Simulator signing | Standard Xcode ad-hoc settings | Diagnose failure using actual logs | Fabricated Team/group | A first, B if needed; C rejected. No device certificate or profile is used. |

Credential key names stay stable. Deep-link scheme remains `dengta://auth`; changing production allowlists is outside this run. Current native logs must not serialize credentials, account IDs or callback URLs.

## Future distribution review — assessed, not implemented

Read the current [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [TestFlight](https://developer.apple.com/testflight/) and [account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/) on 2026-11-12T19:11Z (HTTP 200, cached outside Git). These are future review dependencies; this branch does not submit, change content policy, add purchases or modify production.

| Area | Official rule / implication for later DengTa review | Required next evidence |
|---|---|---|
| Sexual content | Guideline 1.1.4 restricts explicit sexual/pornographic material; 2.2 also applies review guidelines to TestFlight betas | SFW product policy, adversarial generated-content examples and age-rating review; internal beta is not a content-policy exemption |
| AI-generated content | Current 1.2 explicitly includes AI content creation and requires safeguards such as filtering/reporting/contact mechanisms | Map generated, uploaded and shared content to applicable controls; determine the relevant block/report UX rather than assume a private chat needs no review |
| Personal data / AI | 5.1.1/5.1.2 require truthful privacy handling and disclosure/permission for personal data shared with third parties, including AI | Actual provider/data-flow/retention map, permission UX, App Store privacy answers and privacy policy; Keychain alone does not satisfy this |
| Account deletion | 5.1.1(v) requires in-app deletion when account creation is offered | Verify complete account/data deletion behavior and disclosed retention; no production data is deleted in this run |
| Digital paid features | 3.1.1 and its applicable exceptions govern in-app digital unlock/payment mechanisms | Audit actual entitlement/purchase flows and intended storefront before selecting IAP/link behavior; no payment redesign here |
| Native utility / completeness | 4.2 evaluates utility beyond a repackaged site, and 2.1 requires a reviewable working app | Actual core-business acceptance, useful native integration and accurate demo/reviewer access; a Capacitor build alone is insufficient |

Application to DengTa in the final column is engineering assessment, not an Apple decision. Recommend SFW internal/TestFlight planning only after local business acceptance and a separate content/privacy/payment review. No approval outcome is promised.
