# Depreciation Design

## Methods (Phase 3)

### None (non-depreciable)

Used for **freehold land** and similar items with unlimited useful life.

- **IAS 16:** land and buildings are separable; land is generally not depreciated (exceptions: quarries, landfill, depleting sites).
- **US GAAP (ASC 360):** land is not depreciated; land *improvements* (parking, fencing, etc.) are depreciated separately.
- System: `depreciation_method = none` and/or `useful_life_months = 0` → depreciation runs skip the asset. Carrying amount stays at cost (subject to impairment later).

### Straight-line

`depreciable = cost - residual`  
`periodAmount = depreciable / usefulLifePeriods`  
Never take book value below residual.

### Reducing balance

`periodAmount = openingCarrying × rate`  
Cap so carrying ≥ residual.

### Units of production

`perUnit = (cost - residual) / estimatedTotalUnits`  
`periodAmount = perUnit × actualUnits` (from meter entry on run line).

## Controls

- No dep before `availableForUseDate` / `depreciationStartDate`  
- No dep if disposed / not capitalised  
- No duplicate `(asset, book, period)`  
- Closed `AccountingPeriod` rejected  
- Preview → approve → post (posted run immutable; fix via reverse + new run)  
- Use `roundMoney`; residual floor  

## Evolution from today

Current `runDepreciation` posts immediately per asset with `periodLabel` `YYYY-MM`. Phase 3 introduces:

1. `AssetDepreciationRun` (draft/preview/approved/posted)  
2. Lines with calculated amount + exceptions  
3. Single or batched journals with run-level idempotency  
4. Optional link from existing `DepreciationEntry` rows as historical lines  

Budgets remain outside depreciation.
