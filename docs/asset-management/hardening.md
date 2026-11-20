# Asset Management — Hardening (Phase 8)

Production readiness checklist after Phases 0–7.

## Controls hardened

| Area | Behaviour |
|------|-----------|
| Branch scope | Phase 4–6 lists (CIP, impairment, reval, disposal, maintenance, insurance/warranty, components, verification) use `branchScopeWhereLoose` |
| SoD | Disposal approve only from `pending_approval`; maintenance approve only from `submitted`; impairment/reval/disposal UI is draft → step actions (not one-click post) |
| Notifications | `createNotification` on acquisition / transfer / disposal submit & approve |
| UI RBAC | Assets tabs filtered by `can(...)` |
| Verification | Cancel campaign exposed in API + UI for draft/open |

## Regression

```bash
cd server
npm run test:assets:all
# or individually:
npm run test:assets
npm run test:assets:phase2
npm run test:assets:bulk
npm run test:assets:phase3
npm run test:assets:phase4
npm run test:assets:phase5
npm run test:assets:phase6
npm run test:assets:phase7
npm run test:assets:phase8
```

Seed missing permissions if needed: `seed:phase5-perms` … `seed:phase7-perms`, `seed:asset-extra-perms`, `seed:ops-perms`.

## Ops notes

- Never hard-delete disposed / posted history.
- Money via `roundMoney` / `toDec`; GL only via `createJournal` / `reverseJournal`.
- Document upload UI remains optional polish (API/storage pattern already shared with proofs).
- Lazy-load per tab is optional UX; current page loads with `.catch(() => [])` resilience.

## Go-live checklist

- [ ] Permissions seeded for all roles that touch assets
- [ ] Default accounts mapped (`fixed_assets`, accum. dep/imp, CIP, disposal gain/loss, dep expense)
- [ ] Branch memberships correct for ops users
- [ ] `npm run test:assets:all` green against target DB
- [ ] Spot-check GL reconciliation on Dashboard after a capitalise + dep run
