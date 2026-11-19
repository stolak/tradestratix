# Asset Management — Dashboard & Reports (Phase 7)

Aggregates only — **no new Prisma models**. All money via `roundMoney`; branch scope via `branchAccess.branchScopeWhereLoose`; GL via existing `trialBalance` / default account map.

## Endpoints

| Method | Path | Permission (any of) |
|--------|------|---------------------|
| GET | `/api/v1/assets/dashboard` | `assets.view`, `assets.reports.view` |
| GET | `/api/v1/assets/reports/register` | `assets.view`, `assets.reports.view` |
| GET | `/api/v1/assets/reports/gl-reconciliation` | `assets.accounting.view`, `assets.reports.view`, `assets.view` |
| GET | `/api/v1/assets/reports/depreciation-summary` | `assets.depreciation.view`, `assets.reports.view`, `assets.view` |

Optional query: `branch_id`, `as_at` (dashboard / recon), `category_id` / `financial_status` / `include_disposed` (register), `period_label` (dep summary).

## Dashboard

- **Summary:** active/disposed counts, total cost, accum. dep., accum. impairment, NBV  
- **Breakdowns:** by financial status, operational status, category, branch  
- **Workflow open counts:** dep runs, CIP projects, disposals, verification campaigns  

## Register report

Line-level register (cap 2000) with cost / accum. dep / accum. imp / NBV + totals. Defaults to non-disposed.

## GL reconciliation

Compares register aggregates to default-key trial balance balances:

- Fixed asset cost (`fixed_assets`)
- Accumulated depreciation / impairment
- CIP (`asset_cip` vs open capital projects)
- Derived NBV (cost − accum. dep − accum. imp)

`balanced` when max absolute difference &lt; 0.02. Category/asset account overrides are not rolled into default-key GL — differences may be timing, unposted runs, or alternate mappings.

## Depreciation summary

Runs for a period label (default current `YYYY-MM`) with included-line totals and posted total.

## Permissions

`assets.reports.view` — seed with:

```bash
cd server
npm run seed:phase7-perms
npm run test:assets:phase7
```

## UI

Assets → **Dashboard**: Overview · Register report · GL reconciliation · Depreciation summary.
