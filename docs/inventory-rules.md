# Inventory Rules

1. **Never** update stock quantities outside the inventory service.
2. Tracking mode on the product (batch, expiry, serial, variants, weight/length) drives required fields on receive/issue/sale.
3. Unit conversions use defined factors; invalid conversions are rejected.
4. FEFO applies when expiry tracking is enabled.
5. Stock in transit is not available in source or destination warehouses.
6. **Valuation vs allocation:** Business `inventoryValuation` (`fifo` / `weighted_average` / `specific_identification`) is the *accounting* intent for COGS/costing. Operational picking still uses **FEFO** when the product tracks expiry, otherwise **FIFO by lot receipt time**. Wiring valuation methods into COGS is not complete yet — do not assume WAC/FIFO accounting equals operational lot selection.
7. Confirmed sales orders reserve stock per lot (`SalesReservation`); free stock = on hand − reserved, excluding
   expired lots, non-available lots and `damaged` / `quarantine` warehouses. Reservations are released on
   cancellation, reallocation or expiry. See `multi-branch-fulfilment.md`.

## Product tracking modes (inventory identity)

| Mode | Product flags | Receive requires | Stock identity |
| --- | --- | --- | --- |
| none | neither batch nor expiry | — | Implicit `BULK` lot per variant+warehouse |
| batch+expiry | `trackBatch` and/or `trackExpiry` | `batch_number` / `expiry_date` as flagged | `StockLot` keyed by batch + expiry |
| serial | `trackSerial` | *(Phase 2 — not enforced yet)* | Planned `StockSerial` |

Warehouses do **not** override tracking mode; they only affect sellability via category.

## Goods receipts (GRN)

- Batch and expiry are **per GRN line**, not a single header value for the whole PO.
- The inventory service rejects receipts that omit required tracking fields.

## Sales returns (restock)

- Restock prefers the lots that fulfilled the original sale (`SalesReservation`), LIFO.
- Same warehouse → reuse `lot_id`; other warehouse → recreate identity via batch/expiry from the source lot.
- Tracked products without covering sale lots cannot restock until lots are resolved (or receive manually).
