# Asset Management — Operations (Phase 4)

Transfers, maintenance, insurance, and warranty — no CapEx GL on assignment moves.

## Transfers

Workflow: **draft → submit → approve → dispatch → receive** (or cancel).

- Header: from/to branch; lines: asset + optional to location / custodian / department.
- Receive updates `FixedAsset` location/branch/custodian and writes `AssetAssignmentHistory`.
- Status `transfer_pending` while in flight; no journal on location/assignment transfer.
- Permissions: `assets.transfer.view|create|approve|dispatch|receive`.

API: `/api/v1/assets/transfers` (+ `/:id/submit|approve|dispatch|receive|cancel`).

## Maintenance

Workflow: **request (draft → submit → approve)** → **work order (open → in_progress → completed)**; optional parts/labour costs.

- Starting a WO sets asset `operationalStatus` to `under_maintenance`; complete restores prior use.
- Parts costs call inventory `createStockMovement` (`movement_type: asset_maintenance`) — stock issue, not a second inventory engine.
- Permissions: `assets.maintenance.view|create|manage|approve`.

API: `/api/v1/assets/maintenance/requests`, `/work-orders`, `/:id/costs`.

## Insurance & warranty

- Policies and warranties hang off the asset; claims on insurance.
- Active cover syncs summary fields on `FixedAsset` (`insuranceCompany`, `insurancePolicy`, `insuranceExpiryDate`, `warrantyProvider`, `warrantyExpiryDate`).
- Managed under maintenance permissions (`assets.maintenance.manage` / view).

API: `/api/v1/assets/insurances`, `/warranties`, insurance claims approve/settle.

## UI

Assets → **Operations**: create/advance transfers, maintenance requests/WOs, register insurance & warranty.

## Tests

```bash
cd server
npm run seed:ops-perms
npm run test:assets:phase4
```
