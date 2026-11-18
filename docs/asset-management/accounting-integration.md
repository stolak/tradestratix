# Asset Management — Accounting Integration

## Engine

All postings go through `createJournal` / `reverseJournal` in `accounting.service.ts`.

Requirements enforced by that engine (do not bypass):

- Balanced debits/credits  
- Open accounting period  
- Active accounts, correct types  
- Idempotency keys  
- Immutable posted entries  
- Branch on entry where required  

## Default account keys

### Existing

| Key | Use |
|-----|-----|
| `fixed_assets` | Cost (fallback) |
| `accumulated_depreciation` | Contra (fallback) |
| `depreciation_expense` | Expense (fallback) |

### Add in Phase 2+

| Key | Type | Use |
|-----|------|-----|
| `asset_cip` | asset | Capital WIP |
| `accumulated_impairment` | asset (contra) | Impairment |
| `impairment_expense` | expense | Impairment loss |
| `asset_disposal_gain` | income/revenue | Gain on disposal |
| `asset_disposal_loss` | expense | Loss on disposal |
| `asset_acquisition_payable` | liability | Unpaid capitalisation |

Category-level overrides win over business defaults; asset-level overrides win over category.

## Illustrative postings

| Event | Dr | Cr |
|-------|----|----|
| Acquire (cash/bank) | Fixed asset cost | Cash/Bank |
| Acquire (credit) | Fixed asset cost | AP / acquisition payable |
| CIP spend | CIP | Bank/AP/Inventory |
| Capitalise CIP | Fixed asset cost | CIP |
| Depreciation | Dep expense | Accum. dep. |
| Impairment | Impairment expense | Accum. impairment |
| Dispose | Bank + Accum.dep (+ Accum.imp) | Cost (+ Gain) / or Loss |

Inter-branch transfer of assignment: **no disposal**. If branch P&L attribution is required, use paired clearing journals that **net to zero on consolidation** (same pattern as fulfilment COGS).

## Idempotency key patterns

- `asset_acquisition:{assetId}`  
- `asset_capitalisation:{capitalisationId}`  
- `asset_cip_xfer:{projectId}:{assetId}`  
- `depreciation_run:{runId}` or per line `depreciation:{runId}:{assetId}`  
- `asset_impairment:{id}`  
- `asset_revaluation:{id}`  
- `asset_disposal:{id}`  
- `reversal:{journalId}` via existing reverse helper  

## Reconciliation

Period close report: asset cost − accum.dep − accum.impairment (by branch/book) vs GL trial balance for mapped accounts. Differences must be explainable (timing, unposted runs).
