# Acquisition & Capitalisation Design

## Sources (Phase 2)

1. Direct purchase (cash/bank) — exists today  
2. On credit (AP / acquisition payable)  
3. From PO / GRN / supplier bill (user classifies line as asset)  
4. Opening balance (migrated NBV + cost + accum)  
5. Donation / capital contribution  
6. Completed CIP project  
7. Configurable other  

## Workflow

`DRAFT → PENDING_APPROVAL → APPROVED → CAPITALISED → AVAILABLE_FOR_USE`

Depreciation must not start until available-for-use.

## Bulk / serialised units

One acquisition can capitalise **N individual `FixedAsset` rows** (same name/model/category, different economics per lot):

- Enter **quantity** + **unit cost** (lot purchase = unit × qty). Freight/install allocated across units.
- Paste **one unique serial per unit** (required when qty > 1). Serials are unique per business.
- On capitalise, auto-assign tags `{CATEGORY}-{YYYY}-{####}` (e.g. `COMPUTER-2026-0001`).
- One GL journal for the lot; N capitalisation rows (one per asset).
- A later purchase of the same model is a **new acquisition** with its own date/cost/serials.

## Procurement rules

- Classification is explicit (inventory | expense | fixed asset) — never auto-all-to-asset.  
- One PO/GRN can spawn many assets; one asset can accumulate many cost additions.  
- `AssetCostAddition` unique on `(businessId, sourceType, sourceId, sourceLineId)` prevents double capitalisation.  
- Journals only after approval / capitalise action via `createJournal`.

## CIP (Phase 5)

Accumulate on `CapitalProject` → approve completion → create asset(s) → Dr cost / Cr CIP → set available-for-use.
