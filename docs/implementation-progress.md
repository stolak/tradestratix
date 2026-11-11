# Implementation Progress

Updated: 2026-11-11

## Completed

- **System role privilege + menu seeding**
  - `ROLE_ACCESS` matrix grants each system role appropriate permissions and menus
  - Re-seed replaces role_permissions / role_menus for system roles (owner/MD full; auditor view/export; ops roles scoped)
- **SalesRep ↔ Employee linkage**
  - `SalesRep` is commercial-only (commission/status/code); name/phone/email come from `Employee`
  - Employee must exist first; promote via Sales Reps page or `is_sales_rep` on HR create
  - Every employee gets a User login; home branch required (HQ if omitted)
  - `User.defaultBranchId` = employee home branch; session `X-Branch-Id` is transaction branch only
  - Backfill: `npm run backfill:employee-users`
  - Tests: `npm run test:sales-rep-employees`
- **Journal entity attribution + default account resolver**
  - `JournalEntry`: nullable `customerId`, `supplierId`, `salesRepresentativeId` (+ indexes)
  - Central default-account catalog/resolver with ownership, active, and type validation
  - Posting engine validates entities, rejects inactive accounts, copies attribution on reverse
  - Sales/procurement journals stamp customer/supplier/rep where applicable
  - APIs: default-accounts catalog/status/upsert; journal filters; entity ledgers
  - Client: Accounting → Default accounts (status + assign); Journals show customer/supplier/rep
  - Backfill: `npm run backfill:journal-entities`
  - Tests: `npm run test:journal-entities` (13 passed)
- **Multi-branch architecture (cross-cutting)**
  - Enhanced `UserBranch` membership (businessId, roleCode, status, assignedAt/By)
  - `branchId` on operational docs; stock transfers keep `fromBranchId`/`toBranchId`
  - Auth: `X-Branch-Id`, DB membership revalidation, `POST /auth/switch-branch`
  - Branch deactivate (cannot remove last active); membership assign/revoke APIs
  - Client branch switcher remounts scoped views
  - Tests: `npm run test:branches` (11 assertions)
- Phase 1–5 (foundation through banking/expenses/statements)
- **Phase 6 — Assets, depreciation, budgeting**
  - FixedAsset register with optional acquisition journal
  - Straight-line depreciation run → GL + DepreciationEntry
  - Budgets with vs-actual against posted journals
  - Client: Assets page (Register / Depreciate / Budgets)
- **Phase 7 — HR, attendance, payroll**
  - Employees, attendance upsert, leave approve/reject
  - Payroll runs from active salaries; post accrual + pay disbursement
  - Client: HR + Payroll pages
- **Phase 8 — Distribution / logistics**
  - Vehicles, delivery orders (from invoice or manual lines)
  - Workflow: draft → schedule → dispatch → delivered / cancel
  - Client: Distribution page
- **Phase 9 — BI, notifications, SaaS, mobile**
  - `/bi/insights` cross-module KPIs
  - In-app notifications list / mark read
  - Subscription plans + current subscription UI
  - `/mobile/*` field endpoints (home, deliveries)

## Partially completed / deferred polish

- Bank reconciliation / statement import
- Multi-line expense builders (API ready)
- Inventory valuation reports; sales returns; advances
- SMS / WhatsApp, payment gateways, biometrics, S3 uploads
- Native mobile apps (API surface ready)

## Known issues

- Confirm `server/.env` `PORT` matches the client `VITE_API_URL` (project may use 5008 or 5009)
