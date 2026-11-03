# QA process quick reference

## Defect severity
- **P0 Blocker:** data loss/corruption, security/privacy exposure, app cannot perform core field collection.
- **P1 Critical:** core workflow broken with no safe workaround, widespread crash/ANR, sync duplication.
- **P2 Major:** important function degraded with workaround.
- **P3 Minor:** cosmetic or low-impact usability issue.

Severity and release priority should be agreed with product/engineering and applied consistently.

## Release gate
1. Build and schema/API version identified.
2. PR smoke green.
3. Critical offline save and sync recovery tests green.
4. Dynamic form / validation / HFC regression green.
5. Target-device crash/ANR and network checks reviewed for release candidate.
6. No unresolved P0/P1 without documented risk acceptance.
7. Evidence, known issues and rollback plan attached.

## Metrics
Track escaped defects, time-to-detect, time-to-resolve, critical-flow coverage, test flake rate, crash-free sessions, ANR rate, sync success/retry rate, duplicate event rate and oldest pending sync age.
