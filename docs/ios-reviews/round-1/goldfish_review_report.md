# Goldfish Annotated Review Report

Status: resolved (plan corrections; implementation evidence tracked separately).

**Target:** `docs/IOS-IMPORT-PLAN.md` (full original 63-line plan).

Fresh-context read-only reviewers: `goldfish_r1_readiness`, `goldfish_r1_design`, `goldfish_r1_codebase`. These were real subagents, not simulated personas. The long-run user request authorizes ordinary fixes without the EGM skill's interactive approval gate.

## Prioritized Findings & AI Suggestions

The original findings are normalized below from the delivered flat findings, preserving their severity and substance. Each suggestion is PROPOSE FIX; no item was contested, escalated or declined.

| Issue / reviewer | Severity | Discrepancy and rationale | Proposed edit and resolution |
|---|---|---|---|
| R1-01 / readiness | P1 | Cleanup failure/retry API and lease retention were unspecified. A failed exit could reopen stale credentials. | Add a retained cleanup barrier, rejecting signOut, explicit retry API/UI and verified deletion contract. Added under Lifetime and cleanup contract. |
| R1-02 / readiness | P1 | Toolchain/scripts/deadlines/receipt criteria were not concrete enough to execute CI. | Specify runner/Xcode, bounded smoke stages and nonce-bound receipts. Added under CI contract. |
| R1-03 / readiness | P1 | Rollback could restore plaintext/stale-account persistence. | Require corrective builds that preserve the secure storage boundary; prohibit plaintext downgrade. Added rollback paragraph. |
| R1-04 / readiness | P1 | No business acceptance table separated startup from authenticated workflows. | Require separate actual runtime/business rows and pending results. Added report contract. |
| R1-05 / design | P1 | Late/duplicate 401 could expire a newer session. | Bind request context to lifecycle/scope/session revision and centralize invalidation. Added lifetime contract. |
| R1-06 / design | P1 | Native HTTPS redirect override could prevent dengta://auth handling. | Define iOS-specific redirect precedence while preserving Android/Web behavior. Added callback contract. |
| R1-07 / design | P1 | Callback destination/field grammar was underspecified. | Validate exact native auth target/fields/duplicates before auth initialization. Added callback grammar. |
| R1-08 / codebase | P1 | iOS could inherit Android marker/touch recovery. | Require actual Android guards and platform tests. Added platform integration targets. |
| R1-09 / codebase | P1 | CI omitted API URL and could bundle localhost. | Set the existing HTTPS production API endpoint explicitly and verify real build configuration. Added CI env contract. |
| R1-10 / codebase | P1 | Workflow event/ref/secret boundary was ambiguous. | Limit to the named feature branch/same-repo PR, actual head SHA and read-only token; fail missing public config. Added CI trigger contract. |
| R1-11 / codebase | P1 | Timeout/401 test commands and injectable storage seam were missing. | Name the existing regressions plus deferred storage/lease tests. Added exact regression contract. |

## Post-resolution synchronization

11 accepted fixes; 0 contested; 0 escalated; 0 declined; 0 unaddressed plan findings. Implementation inspection subsequently found defects in several contracts; those are recorded in round 2 rather than treating the plan correction as runtime success.
