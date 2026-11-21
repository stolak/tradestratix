import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';

function validateYearMonth(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw httpError(400, 'year must be a valid calendar year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw httpError(400, 'month must be 1–12');
  }
}

const POSTED_STATUSES = ['posted', 'paid', 'approved'] as const;

/**
 * Single-employee payslip for a payroll item (or latest matching run item).
 */
export async function getPayslip(
  user: AuthUser,
  opts: { payrollItemId?: string; runId?: string; employeeId?: string }
) {
  let item = null as Awaited<ReturnType<typeof findPayslipItem>>;

  if (opts.payrollItemId) {
    item = await findPayslipItem({ id: opts.payrollItemId, businessId: user.businessId });
  } else if (opts.runId && opts.employeeId) {
    item = await findPayslipItem({
      payrollRunId: opts.runId,
      employeeId: opts.employeeId,
      businessId: user.businessId
    });
  } else {
    throw httpError(400, 'Provide payroll_item_id, or run_id + employee_id');
  }

  if (!item) throw httpError(404, 'Payslip not found');

  const earnings = item.lines.filter((l) => l.componentType === 'earning');
  const deductions = item.lines.filter((l) => l.componentType === 'deduction');
  const employer = item.lines.filter(
    (l) => l.componentType === 'employer_contribution' || l.isEmployerContribution
  );

  const gross = roundMoney(earnings.reduce((s, l) => s + Number(l.amount), 0));
  const totalDeductions = roundMoney(deductions.reduce((s, l) => s + Number(l.amount), 0));
  const employerTotal = roundMoney(employer.reduce((s, l) => s + Number(l.amount), 0));

  const year = item.payrollRun.year || item.payrollRun.periodEnd.getFullYear();
  const priorYtd = await computeYtd(user.businessId, item.employeeId, {
    year,
    throughPeriodEnd: item.payrollRun.periodEnd,
    excludeItemId: item.id
  });

  const thisGross = roundMoney(
    Number(item.basicSalary) + Number(item.allowances) - Number(item.deductions)
  );
  const ytdByComponent = new Map<string, number>(
    priorYtd.byComponent.map((row) => [row.code, row.amount])
  );
  for (const line of item.lines) {
    ytdByComponent.set(
      line.componentCode,
      roundMoney((ytdByComponent.get(line.componentCode) || 0) + Number(line.amount))
    );
  }
  const ytd = {
    periods: priorYtd.periods + 1,
    gross: roundMoney(priorYtd.gross + thisGross),
    tax: roundMoney(priorYtd.tax + Number(item.taxAmount)),
    pensionEmployee: roundMoney(priorYtd.pensionEmployee + Number(item.pensionEmployee)),
    pensionEmployer: roundMoney(priorYtd.pensionEmployer + Number(item.pensionEmployer)),
    commission: roundMoney(priorYtd.commission + Number(item.commissionAmount)),
    net: roundMoney(priorYtd.net + Number(item.netPay)),
    byComponent: [...ytdByComponent.entries()].map(([code, amount]) => ({ code, amount }))
  };

  return serialize({
    businessId: user.businessId,
    run: {
      id: item.payrollRun.id,
      runNumber: item.payrollRun.runNumber,
      status: item.payrollRun.status,
      periodStart: item.payrollRun.periodStart,
      periodEnd: item.payrollRun.periodEnd,
      payDate: item.payrollRun.payDate,
      year: item.payrollRun.year,
      month: item.payrollRun.month
    },
    employee: item.employee,
    item: {
      id: item.id,
      basicSalary: item.basicSalary,
      allowances: item.allowances,
      deductions: item.deductions,
      taxAmount: item.taxAmount,
      pensionEmployee: item.pensionEmployee,
      pensionEmployer: item.pensionEmployer,
      commissionAmount: item.commissionAmount,
      netPay: item.netPay
    },
    lines: {
      earnings,
      deductions,
      employer
    },
    totals: {
      gross,
      totalDeductions,
      employerTotal,
      netPay: roundMoney(Number(item.netPay))
    },
    ytdPrior: priorYtd,
    ytd
  });
}

