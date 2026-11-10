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

## Later phases (modelled)

- Phase 2–5: products/inventory, procurement/AP, sales/AR, banking/expenses
- Phase 6: `FixedAsset`, `DepreciationEntry`, `Budget`, `BudgetLine`
- Phase 7: `Employee`, `AttendanceRecord`, `LeaveRequest`, `PayrollRun`, `PayrollItem`
- Phase 8: `Vehicle`, `DeliveryOrder`, `DeliveryOrderItem`
- Phase 9: `AppNotification` (+ existing `SubscriptionPlan` / `BusinessSubscription`)

