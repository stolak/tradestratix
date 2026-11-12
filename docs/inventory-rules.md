# Inventory Rules

1. **Never** update stock quantities outside the inventory service.
2. Tracking mode on the product (batch, expiry, serial, variants, weight/length) drives required fields on receive/issue/sale.
3. Unit conversions use defined factors; invalid conversions are rejected.
4. FEFO applies when expiry tracking is enabled.
5. Stock in transit is not available in source or destination warehouses.
6. Valuation (FIFO / WAC / specific ID) is configured at business/inventory level and applied consistently with accounting.
7. Confirmed sales orders reserve stock per lot (`SalesReservation`); free stock = on hand − reserved, excluding
   expired lots, non-available lots and `damaged` / `quarantine` warehouses. Reservations are released on
   cancellation, reallocation or expiry. See `multi-branch-fulfilment.md`.
