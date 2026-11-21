# HR & Payroll Module

Dynamic, configurable payroll for TradeStratix — modeled on school-app, improved for commercial ERP (statutory tables, sales commission in pay, grade chart **or** employee package).

## Status

**H0 — Discovery & defaults — complete.**  
**H1 — Config foundation — complete** (schema, seed defaults API, settings UI).  
**H2 — Employee pay assignment — foothold done** (package/overrides API + employee grade fields); HR UI polish pending.  
**H3 — Compute engine — complete** (component resolution, commission injection, draft recompute, item lines).  
**H4 — Approve → post → pay — complete** (SoD approve, component-aware journals, override deplete on post).  
**H5 — Payslip & reports — complete** (period matrix, employee payslip + YTD).  
**H6 — Optional (attendance factors, loans) — pending.**

## H0 decisions (locked)

| Topic | Decision |
|-------|----------|
| Statutory v1 | Progressive **PAYE** + **pension** employee/employer; **NHF** optional rule (inactive by default) |
| Pay structure | **Both** pay-grade × step chart **and** per-employee package lines |
| Commission in salary | Component source `sales_commission`; on compute pulls **accrued unpaid** commissions for the employee’s sales rep; optional period filter; employee flag `includeSalesCommission` |
| Existing foothold | Keep `Employee` / attendance / leave; evolve `PayrollRun`/`PayrollItem` to component lines; keep `createJournal` |

## Existing foothold

| Piece | Today |
|-------|--------|
| `Employee`, attendance, leave | Usable roster |
| `PayrollRun` / `PayrollItem` | Flat basic + hard-coded 7.5% tax / 8%–10% pension |
| `SalesCommission` | Accrued on fulfilment; not in payroll |
| Permissions | `hr.*`, `payroll.view/create/edit/approve/post` |

## Target architecture

1. **Salary components** — earning / deduction / employer_contribution; methods: fixed, percent_of_components, progressive_tax, statutory_rate, sales_commission  
2. **Pay grades + salary chart** — amount by grade × step × employment type × component  
3. **Employee package + overrides** — direct lines and continuous/one-time overrides  
4. **Statutory rules + tax brackets** — configurable, not code constants  
5. **Active period** — business year/month  
6. **Run lifecycle** — compute → approve → post → pay  
7. **Commission** — configurable into salary via component + employee flag  

## Documentation index

| Doc | Purpose |
|-----|---------|
| [data-model.md](./data-model.md) | Prisma entities |
| [api.md](./api.md) | Route index |
| [reports.md](./reports.md) | Period matrix, payslip, YTD |
| [../workflows.md](../workflows.md) | Process → approve → pay |

## Non-negotiables

- Money via `Decimal` / `roundMoney` / `toDec`
- GL via `createJournal` / `reverseJournal`
- Tenant + branch via `businessId` + `branchAccess`
- Audit via `writeAudit`
- No hard-delete of posted payroll history
