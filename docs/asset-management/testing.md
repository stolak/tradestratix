# Asset Management — Testing Plan

## Conventions

- Follow existing server test scripts (`npm run test:*`).  
- Assert money with decimal-safe comparisons (±0.01).  
- Cover tenant isolation, branch scope, RBAC denial, idempotent re-post, rollback on journal failure.

## Phase gates

| Phase | Minimum automated coverage |
|-------|----------------------------|
| 1 | Create/update asset; duplicate code; category FK; branch scope; permission 403 |
| 2 | Capitalise; double-cap blocked; journal balanced; unapproved rejected |
| 3 | SL / RB / UoP math; residual floor; available-for-use; duplicate period; closed period; reverse |
| 4 | Transfer history; maintenance stock issue via inventory service |
| 5 | Impairment/disposal gain-loss; CIP transfer; no delete disposed |
| 6 | Verification mismatch does not mutate register without resolve |
| 7 | Dashboard totals match DB aggregates for fixture set |
| 8 | Regression: existing sales/banking/accounting tests still pass |

## Manual / UAT

End-to-end: acquire → capitalise → dep run → transfer → maintain → dispose → GL reconcile.
