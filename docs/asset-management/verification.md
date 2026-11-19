# Asset Management — Physical Verification (Phase 6)

QR / barcode stock-count campaigns. **Scans never mutate the register**; only an explicit resolve with `correct_register` writes location/branch/custodian.

## Models

- `AssetVerificationCampaign` — draft → open → closed (or cancelled)
- `AssetVerificationResult` — expected | matched | mismatch | missing | unexpected | resolved

## Workflow

1. **Create** campaign (optional branch / location / category scope)
2. **Open** — snapshot in-scope non-disposed assets as `expected` rows; ensure `qrPayload` (`asset:{code|id}`)
3. **Scan** code/barcode/serial/QR — match → `matched`; location/branch/custodian/condition differ → `mismatch`; unknown asset → `unexpected`
4. **Close** — remaining `expected` → `missing`
5. **Resolve** — `accept_found` | `correct_register` | `ignore` | `mark_missing`  
   - Only `correct_register` updates `FixedAsset` + `AssetAssignmentHistory`

## Permissions

`assets.verification.view` / `.manage` / `.resolve`

```bash
cd server
npm run seed:phase6-perms
npm run test:assets:phase6
```

## UI

Assets → **Verify**: create/start/close campaigns, scan codes, resolve discrepancies.
