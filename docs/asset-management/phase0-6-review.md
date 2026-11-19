# Asset Management — Phase 0–6 smoke test & review

Date: 2026-11-19

## Smoke tests

All existing automated gates passed:

| Script | Result |
|--------|--------|
| `test:assets` (phase 1) | 14 passed |
| `test:assets:phase2` | 12 passed |
| `test:assets:bulk` | 12 passed |
| `test:assets:phase3` | 19 passed |
| `test:assets:phase4` | 19 passed |
| `test:assets:phase5` | 20 passed |
| `test:assets:phase6` | 13 passed |
| **Total** | **109 passed** |

## What is solid

- GL only via `createJournal` / `reverseJournal`; money via `roundMoney` / `toDec`
- No hard-delete of disposed / posted history
- Register PATCH blocks direct cost / accum. dep. edits
- Route order: static paths before `/:id`
- Phase 6: scan does not mutate register; only `correct_register` resolve does
- Transfers: no GL on assignment move; maintenance parts via inventory stock issue

## Fixes applied in this review

1. **Legacy create GL** — posting on `POST /assets` now requires `assets.capitalise` / `assets.post` (prefer acquisition workflow)
2. **Acquisition SoD** — approve only from `pending_approval` (not draft); UI Approve removed from draft
3. **Branch scope** — `get` / `update` asset enforce branch access (loose for null historical branch)
4. **Verification scan RBAC** — removed `assets.view` from scan route
5. **Disposal UX** — require explicit bank account when proceeds &gt; 0
6. **Verification resolve UX** — action picker (`correct_register` / `accept_found` / `ignore` / `mark_missing`)
7. **Permissions seed** — `assets.acquire`, `capitalise`, `settings.manage`, `depreciation.view` / `.post` added to `EXTRA_PERMISSIONS` + `npm run seed:asset-extra-perms`
8. **Load resilience** — depreciation entries fetch uses `.catch(() => [])`
9. **Transfer UI** — Approve only when `pending_approval`

## Remaining (acceptable before Phase 7; harden in Phase 8)

| Priority | Item |
|----------|------|
| HIGH | Branch-scope remaining Phase 4–6 list endpoints |
| HIGH | Permission-aware tab/action gating in UI |
| MEDIUM | Empty states on all tables; document upload UI |
| MEDIUM | Split impairment/revaluation/disposal into step buttons for SoD |
| MEDIUM | `createNotification` on submit/approve |
| LOW | Lazy-load per tab; cancel campaign button |

## Verdict

Phases 0–6 are **safe to proceed to Phase 7** after the fixes above. Core accounting and verification rules hold; remaining items are polish / hardening for Phase 8.
