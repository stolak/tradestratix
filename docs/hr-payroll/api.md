# HR / Payroll API

Base: `/api/v1/payroll`

## Config (H1)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| POST | `/config/ensure-defaults` | `payroll.edit` | Seed components + PAYE/pension/NHF + active period |
| GET | `/config/summary` | `payroll.view` | Counts + active period |
| GET/POST | `/components` | view / edit | List / create |
| PATCH | `/components/:id` | edit | Update flags, method, GL |
| GET/POST | `/grades` | view / edit | Pay grades |
| PATCH | `/grades/:id` | edit | |
| GET/POST | `/chart` | view / edit | Salary chart upsert |
| DELETE | `/chart/:id` | edit | |
| GET/POST | `/statutory` | view / edit | Rules + optional brackets array |
| GET/PUT | `/period` | view / edit | Active year/month |
| GET | `/employees/:employeeId/package` | view | Employee package lines |
| POST | `/package` | edit | Upsert package line |
| GET/POST | `/overrides` | view / edit | Employee overrides |
| PATCH | `/overrides/:id` | edit | |

## Runs (H3 compute)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET/POST | `/runs` | view / create | Create = compute from components |
| GET | `/runs/:id` | view | Includes item lines |
| POST | `/runs/preview` | view | Compute without saving |
| POST | `/runs/:id/recompute` | create | Draft only |
| POST | `/runs/:id/approve` | approve | Draft → approved (SoD vs creator) |
| POST | `/runs/:id/unapprove` | approve | Approved → draft |
| POST | `/runs/:id/post` | post | Approved only; component-aware GL |
| POST | `/runs/:id/pay` | post | Marks included commissions paid |

### Lifecycle

`draft` → (recompute) → `approved` → `posted` → `paid`  
Unapprove returns `approved` → `draft`. `business_owner` / admin / `payroll.*` may bypass creator/approver SoD.

### Create / recompute body

- `period_start`, `period_end`, `pay_date`
- `employee_ids` (optional subset)
- `commission_period_only` — if true, only accrued commissions created in the period; else all unpaid accrued

## Reports (H5)

| Method | Path | Perm | Notes |
|--------|------|------|-------|
| GET | `/reports/period?year=&month=` | view | Employee × component matrix for period |
| GET | `/reports/payslip?run_id=&employee_id=` | view | Payslip by run + employee |
| GET | `/payslips/:itemId` | view | Payslip by payroll item id |
| GET | `/runs/:id/payslips` | view | List employees on a run (picker) |
| GET | `/reports/employees/:employeeId/ytd?year=` | view | YTD + monthly posted periods |
