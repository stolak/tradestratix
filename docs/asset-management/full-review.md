# Asset Management — Full review (Phases 0–8)

Date: 2026-11-20

## Regression

`npm run test:assets:all` — **153 passed** (phases 1–8 + bulk) after polish.

## Verdict

Module is **production-ready** for the planned lifecycle. No further numbered phase. Remaining items are optional product polish.

## Polish applied in this review

| Area | Change |
|------|--------|
| Legacy create+GL | `POST /assets` rejects `post_acquisition_journal` / `pay_method` — use acquisition or CIP |
| Legacy one-shot dep | `POST /assets/depreciation/run` returns **410**; client helper removed |
| Branch scope | Locations (always include unassigned), depreciation entries/runs |
| CIP SoD | Capitalise only from `completed` (not `active`) |
| UI RBAC | Acquire / dep / transfer / CIP / maintenance / verify resolve actions gated with `can(...)` |
| Empty states | Maintenance, CIP, components (+ existing tables) |

## Deferred (optional)

| Item | Notes |
|------|-------|
| Document upload UI | API `POST /:id/documents` exists; needs S3 + register detail panel |
| Lazy-load per tab | Current load uses `.catch(() => [])` resilience |
| Impairment / reval approve step | Still draft → post with `*.manage` (unlike disposal) |
| Drop `assets.view` from sensitive list routes | Would need dedicated `*.view` grants for finance viewers |
| Insurance / warranty / WO empty copy | Low priority |

## Phase map (complete)

0 Discovery → 1 Foundation → 2 Acquisition → 3 Depreciation → 4 Operations → 5 Advanced accounting → 6 Verification → 7 Dashboard/reports → 8 Hardening → **this polish pass**.
