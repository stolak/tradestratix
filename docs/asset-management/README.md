# Asset Management Module

Enterprise Fixed Asset Lifecycle Management for TradeStratix ERP.

## Status

**Phase 0 — complete.**  
**Phase 1 (Foundation) — complete.**  
**Phase 2 (Acquisition & capitalisation) — complete.**  
**Phase 3 (Depreciation engine) — complete.**  
**Phase 4 (Operations) — next.**

## Existing foothold (do not discard)

TradeStratix already has a **Phase 6 starter**:

| Piece | Location | Capability today |
|-------|----------|------------------|
| `FixedAsset` | `schema.prisma` | Code, name, string category, cost, salvage, useful life, straight-line only, accum. dep., status |
| `DepreciationEntry` | `schema.prisma` | Per-asset period label + amount + journal link |
| `asset.service.ts` | services | Create (+ optional GL acquisition), run straight-line dep, list |
| `/api/v1/assets` | routes | list/create/get/depreciation |
| `AssetsPage` | client | Register / Depreciate / Budgets (budgets stay separate) |
| Default accounts | `fixed_assets`, `accumulated_depreciation`, `depreciation_expense` | Global keys only |
| Permissions | `assets.view`, `assets.create`, `assets.post`, `assets.*` | Minimal |

This module **extends and hardens** that foothold into a full lifecycle product. It does **not** create a second ERP, GL, or inventory engine.

## Documentation index

| Doc | Purpose |
|-----|---------|
| [architecture.md](./architecture.md) | Integration map, reuse, gaps, risks |
| [data-model.md](./data-model.md) | Target Prisma entities (logical → physical) |
| [accounting-integration.md](./accounting-integration.md) | Journals, defaults, books, reversals |
| [depreciation.md](./depreciation.md) | Methods, runs, controls |
| [acquisition-and-capitalisation.md](./acquisition-and-capitalisation.md) | Procurement link, CIP hand-off |
| [permissions.md](./permissions.md) | RBAC matrix |
| [testing.md](./testing.md) | Test plan |
| [../implementation-progress.md](../implementation-progress.md) | Live progress log |

Further topic docs (transfers, maintenance, disposal, verification, reports, API, deployment) are added as each phase lands.

## Implementation sequence

0. Discovery & plan ← done  
1. Foundation (categories, locations, enriched register, history, permissions) ← done  
2. Acquisition & capitalisation (+ procurement classification) ← done  
3. Depreciation engine (books, preview, approve, post, reverse) ← done  
4. Operations (transfers, maintenance+inventory, insurance/warranty) ← **next**  
5. Advanced accounting (CIP, components, impairment, revaluation, disposal)  
6. Physical verification (QR/barcode campaigns)  
7. Dashboard & reports (+ GL reconciliation)  
8. Hardening (full tests, docs, production readiness)

## Non-negotiables

- All money via `Decimal` / `roundMoney` / `toDec` — no float math for money.
- All GL via `createJournal` / `reverseJournal` — no direct journal writes.
- Tenant + branch via existing `businessId` + `branchAccess`.
- Audit via `writeAudit`; notifications via `createNotification`.
- Documents via existing multer + S3 pattern (`upload` / proof services).
- Never hard-delete disposed / posted history.
