# Implementation Progress

Updated: 2026-11-10

## Completed

- Phase 1 foundation (auth, multi-tenancy, branches, warehouses, RBAC, GL core, client shell)
- **Phase 2 — Products & Inventory**
  - Schema: categories, brands, UoM, products, variants, conversions, stock lots, movements, transfers
  - Inventory posting engine (sole path for qty changes): receive / issue / adjust with FEFO, batch/expiry rules, UoM conversion, idempotency
  - Stock transfer workflow: request → approve → dispatch (in transit) → receive
  - APIs under `/api/v1/products`, `/api/v1/uoms`, `/api/v1/inventory`
  - Client: Products, Inventory, Units pages; seed samples (Sparkle Cola expiry batches, Nike T-Shirt variants)

## Partially completed

- Transfer create UI (list/approve/dispatch/receive wired; create form still API-first)
- Role permission matrices beyond owner/auditor for inventory-heavy roles
- Weighted-average / FIFO valuation reports (lots store unit cost; valuation reports Phase 5+)

## Pending

- Phase 3: suppliers, procurement, GRN, AP
- Phase 4+: sales/POS, full AR, assets, HR/payroll, logistics, BI, SaaS

## Known issues

- Confirm `server/.env` `PORT` matches the client `VITE_API_URL` (project may use 5008 or 5009)

## Outstanding integrations

- SMS / WhatsApp, payment gateways, biometrics, S3 uploads
