# Asset Management — Advanced Accounting (Phase 5)

CIP projects, components, impairment, revaluation, and disposal — all GL via `createJournal`.

## CIP (`CapitalProject`)

1. Create project → add costs (Dr CIP / Cr bank|cash|payable|equity|inventory)  
2. Complete → capitalise (Dr fixed asset / Cr CIP; creates `FixedAsset`, `acquisitionSource=cip`)  
3. Idempotency: `asset_cip_spend:{costId}`, `asset_cip_xfer:{projectId}:{assetId}`

## Components

`AssetComponent` links a parent asset to a named component (optional child register asset via `parentAssetId`). Memo cost only — no automatic cost split GL in Phase 5.

## Impairment

Draft → post: Dr `impairment_expense` / Cr `accumulated_impairment`; updates `FixedAsset.accumulatedImpairment` and `financialStatus=impaired`. Amount cannot exceed NBV.

## Revaluation

Draft → post to a target carrying amount:

- **Uplift:** Dr cost / Cr `asset_revaluation_surplus` (falls back to equity)  
- **Decrease:** Dr impairment expense / Cr cost  

Adjusts `purchaseCost` so NBV moves by the adjustment.

## Disposal

Draft → submit → approve → post. Clears cost, accum. dep., accum. impairment; records proceeds and gain/loss. Sets asset `disposed` (never hard-delete). Idempotency: `asset_disposal:{id}`.

## Permissions

`assets.impairment.manage`, `assets.revaluation.manage`, `assets.disposal.request|approve|post`, `assets.accounting.view`  
CIP reuses `assets.acquire` / `assets.capitalise`.

```bash
cd server
npm run seed:phase5-perms
npm run seed:asset-coa   # includes 3205 revaluation surplus
npm run test:assets:phase5
```

## UI

Assets → **Accounting**: CIP | Impairment | Revaluation | Disposal | Components.
