# Asset Management — Data Model Plan

## Principles

- Reuse `Business`, `Branch`, `Employee`, `Supplier`, `Warehouse`, `Account`, `JournalEntry`, `AccountingPeriod`, `PurchaseOrder`, `GoodsReceiptNote`, `SupplierBill`.
- Evolve `FixedAsset` + `DepreciationEntry`; do not invent a parallel asset table for the same register.
- Financial balances on the asset are **service-owned** (updated only by posting workflows).
- Soft lifecycle: never hard-delete posted / disposed assets.

## Phase 1 (foundation) — create / extend

### Extend `FixedAsset`

Add (nullable where migration-safe):

- Identification: description, assetType, parentAssetId, manufacturer, model, serialNumber, barcode, qrPayload, photoUrl  
- Category: `categoryId` (FK) — keep legacy string `category` until backfill  
- Acquisition: source, supplierId, purchaseOrderId, grnId, supplierBillId, currencyCode, exchangeRate, freightCost, installationCost, otherCapitalCost, capitalisationDate, availableForUseDate  
- Financial policy: residualValue (= salvage), method, usefulLifeMonths, depreciationStartDate, bookCode (default `financial`)  
- GL overrides (nullable → fall back to category / defaults): costAccountId, accumDepAccountId, depExpenseAccountId, impairmentAccountId, disposalGainAccountId, disposalLossAccountId  
- Assignment: departmentId (string or future Dept), locationId, warehouseId, costCentre, custodianEmployeeId, condition, operationalStatus, financialStatus  
- Insurance/warranty summary fields (detail tables later)  
- Opening-balance flag + openingAccumDep / openingImpairment  
- `version` Int for optimistic concurrency  

Statuses:

- `operationalStatus`: draft | pending_approval | acquired | cip | available | in_use | under_maintenance | idle | transfer_pending | disposal_pending | disposed | archived  
- `financialStatus`: not_capitalised | capitalised | depreciating | fully_depreciated | impaired | disposed  
- Keep legacy `status` mapped/synced during transition  

### New models (Phase 1)

- **AssetCategory** — name, code, thresholds, default life/method/residual policy, account FKs, cipAccountId, active  
- **AssetLocation** — businessId, branchId?, code, name, active  
- **AssetAssignmentHistory** — assetId, from/to branch/location/dept/custodian/warehouse, changedAt, changedById, reason  
- **AssetDocument** — assetId, eventType?, storageKey, url, fileName, mime, uploadedById (S3)  
- **AssetStatusHistory** — assetId, field, fromValue, toValue, at, by  

### CapEx budgets (reuse `Budget` / `BudgetLine`)

- `BudgetLine.assetCategoryId` (optional) — Assets UI always sets this
- Create resolves `accountId` from `AssetCategory.costAccountId` when omitted
- Vs-actual for category lines = sum of capitalised asset costs in that category for the fiscal year (not raw GL drift)

## Later phases (logical entities)

| Phase | Models |
|-------|--------|
| 2 | AssetAcquisition, AssetCostAddition, AssetCapitalisation |
| 3 | AssetDepreciationBook, AssetDepreciationRun, AssetDepreciationRunLine (DepreciationEntry linked; schedule deferred) |
| 4 | AssetTransfer, AssetTransferLine, AssetMaintenanceRequest, AssetMaintenanceWorkOrder, AssetMaintenanceCost, AssetInsurance, AssetInsuranceClaim, AssetWarranty |
| 5 | CapitalProject, CapitalProjectCost, AssetComponent, AssetImpairment, AssetRevaluation, AssetDisposal, AssetAccountingEvent |
| 6 | AssetVerificationCampaign, AssetVerificationResult |

## Indexing / constraints

- `@@unique([businessId, code])` on assets and categories  
- Indexes: businessId+status, branchId, categoryId, custodianEmployeeId, availableForUseDate  
- FKs: Restrict delete when journal / run references exist  
- Same-business validation in services for all related IDs  

## Money

All monetary columns: `@db.Decimal(18, 4)` (match ERP). Calculations via `roundMoney`.
