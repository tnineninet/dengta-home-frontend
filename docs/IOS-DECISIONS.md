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
