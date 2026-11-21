# HR / Payroll data model

## Config (H1)

| Model | Role |
|-------|------|
| `SalaryComponent` | Business-scoped earning/deduction/employer_contribution; calculation method + flags + optional GL |
| `PayGrade` | Grade codes with max step |
| `SalaryChartEntry` | Amount for grade × step × employmentType × component |
| `EmployeePayPackageLine` | Direct package amounts when not using (or in addition to) chart |
| `EmployeePayOverride` | Continuous or one-time amount override per component |
| `PayrollStatutoryRule` | Named rule (paye, pension_*, nhf) with method + rate |
| `PayrollTaxBracket` | Progressive bands under a statutory rule |
| `ActivePayrollPeriod` | One active year/month per business |

## Employee pay fields

- `payGradeId`, `payStep`, `employmentType`
- `includeSalesCommission` (default true for sales reps / configurable)
- `baseSalary` retained as **fallback** when no chart/package primary amount exists

## Run snapshot (H3+)

| Model | Role |
|-------|------|
| `PayrollRun` | Period header; status draft → approved → posted → paid |
| `PayrollItem` | Per-employee totals (gross, deductions, tax, pension, commission, net) |
| `PayrollItemLine` | Per-component snapshot for the item |
| `SalesCommission.payrollItemId` | Link when commission is included and paid via payroll |

## Component calculation methods

| Method | Meaning |
|--------|---------|
| `fixed` | Chart / package / override amount (primary falls back to `baseSalary`) |
| `percent_of_components` | `%` of listed component codes (resolved amounts) |
| `progressive_tax` | PAYE from tax brackets on taxable base elements |
| `statutory_rate` | Flat % from linked statutory rule |
| `sales_commission` | Sum of accrued unpaid `SalesCommission` for employee’s sales rep |

## Resolve order (H3)

1. Fixed amounts: override → package → chart → primary `baseSalary`
2. Sales commission (if employee `includeSalesCommission`)
3. Iterative: `% of components`, statutory rate, progressive tax
4. Persist `PayrollItem` + `PayrollItemLine`; draft runs can recompute
5. Approve (SoD) then post: component-aware journals; deplete one-time overrides
6. On pay: mark included accrued commissions `paid` and link `payrollItemId`