async function findPayslipItem(where: {
  id?: string;
  payrollRunId?: string;
  employeeId?: string;
  businessId: string;
}) {
  return prisma.payrollItem.findFirst({
    where: {
      ...(where.id ? { id: where.id } : {}),
      ...(where.payrollRunId ? { payrollRunId: where.payrollRunId } : {}),
      ...(where.employeeId ? { employeeId: where.employeeId } : {}),
      payrollRun: { businessId: where.businessId }
    },
    include: {
      lines: { orderBy: { sortOrder: 'asc' } },
      employee: {
        include: {
          branch: { select: { id: true, code: true, name: true } },
          payGrade: { select: { id: true, code: true, name: true } },
          salesRep: { select: { id: true, code: true } }
        }
      },
      payrollRun: true
    }
  });
}

/**
 * Period matrix: employees × components for a year/month (latest non-void run preferred).
 */
export async function getPeriodReport(
  user: AuthUser,
  opts: {
    year: number;
    month: number;
    status?: string;
    branchId?: string | null;
    allowConsolidated?: boolean;
  }
) {
  validateYearMonth(opts.year, opts.month);

  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts.branchId,
    allowConsolidated: opts.allowConsolidated
  });

  const periodStart = new Date(Date.UTC(opts.year, opts.month - 1, 1));
  const periodEnd = new Date(Date.UTC(opts.year, opts.month, 0, 23, 59, 59));

  const runs = await prisma.payrollRun.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      status: opts.status
        ? opts.status
        : { in: ['draft', 'approved', 'posted', 'paid'] },
      NOT: { status: 'void' },
      OR: [
        { year: opts.year, month: opts.month },
        {
          year: null,
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd }
        }
      ]
    },
    include: {
      items: {
        include: {
          employee: {
            select: {
              id: true,
              code: true,
              fullName: true,
              department: true,
              jobTitle: true,
              employmentType: true
            }
          },
          lines: { orderBy: { sortOrder: 'asc' } }
        },
        orderBy: { employee: { fullName: 'asc' } }
      }
    },
    orderBy: [{ status: 'desc' }, { payDate: 'desc' }, { createdAt: 'desc' }]
  });

  // Prefer paid > posted > approved > draft when multiple runs in period
  const rank: Record<string, number> = { paid: 4, posted: 3, approved: 2, draft: 1 };
  const primary =
    [...runs].sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0))[0] || null;

  const componentsMap = new Map<
    string,
    { code: string; name: string; type: string; sortOrder: number }
  >();
  if (primary) {
    for (const item of primary.items) {
      for (const line of item.lines) {
        if (!componentsMap.has(line.componentCode)) {
          componentsMap.set(line.componentCode, {
            code: line.componentCode,
            name: line.componentName,
            type: line.componentType,
            sortOrder: line.sortOrder
          });
        }
      }
    }
  }

  const rows =
    primary?.items.map((item) => {
      // Array form — Record keys like BASIC are mangled by serialize() into _b_a_s_i_c
      let amounts = item.lines.map((line) => ({
        code: line.componentCode,
        name: line.componentName,
        type: line.componentType,
        amount: roundMoney(Number(line.amount))
      }));
      // Legacy flat items (no lines): synthesise from totals so the matrix still tallies
      if (!amounts.length && Number(item.netPay) !== 0) {
        amounts = [
          {
            code: 'BASIC',
            name: 'Basic salary',
            type: 'earning',
            amount: roundMoney(Number(item.basicSalary))
          },
          {
            code: 'ALLOWANCES',
            name: 'Allowances',
            type: 'earning',
            amount: roundMoney(Number(item.allowances))
          },
          {
            code: 'SALES_COMMISSION',
            name: 'Sales commission',
            type: 'earning',
            amount: roundMoney(Number(item.commissionAmount))
          },
          {
            code: 'PAYE',
            name: 'PAYE tax',
            type: 'deduction',
            amount: roundMoney(Number(item.taxAmount))
          },
          {
            code: 'PENSION_EE',
            name: 'Pension (employee)',
            type: 'deduction',
            amount: roundMoney(Number(item.pensionEmployee))
          },
          {
            code: 'PENSION_ER',
            name: 'Pension (employer)',
            type: 'employer_contribution',
            amount: roundMoney(Number(item.pensionEmployer))
          },
          {
            code: 'OTHER_DED',
            name: 'Other deductions',
            type: 'deduction',
            amount: roundMoney(Number(item.deductions))
          }
        ].filter((a) => a.amount !== 0);
        for (const a of amounts) {
          if (!componentsMap.has(a.code)) {
            componentsMap.set(a.code, {
              code: a.code,
              name: a.name,
              type: a.type,
              sortOrder: a.code === 'BASIC' ? 10 : 50
            });
          }
        }
      }
      const amountByCode = (code: string) =>
        amounts.find((a) => a.code === code)?.amount ?? 0;
      return {
        payrollItemId: item.id,
        employeeId: item.employeeId,
        employee: item.employee,
        basicSalary: Number(item.basicSalary),
        allowances: Number(item.allowances),
        deductions: Number(item.deductions),
        taxAmount: Number(item.taxAmount),
        pensionEmployee: Number(item.pensionEmployee),
        pensionEmployer: Number(item.pensionEmployer),
        commissionAmount: Number(item.commissionAmount),
        netPay: Number(item.netPay),
        amounts,
        amountByCode // discarded after totals; kept out of response below
      };
    }) || [];

  // Rebuild after legacy synthesis may have added codes
  const periodComponents = [...componentsMap.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)
  );

  const totals = {
    employees: rows.length,
    gross: roundMoney(
      rows.reduce((s, r) => s + r.basicSalary + r.allowances - r.deductions, 0)
    ),
    commission: roundMoney(rows.reduce((s, r) => s + r.commissionAmount, 0)),
    tax: roundMoney(rows.reduce((s, r) => s + r.taxAmount, 0)),
    pensionEmployee: roundMoney(rows.reduce((s, r) => s + r.pensionEmployee, 0)),
    pensionEmployer: roundMoney(rows.reduce((s, r) => s + r.pensionEmployer, 0)),
    net: roundMoney(rows.reduce((s, r) => s + r.netPay, 0)),
    byComponent: periodComponents.map((c) => ({
      code: c.code,
      amount: roundMoney(rows.reduce((s, r) => s + r.amountByCode(c.code), 0))
    }))
  };

  const responseRows = rows.map(({ amountByCode: _drop, ...rest }) => rest);

  return serialize({
    year: opts.year,
    month: opts.month,
    run: primary
      ? {
          id: primary.id,
          runNumber: primary.runNumber,
          status: primary.status,
          periodStart: primary.periodStart,
          periodEnd: primary.periodEnd,
          payDate: primary.payDate,
          totalGross: primary.totalGross,
          totalNet: primary.totalNet,
          totalCommission: primary.totalCommission
        }
      : null,
    otherRuns: runs
      .filter((r) => r.id !== primary?.id)
      .map((r) => ({
        id: r.id,
        runNumber: r.runNumber,
        status: r.status,
        itemCount: r.items.length
      })),
    periodComponents,
    rows: responseRows,
    totals
  });
}

