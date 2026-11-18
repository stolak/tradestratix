# Asset Management — Permissions

Enforce with `requirePermission` on every route; never trust the client.

## Matrix (target)

| Permission | Purpose |
|------------|---------|
| `assets.view` | Register, detail, dashboard read |
| `assets.create` | Create draft assets |
| `assets.update` | Edit non-financial permitted fields |
| `assets.approve` | Approve acquisition / capitalisation |
| `assets.acquire` | Create acquisition docs |
| `assets.capitalise` | Post capitalisation |
| `assets.depreciation.view` | View schedules / runs |
| `assets.depreciation.calculate` | Generate preview |
| `assets.depreciation.approve` | Approve run |
| `assets.depreciation.post` | Post run (maps from legacy `assets.post`) |
| `assets.transfer.view` / `.create` / `.approve` / `.dispatch` / `.receive` | Transfer workflow |
| `assets.maintenance.view` / `.create` / `.manage` / `.approve` | Maintenance |
| `assets.impairment.manage` | Impairment |
| `assets.revaluation.manage` | Revaluation |
| `assets.disposal.request` / `.approve` / `.post` | Disposal |
| `assets.verification.view` / `.manage` / `.resolve` | Physical verification |
| `assets.reports.view` | Reports |
| `assets.accounting.view` | Journals / reconciliation |
| `assets.settings.manage` | Categories, locations, books, thresholds |

## Legacy compatibility

Keep `assets.view`, `assets.create`, `assets.edit`, `assets.post`, `assets.*` working:

- `assets.post` ⇒ depreciation post  
- `assets.edit` ⇒ `assets.update`  
- Seed owner/MD with `assets.*`; finance roles with view + depreciation + accounting; ops with maintenance/transfer subsets  

Update `ROLE_ACCESS` in `seed.ts` and `docs/permissions-matrix.md` when seeding.
