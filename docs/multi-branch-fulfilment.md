# Multi-branch sales fulfilment

Status: **Phases 1–6 implemented** (order lifecycle, allocation, reservations, revenue at hand-over, warehouse
picking / pickup codes / delivery with POD + S3 proof attachments, sales returns and customer credit, order
amendment, fulfilment and clearing reports). Remaining polish is listed at the end.

## Concepts

| Concept | Field | Meaning |
| --- | --- | --- |
| Selling branch | `SalesInvoice.sellingBranchId` | Branch that made the sale: pricing, discounts, sales rep, who may confirm it. |
| Revenue branch | `SalesInvoice.branchId` | Branch whose books carry revenue, receivable, deposits and cost of goods. Defaults to the selling branch; another branch requires `sales.revenue_branch`. |
| Fulfilment warehouse | `SalesReservation.warehouseId` | Where each reserved quantity is picked. One line may be split across warehouses in several branches. |
| Fulfilling branch | `SalesFulfilment.branchId` | Branch of the warehouse that handed the goods over; its inventory is relieved. |

## Lifecycle

`status` keeps its existing values so reports keep working; the UI labels `posted` as **Confirmed**.

```
draft ──confirm──► posted (Confirmed) ──hand-overs──► fulfilmentStatus pending → partial → fulfilled
  │                     │
  └──cancel──► cancelled └──cancel (nothing collected) ──► cancelled
                        └──cancel (some collected)  ──► posted + fulfilled ("closed short")
```

Payment status (`open | partial | paid | void`) is independent and is computed against
`totalAmount − cancelledAmount`.

* **Confirm** (`POST /sales/invoices/:id/confirm`, alias `/post`)
  1. locks the customer row (`SELECT … FOR UPDATE`) and checks credit exposure;
  2. reserves stock (see allocation);
  3. sets `reservationExpiresAt` for pickup orders (`sales.reservation_days`, default 14, 0 = never);
  4. creates the commission row with a zero base;
  5. records pay-now money (deposit for pickup, settlement for counter sales).
  No revenue journal is posted.
* **Counter sale** (`fulfilment_mode = immediate`, always for POS): reservations are restricted to the selling
  branch, no backorder is allowed, and everything is handed over in the same transaction.
* **Pickup** (`fulfilment_mode = pickup`): goods are handed over later from the Pickups page by staff of the
  warehouse's branch (`sales.fulfil` + branch membership).

## Allocation engine (`stock-allocation.service.ts`)

Free stock = on hand − reserved, excluding expired lots of expiry-tracked products, lots whose status is not
`available`, warehouses in category `damaged` / `quarantine`, and inactive warehouses or branches.

Order of preference per line:

1. the manual split saved on the draft (`SalesInvoiceItem.allocationPlan`, line UoM), validated against free
   stock and the ordered quantity;
2. otherwise the line's warehouse, then the order's default warehouse;
3. other warehouses of the preferred branch;
4. remaining warehouses with the most free stock (fewest locations).

Free stock is shared across lines of the same order so two lines for one variant cannot double-count it.
Within a warehouse lots are taken FEFO (expiry-tracked) or FIFO.

`POST /sales/allocation-preview` returns the suggested split and per-warehouse free stock (read-only). The Sales
page shows it under the lines and lets the user overwrite quantities (manual split).

### Shortage and backorder

If free stock cannot cover a line the confirmation fails with the shortage per product. Pickup orders can be
confirmed with `allow_backorder: true`: everything available is reserved and the rest stays open.
`POST /sales/invoices/:id/allocate` reserves newly available stock for backordered quantities.

## Reservations (`SalesReservation`)

One row per reserved lot: `quantity` (base UoM), `fulfilledQuantity`, `releasedQuantity`, `status`
(`active | fulfilled | released`), `method` (`auto | manual | reallocation | backorder`), creator, releaser,
`releaseReason` (`cancelled | expired | reallocated | discrepancy | manual`).

Concurrency: reserving uses a guarded update

```sql
UPDATE stock_lots SET quantity_reserved = quantity_reserved + :q
 WHERE id = :lot AND quantity_on_hand - quantity_reserved >= :q
```

so two orders competing for the same stock cannot both succeed (the loser gets 400/409 and nothing is written).

