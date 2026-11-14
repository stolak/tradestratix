# Inventory Rules

1. **Never** update stock quantities outside the inventory service.
2. Tracking mode on the product (batch, expiry, serial, variants, weight/length) drives required fields on receive/issue/sale.
3. Unit conversions use defined factors; invalid conversions are rejected.
4. FEFO applies when expiry tracking is enabled (non-serial products).
5. Stock in transit is not available in source or destination warehouses.
6. **Valuation vs allocation:** Business `inventoryValuation` (`fifo` / `weighted_average` / `specific_identification`) is the *accounting* intent for COGS/costing. Operational picking uses **FEFO** when the product tracks expiry, otherwise **FIFO by lot receipt time**, unless the user overrides the lot. **Serials are never auto-picked** — the operator must select exact available serial numbers on transfer, pick, quick release, or immediate sale. Wiring valuation methods into COGS is not complete yet — do not assume WAC/FIFO accounting equals operational lot selection.
7. Confirmed sales orders reserve stock per lot (`SalesReservation`); free stock = on hand − reserved, excluding
   expired lots, non-available lots and `damaged` / `quarantine` warehouses. Reservations are released on
   cancellation, reallocation or expiry. See `multi-branch-fulfilment.md`.

## Product tracking modes (inventory identity)

| Mode | Product flags | Receive requires | Stock identity |
| --- | --- | --- | --- |
| none | neither batch nor expiry nor serial | — | Implicit `BULK` lot per variant+warehouse |
| batch+expiry | `trackBatch` and/or `trackExpiry` | `batch_number` / `expiry_date` as flagged | `StockLot` keyed by batch + expiry |
| serial | `trackSerial` | Exactly N distinct `serial_numbers` (qty must be whole) | `StockSerial` (qty 1 each); optional parent `StockLot` when batch/expiry also on |

Warehouses do **not** override tracking mode; they only affect sellability via category.

### Serial lifecycle

`available` → `reserved` (explicit pick at pick / release / immediate sale) → `sold` (fulfilment)  
`available` → `in_transit` (transfer hold with explicit serials) → `available` at destination  
`sold` → `available` on restocking sales return (same invoice serials, LIFO)

Uniqueness: `(businessId, productId, serialNumber)`.

## Goods receipts (GRN)

- Batch, expiry, and serials are **per GRN line**, not a single header value for the whole PO.
- Serial lines: paste one serial per line (or comma-separated); count must equal remaining qty (base units).
- The inventory service rejects receipts that omit required tracking fields.

## Sales / fulfilment / transfer (issue)

| Tracking | User choice | If unspecified |
| --- | --- | --- |
| Batch / expiry (lot) | Optional lot override on pick, quick release, immediate sale, or transfer | System FEFO (expiry) or FIFO (receipt) |
| Serial | **Mandatory** selection from available serials | Rejected — never auto-assigned |

- Confirm (deferred pickup/delivery) reserves **lot quantity only**; serials bind at pick (or at quick release / hand-over if still unbound).
- Immediate (counter) sales: lot optional + serials required before confirm/hand-over.
- Transfer create: optional `lot_id`; required `serial_numbers` when `trackSerial`.
- Cancelling/releasing reservations returns unused serials to `available`.
- APIs: `GET /inventory/lots?product_id=&warehouse_id=`, `GET /inventory/serials?product_id=&warehouse_id=&lot_id=`.

## Sales returns (restock)

- Restock prefers the lots that fulfilled the original sale (`SalesReservation`), LIFO.
- Same warehouse → reuse `lot_id`; other warehouse → recreate identity via batch/expiry from the source lot.
- Serial products: sold serials from that invoice are flipped back to `available` at the return warehouse/lot.
- Tracked products without covering sale lots cannot restock until lots are resolved (or receive manually).