/**
 * Employee YTD summary for a calendar year (posted + paid runs).
 */
export async function getEmployeeYtd(
  user: AuthUser,
  employeeId: string,
  year: number
) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw httpError(400, 'year must be a valid calendar year');
  }

  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId: user.businessId },
    select: {
      id: true,
      code: true,
      fullName: true,
      department: true,
      jobTitle: true
    }
  });
  if (!emp) throw httpError(404, 'Employee not found');

  const ytd = await computeYtd(user.businessId, employeeId, { year });

  const months = await prisma.payrollItem.findMany({
    where: {
      employeeId,
      payrollRun: {
        businessId: user.businessId,
        year,
        status: { in: ['posted', 'paid'] }
      }
    },
    include: {
      payrollRun: {
        select: {
          id: true,
          runNumber: true,
          month: true,
          year: true,
          status: true,
          payDate: true,
          periodStart: true,
          periodEnd: true
        }
      },
      lines: { orderBy: { sortOrder: 'asc' } }
    },
    orderBy: [{ payrollRun: { month: 'asc' } }, { payrollRun: { payDate: 'asc' } }]
  });

  return serialize({
    employee: emp,
    year,
    ytd,
    periods: months.map((m) => ({
      payrollItemId: m.id,
      run: m.payrollRun,
      basicSalary: Number(m.basicSalary),
      allowances: Number(m.allowances),
      taxAmount: Number(m.taxAmount),
      pensionEmployee: Number(m.pensionEmployee),
      commissionAmount: Number(m.commissionAmount),
      netPay: Number(m.netPay),
      lines: m.lines
    }))
  });
}

