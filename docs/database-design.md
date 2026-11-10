# Database Design (Phase 1 foundation)

Provider: **MySQL** via Prisma. Identifiers: prefixed short UUIDs (`biz-…`, `usr-…`).

## Tenant & organisation

- `Business` — tenant root (type, currency, FY, tax/invoice settings)
- `Branch` — unlimited outlets per business (subscription-limited later)
- `Warehouse` — one or many per branch
- `BusinessSetting` — key/value config
- `SubscriptionPlan` / `BusinessSubscription` — SaaS stubs

## Identity & access

- `User` — belongs to one business; optional default branch
- `Role`, `Permission`, `Menu`
- `UserRole`, `RolePermission`, `RoleMenu`
- `UserPermissionOverride`
- `UserBranch` — branch-level data scope
- `LoginHistory`, `RefreshToken`

## Accounting core (Phase 1)

- `Account` — chart of accounts (**unique code per business**)
- `JournalEntry` / `JournalLine` — double-entry; posted journals immutable
- `DefaultAccountSetting` — maps logical keys (inventory, ar, ap, cash, cogs, sales…) to accounts
- `FinancialYear`, `AccountingPeriod` — period locking support

## Audit

- `AuditLog` — append-only

## Later phases (not fully modelled yet)

Products, stock ledgers, procurement, sales, HR/payroll, assets, logistics will extend this schema while reusing `businessId`, branches, warehouses, and the journal posting engine.
