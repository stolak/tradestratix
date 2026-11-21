# Payroll reports (H5)

## Period matrix

`GET /payroll/reports/period?year=&month=`

- Picks the strongest run in the period (`paid` > `posted` > `approved` > `draft`)
- Columns = component codes present on that run
- Rows = employees with `amounts: [{ code, amount }]` + net  
  (array form avoids API `serialize()` mangling ALL-CAPS codes like `BASIC` → `_b_a_s_i_c`)
- Totals row by component
- Legacy flat items (no lines) synthesise columns from item totals

## Payslip

`GET /payroll/payslips/:itemId` or `?run_id=&employee_id=`

- Earnings / deductions / employer sections
- Period totals + **YTD including this slip** (prior posted/paid + current)
- Printable from the Payroll UI

## Employee YTD

`GET /payroll/reports/employees/:id/ytd?year=`

- Aggregates posted/paid items for the calendar year
- Lists each period with component lines
