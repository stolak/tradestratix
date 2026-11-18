# Asset Management — Architecture Assessment

## 1. Current application architecture

Modular monolith:

- **Client:** Vite + React + TypeScript (`client/`) — pages, AuthContext, permission-gated Sidebar.
- **API:** Express `/api/v1` — authenticate + `requirePermission`, snake_case `serialize`.
- **Services:** business logic + Prisma (`server/src/services`).
- **Data:** MySQL via Prisma; every operational row has `businessId`.
- **Branch:** `X-Branch-Id`, `UserBranch`, `branchAccess.branchScopeWhere` / `resolveWriteBranchId`.
- **Accounting:** sole posting path `createJournal` / `reverseJournal` / `postJournal` in `accounting.service.ts` (balanced lines, open period checks, idempotency keys, immutable posted entries).
- **Inventory:** sole mutation path `createStockMovement` / `allocateFefo` in `inventory.service.ts`.
- **Audit:** `writeAudit` → `AuditLog`.
- **Notifications:** `AppNotification` + `createNotification`.
- **Uploads:** multer memory → S3 (`middlewares/upload.ts`, fulfilment proof pattern).

## 2. Existing models to reuse (do not duplicate)

| Domain | Models |
|--------|--------|
| Tenant / org | `Business`, `Branch`, `BusinessSetting`, `BusinessCurrency` |
| Identity | `User`, `Employee`, `UserBranch`, `UserRole`, permissions |
| Suppliers / buy | `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceiptNote`, `GoodsReceiptItem`, `SupplierBill` |
| Inventory | `Warehouse`, `StockLot`, `StockMovement` |
| GL | `Account`, `JournalEntry`, `JournalLine`, `DefaultAccountSetting`, `AccountingPeriod` |
| Ops trail | `AuditLog`, `AppNotification` |
| Assets (starter) | `FixedAsset`, `DepreciationEntry` |
| Budgeting (keep separate UI) | `Budget`, `BudgetLine` |

## 3. Accounting posting architecture (reuse)

- **Entry point:** `createJournal(user, body, tx?, opts?)`.
- **Idempotency:** `idempotencyKey` or `sourceType` + `sourceId`.
- **Reversal:** `reverseJournal` → opposite lines, new key `reversal:{id}`.
- **Defaults:** `getDefaultAccountMap` / default-account catalog (type + ownership validated).
- **Asset-related keys already seeded:** `fixed_assets`, `accumulated_depreciation`, `depreciation_expense`.
- **Parent COA group:** `fixed_asset_ledgers` in default-parent-account service.

Asset events must always call this engine with `source_type` such as:

`asset_acquisition`, `asset_capitalisation`, `asset_cip_transfer`, `asset_improvement`, `depreciation`, `asset_impairment`, `asset_revaluation`, `asset_disposal`, `asset_opening_balance`.

## 4. Branch & tenant security

- Every asset query: `businessId = user.businessId` + branch scope.
- Writes: `resolveWriteBranchId`.
- Consolidated dashboards: only with existing consolidated / `branches.report_all` rules — never double-count CIP clearing or inter-branch attribution journals.
- Cross-business FKs rejected in services.

## 5. Approvals today (gap)

There is **no generic ApprovalWorkflow engine**. Approvals are **module-local status machines** (e.g. PO `pending_approval`, stock transfer approve/dispatch).

**Integration boundary for assets:** implement asset-local status workflows (`DRAFT` → `PENDING_APPROVAL` → …) with permission-gated transitions (`assets.*.approve`), mirroring procurement/transfer patterns. If a shared approval service is added later, wrap the same transitions.

## 6. Frontend reuse

- Layout / Sidebar / `ROUTES.ASSETS` / `can(perm)`.
- Forms: `form-grid`, `field`, `SearchSelect`, SweetAlert helpers.
- Tables: `table` + `table-wrap`, filter bars (see custody finance filters).
- Replace single `AssetsPage` tabs with nested asset navigation (dashboard, register, …) under the same route module, permission-gated.

## 7. Gaps vs target module

| Area | Current | Target gap |
|------|---------|------------|
| Categories | Free-text string | First-class `AssetCategory` + GL maps + threshold |
| Locations / custodian | Missing | Locations, assignment + custodian history |
| Lifecycle | `active` / `fully_depreciated` / `disposed` | Full op + financial status machines |
| Acquisition | Direct create ± bank/cash/equity | PO/GRN/bill/CIP/opening/donation + anti double-cap |
| CIP | Missing | Projects + cost accumulation + capitalise |
| Depreciation | Immediate post, SL only | Preview/approve/run; RB / UoP; books; period lock |
| Transfers | Missing | Branch/dept/location/custodian workflow |
| Maintenance | Missing | Requests/WOs + inventory issue |
| Impairment / reval | Missing | Controlled workflows + journals |
| Disposal | Status only | Full derecognition + gain/loss |
| Insurance / warranty | Notes only | Structured records + notifications |
| Verification | Missing | Campaigns + scan + discrepancy approval |
| Documents | Missing | S3 attachments on asset / events |
| Reports / dashboard | None | Real aggregates + GL reconciliation |
| Permissions | Minimal | Full matrix in `permissions.md` |
| Multi-book | Single implied book | Financial (+ optional tax) books |

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing `FixedAsset` rows | Evolve table in place; migrate string `category` → `categoryId`; keep codes unique per business |
| Editing accum. dep. from UI | Balances only updated by posted services; no PATCH of financial balances |
| Duplicate capitalisation of GRN value | `AssetCostAddition` with unique source refs |
| Float money | Continue `roundMoney` / Prisma `Decimal(18,4)` |
| Scope explosion | Strict phases; each phase leaves app green |

## 9. Proposed physical strategy

1. **Keep** table `fixed_assets` / model name `FixedAsset` (or alias `Asset` in services) to avoid orphaning Phase 6 data.
2. **Add** satellite tables for categories, locations, books, runs, CIP, transfers, maintenance, etc.
3. **Expand** default-account keys (impairment, disposal gain/loss, CIP, payable) with category overrides.
4. **Split** client into `Assets*` pages/components; keep Budgets on existing tab or Accounting.

## 10. Next step

Proceed to **Phase 1 — Foundation** after this assessment: Prisma expansions + categories + locations + enriched register + history + permission seed + register UI shell (no fake buttons).
