# Accounting Rules

1. Every financially relevant transaction posts a **balanced** journal (debits = credits).
2. Posted journals are **immutable**; corrections use reversals or adjustment journals.
3. Posting is **idempotent** keyed by `sourceType` + `sourceId` (+ optional event).
4. Monetary amounts use `Decimal(18, 4)` storage and decimal-safe rounding to 2 for presentation where required.
5. Default account mappings are per-business (`DefaultAccountSetting`).
6. Period locking blocks posts into closed periods (enforced when periods are configured).
7. Inventory valuation methods (FIFO / WAC / specific ID) are business-configured and feed COGS consistently.