* **Reallocate** (`POST /invoices/:id/reallocate`, `fulfilment.reallocate`, reason required): releases a line's
  (or the order's) reservations in one warehouse and re-reserves elsewhere — automatically, or to
  `to_warehouse_id`. The old rows remain as `released / reallocated` for audit.
* **Expiry**: a sweeper in `server.ts` (every 15 min, `RESERVATION_SWEEP_MS`) and
  `POST /sales/reservations/expire` release reservations of pickup orders past `reservationExpiresAt`. The order
  stays confirmed with the quantity backordered; the confirming user gets an in-app notification.

## Revenue recognition — at hand-over

New invoices carry `recognitionPolicy = at_fulfilment`. Each hand-over (`SalesFulfilment`) recognises the share of
the order it delivers:

* line value = `lineTotal × totalAmount / subtotal` (customer discount and tax spread over lines);
* recognised for a line = value × collected / ordered, with the closing hand-over taking the rounding remainder;
* tax share = recognised × taxAmount / totalAmount when `tax_payable` is mapped.

Journal in the **revenue branch** (`sales_revenue:<fulfilmentId>`):

| Dr | Cr |
| --- | --- |
| Accounts receivable — recognised | Sales revenue — net |
| | Tax payable — tax share |
| Customer deposits — deposit applied | Accounts receivable — deposit applied |

Invoice: `recognisedAmount +=`, `depositHeld −= applied`, `balance += recognised − applied`. The sales rep's
commission base and amount grow by the recognised value (percentage snapshotted at confirmation).

Legacy invoices posted before this change are marked `recognitionPolicy = on_posting` by
`npm run backfill:fulfilment` (idempotent, `--dry` to preview); their hand-overs only book cost of goods.

## Cost of goods and inter-branch clearing

Cost of goods posts per hand-over against the revenue branch.

* Warehouse in the revenue branch: one journal `Dr COGS / Cr Inventory`.
* Warehouse in another branch: two linked journals —
  fulfilling branch `Dr Inter-branch clearing / Cr Inventory`;
  revenue branch `Dr COGS / Cr Inter-branch clearing`.

`JournalEntry` has a single `branchId`, so cross-branch effects always use linked journals through account
`1150 Inter-branch Clearing` (`inter_branch_clearing`). Across a full cycle clearing nets to zero.

Journals for other branches are created with `createJournal(…, tx, { trustedBranch: true })` — a code-only flag
(never read from a request body) that skips the poster's branch-membership check but still requires an active
branch of the same business.

## Payments, deposits and customer credit (`customer-payment.service.ts`)

One engine (`applyPaymentInTx`) serves pay-now at confirmation and counter receipts:

* each allocation first settles the invoice's recognised `balance` (Cr AR); the excess, up to the order value
  still payable, is a **customer deposit** (Cr `customer_deposits`, liability) and raises `depositHeld`;
* an unallocated remainder is kept as **unapplied customer credit** (Cr `unapplied_customer_receipts`) when
  `allow_unallocated` is set;
* cash is booked in the receiving branch; AR/deposit lines are booked in each invoice's revenue branch, linked by
  clearing when different. A customer can therefore pay invoices of several branches in one receipt;
* auto-allocation (no explicit allocations) settles recognised balances oldest-first across all branches;
* `idempotency_key` makes retries return the original payment; invoice rows are locked `FOR UPDATE`.

## Cancellation (`POST /invoices/:id/cancel`, `sales.cancel`, reason required)

* Draft: status `cancelled`.
* Confirmed: cancels the uncollected quantity of all lines (or `lines: [{ invoice_item_id, quantity }]`);
  backordered quantity is cancelled before reserved stock is released.
  `cancelledAmount` is recomputed from line values. A deposit exceeding the remaining open value first settles any
  recognised balance (Dr deposits / Cr AR), the rest becomes unapplied customer credit
  (Dr deposits / Cr unapplied receipts) — `releasedAmount` on the allocations, `unappliedAmount` on the payment,
  `amountPaid` reduced. Nothing collected → `cancelled` (+ accrued commission voided); otherwise closed short.
* Legacy `on_posting` invoices cannot be cancelled this way (they need a credit note — later phase).

## Credit exposure

Exposure = Σ recognised balances + Σ open order value
(`max(0, total − cancelled − recognised − depositHeld)` over confirmed, not fully fulfilled `at_fulfilment`
orders). It is checked inside the confirmation transaction against `Customer.creditLimit` for the part not paid now.
`sales.override_credit_limit` with `override_reason` allows confirming beyond the limit; the user and reason are
stored on the invoice and in the audit log. Customer APIs return `outstanding_balance`, `open_order_value` and
`available_credit`.

## Permissions

| Permission | Purpose | Seeded to |
| --- | --- | --- |
| `sales.post` / `sales.approve` | Confirm orders | existing roles |
| `sales.fulfil` | Release goods from your branch's warehouses | GM, branch/sales managers (via `sales.*`), warehouse manager, inventory officer, cashier |
| `sales.revenue_branch` | Book revenue to another branch | via `sales.*` |
| `sales.cancel` | Cancel / close short | via `sales.*` |
| `sales.override_credit_limit` | Confirm beyond credit limit | via `sales.*` |
| `fulfilment.reallocate` | Reallocate, allocate backorders, run expiry | GM, branch manager, warehouse manager, sales manager |

All checks are enforced in routes (`requirePermission`) and services (branch membership); the client only hides
actions.

## API summary

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/sales/invoices` (items may carry `allocations: [{ warehouse_id, quantity }]`) | `sales.create` |
| POST | `/sales/invoices/:id/confirm` (`pay_now`, `amount_paid`, `allow_backorder`, `override_credit`, `override_reason`) | `sales.post` |
| POST | `/sales/invoices/:id/cancel` | `sales.cancel` |
| POST | `/sales/invoices/:id/reallocate` | `fulfilment.reallocate` |
| POST | `/sales/invoices/:id/allocate` | `fulfilment.reallocate` or `sales.post` |
| POST | `/sales/allocation-preview` | `sales.create` |
| POST | `/sales/reservations/expire` | `fulfilment.reallocate` |
| GET | `/sales/fulfilment-options?product_ids=` | `sales.create` |
| GET | `/sales/fulfilments/pending`, `/sales/fulfilments`, `/sales/fulfilments/:id` | `sales.fulfil` |
| POST | `/sales/fulfilments` | `sales.fulfil` |
| POST | `/sales/payments` (`allocations`, `allow_unallocated`, `idempotency_key`) | `sales.post` |

## Tests

From `server/`: `npm run test:fulfilment` (service level, self-cleaning) — **100** checks covering Phases 1–5:
same/cross-branch pickup, allocation, shortage/backorder, cancel/close short, reallocation, credit override,
concurrent reservations, expiry, cross-branch receipt/idempotency, picking/POD, returns/credit, amend, reports,
POS regression, clearing nets to zero. Backfill: `npm run backfill:fulfilment` (also from `server/`).

## Warehouse fulfilment (Phase 3)

Warehouse tasks (`SalesFulfilment`) are separate from reservations. **Reserved** means active `SalesReservation`
rows; a fulfilment record is created when picking starts.

Statuses: `picking` → `ready_for_collection` (pickup) or `picked` → `dispatched` → `delivered` (delivery), or
`released` (collection). Short/damaged pick lines become `discrepancy` and release the reservation.
Accounting still posts only on release / deliver via `fulfilInTx`.

Pickup orders get a 6-digit `pickupCode` at confirmation (hidden from warehouse list views). Five wrong entries
lock the code until the selling/revenue branch reissues it (`POST /invoices/:id/pickup-code`). Collection records
collector details and acknowledgement. Delivery creates a linked `DeliveryOrder` and requires proof of delivery
(`received_by`) before stock and revenue post.

Proof files (JPEG / PNG / WebP / GIF / PDF, max 8 MB) upload to S3 via
`GET|POST /fulfilments/:id/proofs` and `DELETE /fulfilments/:id/proofs/:proofId`. Objects live under
`tradestratix/{businessId}/fulfilment/{fulfilmentId}/` using `AWS_*` env vars; the first URL fills
`SalesFulfilment.proofReference` / `DeliveryOrder.podReference` when empty. UI: **Pickups** Collect / Deliver
modals.

APIs: `POST /fulfilments/picking`, `…/:id/pick`, `…/:id/release`, `…/:id/dispatch`, `…/:id/deliver`,
`GET /fulfilments/dashboard`. UI: **Pickups** page.

## Sales returns and customer credit (Phase 4)

`SalesReturn` / `SalesReturnItem` reverse goods already handed over (`returnedQuantity` ≤ `fulfilledQuantity`).

* Receiving warehouse may be any authorised branch (including a different branch from the sale).
* Saleable / quarantine restock into matching warehouse categories; damaged restock requires a `damaged`
  warehouse, otherwise the cost is written off (`inventory_write_off`).
* Posting: Dr `sales_returns` + tax, Cr AR in the **revenue** branch; inventory / COGS reverse with clearing when
  the receiving branch differs. Commission base is reduced.
* Settlement: `credit_note` moves overpayment to unapplied customer credit; `refund` pays cash/bank.
* Legacy `on_posting` invoices can be corrected with returns (cancel-order is still blocked for them).

Unapplied credit: `GET /sales/customers/:id/credit`, `POST /sales/credits/apply`, `POST /sales/credits/refund`
(`sales.refund`). Sales page: Returns tab, **Return goods** on the invoice, Apply / Refund credit on Payments.

## Order amendment (Phase 5)

`POST /sales/invoices/:id/amend` (`sales.amend`, reason required) on confirmed `at_fulfilment` orders:

* Quantity down → cancels the uncollected difference (original ordered qty preserved via `cancelledQuantity`).
* Quantity up → recalculates totals, credit-checks (override supported), reserves the extra (backorder optional).
* Warehouse move → same path as reallocate (Sales **Reallocate** action; not duplicated in the amend dialog).
* Notes / delivery address / contact / phone → header-only updates (Invoice **Amend** dialog).
* Cannot change quantities already handed over (use a return). History in `SalesOrderAmendment`.

## Reports (Phase 5)

| Endpoint | Purpose |
| --- | --- |
| `GET /reports/inter-branch-clearing` | Clearing account lines by source pair; company net and open imbalances |
| `GET /reports/fulfilment-summary` | Pipeline counts (awaiting pick → delivered) and open pickup/delivery orders |
| `GET /reports/sales-by-branch` | Recognised revenue, returns, COGS and margin by revenue branch |

UI: Reports page tabs. Prefer `consolidated=1` for company-wide views.

## Not yet implemented (later phases)

* Serial-number reservation (serial tracking does not exist yet).
* Deeper branch-pair due-to / due-from subledger (today: single clearing account + source pairing).
