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

## Implementation (Phase 3)

1. `AssetDepreciationBook` — default `financial` book auto-created  
2. `AssetDepreciationRun` — `previewed → approved → posted` (or `reversed`)  
3. `AssetDepreciationRunLine` — amount + skip/exception reasons; UoP `units_actual`  
4. Journals batched per branch; idempotency `depreciation_run:{runId}:{branch}`  
5. `DepreciationEntry` links `runId` / `runLineId` / `bookCode`; status `posted|reversed`  
6. Legacy `POST /assets/depreciation/run` still one-shots preview→approve→post  

API: `POST /assets/depreciation/runs/preview`, `.../approve`, `.../post`, `.../reverse`.

Budgets remain outside depreciation.
