# Permissions Matrix (Phase 1)

Actions: `view`, `create`, `edit`, `delete`, `approve`, `reject`, `post`, `reverse`, `export`, `print`

Default system roles: Business Owner, Managing Director, General Manager, Branch Manager, Warehouse Manager, Inventory Officer, Procurement Officer, Sales Manager, Sales Representative, Cashier, Accountant, Finance Manager, HR Manager, Payroll Officer, Auditor, Delivery Officer.

Business Owner receives all permissions. Other roles are seeded with module-appropriate grants; custom roles are supported.

## Sales fulfilment

| Permission | Purpose | Seeded to (besides owner / MD) |
| --- | --- | --- |
| `sales.fulfil` | Hand over goods from warehouses of your branch | GM, branch & sales managers (`sales.*`), warehouse manager, inventory officer, cashier |
| `sales.revenue_branch` | Book revenue to another branch | roles with `sales.*` |
| `sales.cancel` | Cancel an order / close it short | roles with `sales.*` |
| `sales.override_credit_limit` | Confirm beyond the customer's credit limit (reason required) | roles with `sales.*` |
| `fulfilment.reallocate` | Reallocate reservations, allocate backorders, run reservation expiry | GM, branch manager, warehouse manager, sales manager |

Permissions are enforced in routes and services; branch membership is also required to release stock from a
warehouse. See `multi-branch-fulfilment.md`.
