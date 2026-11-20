# Asset Management — API surface

Base: `/api/v1/assets`. All routes require auth + `requirePermission` (see [permissions.md](./permissions.md)). Static paths are registered **before** `/:id`.

## Register & foundation

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/` | List / create |
| GET/PATCH | `/:id` | Get / update (branch-scoped) |
| GET/POST | `/categories`, `/locations` | Settings |

## Acquisition

| Method | Path |
|--------|------|
| GET/POST | `/acquisitions` |
| POST | `/acquisitions/:id/submit` \| `/approve` \| `/capitalise` \| `/cancel` |

## Depreciation

| Method | Path |
|--------|------|
| GET | `/depreciation/entries`, `/depreciation/runs` |
| POST | `/depreciation/runs/preview`, `.../:id/approve`, `/post`, `/reverse` |

## Operations

| Method | Path |
|--------|------|
| Transfers | `/transfers` + submit / approve / dispatch / receive / cancel |
| Maintenance | `/maintenance/requests`, `/maintenance/work-orders` (+ lifecycle) |
| Cover | `/insurances`, `/warranties` |

## Advanced accounting

| Method | Path |
|--------|------|
| CIP | `/capital-projects` (+ costs, capitalise, cancel) |
| Impairment / reval | `/impairments`, `/revaluations` (+ `/post`) |
| Disposal | `/disposals` + submit / approve / post / cancel |
| Components | `/components` |

## Verification

| Method | Path |
|--------|------|
| Campaigns | `/verification/campaigns` + open / scan / close / **cancel** |
| Resolve | `/verification/results/:id/resolve` |

## Dashboard & reports (Phase 7)

| Method | Path |
|--------|------|
| GET | `/dashboard` |
| GET | `/reports/register` |
| GET | `/reports/gl-reconciliation` |
| GET | `/reports/depreciation-summary` |

List endpoints for Phase 4–6 entities are **branch-scoped** via `branchScopeWhereLoose` (direct `branchId` or via related `FixedAsset`).
