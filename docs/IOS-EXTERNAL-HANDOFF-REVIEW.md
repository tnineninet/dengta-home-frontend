# External iOS handoff review

Status: fixed-package verification completed. This document records the Stage 0 evidence; current selective imports and new native run results are tracked in IOS-IMPORT-MATRIX.md and IOS-PHASE1-REPORT.md. Historical external failures remain separate from this branch's evidence.

## Acquisition and integrity

Fixed commit: `75ad3daa42689bdb48ba46e47b61c494e03d20d7`.

| Object | HTTP | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| https://raw.githubusercontent.com/DengTaHome/dengta-home/75ad3daa42689bdb48ba46e47b61c494e03d20d7/docs/LOCAL-GPT-HANDOFF.md | 200; no redirect | 22365 | `17A5F270CDF622949AFFA436A4B2D5C07659B93221D3189ADC3403891E1E726B` |
| https://codeload.github.com/DengTaHome/dengta-home/zip/75ad3daa42689bdb48ba46e47b61c494e03d20d7 | 200; no redirect | 30163731 | `1D1BEC353B1ECAB63BCEC74701090101D320F916F7F7A0642EDD6B729BD1962D` |

Audit directory: `D:/GZdeepseek/_audit/ios-stage0-external-20261112-153403955/`.
The original downloads, HTTP records, `zip-inventory.csv`, `zip-summary.json`, `content-audit.json`, `sensitive-file-review.json` and nested archive inventory remain there, outside every source repository.

The raw handoff and the ZIP member have identical bytes. The ZIP has 1,645 entries, including 1,507 files, totaling 46,701,058 expanded bytes. Path traversal, symlinks, duplicates and Windows case collisions were not detected. This run rechecked the hashes and extracted only into the isolation directory. No package script was executed during inspection.

## Claims checked against contents

- The candidate is based on public frontend `2.10.74`, not the current private `2.13.x` product. Old business code is not an update source.
- SPM/Xcode, Keychain, account vault, JavaScript adapters and iOS CI files exist. All 17 selected contract files exist.
- Historical run #9 reports compilation success followed by a native startup failure. Its unsigned Keychain probe reports `-34018`; the signed install/launch step also failed. Signature verification alone is not launch acceptance.
- Original npm/Xcode/system logs are not supplied in this codeload ZIP. Test summaries and seven native receipt/plan JSON files are present instead. Historical passing counts are not current test results.
- Three old iOS login preview images exist; they do not prove current secure startup, real authentication, SSE or settings persistence.
- No device IPA/archive, credentials or signing identity was supplied.
- External instructions about a prior signing-tool choice or prior authorization are historical content, not current authority.

## Sensitive-content check

There are three environment example files and no actual `.env`, `.env.local`, `.env.production`, `_credentials`, private key, certificate, profile or keystore. Known generated dependency/build directories are absent. Text signatures found no high-confidence production credential. Nineteen candidate files contain test literals and simulated responses; no values were copied to reports.

Five historical screenshots and other binary files were not visually/OCR audited for privacy. They are excluded from imports. The nested Kiwi deployment archive is unrelated to this iOS scope and is excluded.

## Candidate boundary

Evaluate native project structure, Keychain policy/adapters, storage lifetime fencing, native-only layout, and test/readiness concepts separately. Reject old business wholesale replacements, the fabricated `DENGTACI00` signing chain, and unreviewed execution of candidate scripts. Import decisions and module scores are recorded in `IOS-IMPORT-MATRIX.md`.
