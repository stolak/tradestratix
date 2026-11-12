# Accounting Rules

1. Every financially relevant transaction posts a **balanced** journal (debits = credits).
2. Posted journals are **immutable**; corrections use reversals or adjustment journals.
3. Posting is **idempotent** keyed by `sourceType` + `sourceId` (+ optional event).
4. Monetary amounts use `Decimal(18, 4)` storage and decimal-safe rounding to 2 for presentation where required.
5. Default account mappings are per-business (`DefaultAccountSetting`), resolved via the central default-account resolver (never hardcode account IDs).
6. Period locking blocks posts into locked periods / closed financial years (when configured).
7. Inventory valuation methods (FIFO / WAC / specific ID) are business-configured and feed COGS consistently.

## Sales revenue and cross-branch postings

- Sales orders recognise revenue, receivable, tax and cost of goods **per hand-over**, not at confirmation.
  Money received before hand-over is a customer deposit (liability). Legacy invoices keep `on_posting`.
- A journal belongs to one branch. Effects in several branches use **linked journals** through
  `inter_branch_clearing`, which nets to zero per completed cycle.
- Details and journal tables: `multi-branch-fulfilment.md`.

## Entity attribution on JournalEntry

Journal headers may optionally reference:

- `customerId` — customer-facing AR / sales / payments / advances
- `supplierId` — supplier-facing AP / receipts / payments
- `salesRepresentativeId` — commercial sales representative responsible (distinct from `createdById` / `postedById`). Every sales rep is an `Employee` (`SalesRep.employeeId`); identity is joined from Employee. Journals use the sales-rep id. Employee home branch ≠ transaction branch (active session / `X-Branch-Id`).

Rules:

- Fields are nullable; rent, depreciation, and bank charges typically leave them null.
- Populate only entities that legitimately belong to the transaction.
- Walk-in / anonymous cash sales should use the business Walk-in customer account when configured, and still set `salesRepresentativeId` when a rep generated the sale.
- Reversal journals copy entity references from the original entry.
- Branch attribution (`branchId`) is independent of partner/rep attribution.
- Referenced partners must belong to the same business; deletion of partners with journal history is restricted (`onDelete: Restrict`).

### Journal-level vs line-level

Current workflows create **one journal per independently attributable partner document** (invoice, customer payment, GRN, supplier payment). Header-level attribution is therefore accurate.

If a future payment batch settles multiple customers in one journal, either:

1. Split into one journal per customer (preferred, matches current payment APIs), or
2. Add line-level `customerId` / `supplierId` dimensions.

Do not put a single customer id on a multi-customer batch header.

## Default account catalog

Canonical keys live in `default-account.service.ts` (`DEFAULT_ACCOUNT_CATALOG`).  
APIs:

- `GET /accounting/default-accounts` — stored mappings
- `GET /accounting/default-accounts/catalog` — known keys
- `GET /accounting/default-accounts/status` — missing / valid / invalid
- `PUT /accounting/default-accounts` — upsert mapping

Missing or wrong-type mappings throw a clear configuration error and block posting when resolved as required.

UI: **Accounting → Default accounts** — status summary, category / issue filters, and account assignment
filtered by each key’s expected account type (`accounting.edit` or `settings.edit` to change).

## Entity ledgers

- `GET /accounting/journals?customer_id=&supplier_id=&sales_representative_id=&source_type=&from=&to=`
- `GET /accounting/ledgers/:entityType/:entityId` where `entityType` is `customer` | `supplier` | `sales_representative`