async function computeYtd(
  businessId: string,
  employeeId: string,
  opts: {
    year: number;
    throughPeriodEnd?: Date;
    excludeItemId?: string | null;
  }
) {
  const items = await prisma.payrollItem.findMany({
    where: {
      employeeId,
      ...(opts.excludeItemId ? { NOT: { id: opts.excludeItemId } } : {}),
      payrollRun: {
        businessId,
        year: opts.year,
        status: { in: [...POSTED_STATUSES] },
        ...(opts.throughPeriodEnd
          ? { periodEnd: { lte: opts.throughPeriodEnd } }
          : {})
      }
    },
    include: {
      lines: true,
      payrollRun: { select: { status: true, month: true } }
    }
  });

  // For YTD money, prefer posted/paid only (approved not yet on GL)
  const posted = items.filter((i) =>
    ['posted', 'paid'].includes(i.payrollRun.status)
  );

  const byComponentMap = new Map<string, number>();
  for (const item of posted) {
    for (const line of item.lines) {
      byComponentMap.set(
        line.componentCode,
        roundMoney((byComponentMap.get(line.componentCode) || 0) + Number(line.amount))
      );
    }
  }

  return {
    periods: posted.length,
    gross: roundMoney(
      posted.reduce(
        (s, i) => s + Number(i.basicSalary) + Number(i.allowances) - Number(i.deductions),
        0
      )
    ),
    tax: roundMoney(posted.reduce((s, i) => s + Number(i.taxAmount), 0)),
    pensionEmployee: roundMoney(
      posted.reduce((s, i) => s + Number(i.pensionEmployee), 0)
    ),
    pensionEmployer: roundMoney(
      posted.reduce((s, i) => s + Number(i.pensionEmployer), 0)
    ),
    commission: roundMoney(
      posted.reduce((s, i) => s + Number(i.commissionAmount), 0)
    ),
    net: roundMoney(posted.reduce((s, i) => s + Number(i.netPay), 0)),
    // Array — avoid serialize() mangling ALL-CAPS component codes as object keys
    byComponent: [...byComponentMap.entries()].map(([code, amount]) => ({ code, amount }))
  };
}

/** List payslip-ready items for a run (for UI picker). */
export async function listRunPayslips(user: AuthUser, runId: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, businessId: user.businessId },
    include: {
      items: {
        include: {
          employee: {
            select: { id: true, code: true, fullName: true, department: true }
          }
        },
        orderBy: { employee: { fullName: 'asc' } }
      }
    }
  });
  if (!run) throw httpError(404, 'Payroll run not found');

  return serialize({
    run: {
      id: run.id,
      runNumber: run.runNumber,
      status: run.status,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      year: run.year,
      month: run.month
    },
    items: run.items.map((i) => ({
      payrollItemId: i.id,
      employeeId: i.employeeId,
      employee: i.employee,
      netPay: Number(i.netPay),
      commissionAmount: Number(i.commissionAmount),
      basicSalary: Number(i.basicSalary)
    }))
  });
}
