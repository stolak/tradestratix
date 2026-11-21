import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';
import { computeEmployeesForPeriod } from './payroll-compute.service.js';
import { ensurePayrollDefaults } from './payroll-config.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const runInclude = {
  items: {
    include: {
      employee: {
        include: {
          salesRep: { select: { id: true, code: true } },
          payGrade: { select: { id: true, code: true, name: true } }
        }
      },
      lines: { orderBy: { sortOrder: 'asc' as const } }
    }
  }
};

async function nextRunNumber(businessId: string) {
  return nextDocNumber(prisma.payrollRun, businessId, 'runNumber', 'PAY', 5);
}

function periodYearMonth(start: Date, end: Date, body: Record<string, any>) {
  const year = body.year != null ? Number(body.year) : end.getFullYear();
  const month = body.month != null ? Number(body.month) : end.getMonth() + 1;
  return { year, month };
}

function payrollBypassSod(user: AuthUser) {
  const perms = user.permissions || [];
  return (
    user.role === 'admin' ||
    user.role === 'owner' ||
    user.role === 'business_owner' ||
    perms.includes('*') ||
    perms.includes('payroll.*')
  );
}

/** Block same user acting twice unless admin / payroll.* */
function assertPayrollSod(
  user: AuthUser,
  priorUserId: string | null | undefined,
  action: string
) {
  if (!priorUserId || priorUserId !== user.id) return;
  if (payrollBypassSod(user)) return;
  throw httpError(
    403,
    `Segregation of duties: you cannot ${action} a payroll run you previously acted on`
  );
}

type JournalLineDraft = {
  account_id: string;
  debit?: number;
  credit?: number;
  description: string;
};

function addAmount(
  bucket: Map<string, number>,
  accountId: string,
  amount: number
) {
  if (amount <= 0 || !accountId) return;
  bucket.set(accountId, roundMoney((bucket.get(accountId) || 0) + amount));
}

/**
 * Build accrual journal from component lines when present; otherwise legacy item totals.
 * Dr expenses (earnings + employer) / Cr liabilities (deductions + net pay).
 */
async function buildPayrollPostLines(
  businessId: string,
  runNumber: string,
  items: {
    basicSalary: unknown;
    allowances: unknown;
    deductions: unknown;
    taxAmount: unknown;
    pensionEmployee: unknown;
    pensionEmployer: unknown;
    netPay: unknown;
    commissionAmount: unknown;
    lines: {
      componentCode: string;
      componentType: string;
      calculationMethod: string;
      amount: unknown;
      isEmployerContribution: boolean;
      componentId: string | null;
    }[];
  }[]
): Promise<JournalLineDraft[]> {
  const map = await getDefaultAccountMap(businessId);
  if (!map.salary_expense) throw httpError(400, 'salary_expense is not configured');
  if (!map.salary_payable) throw httpError(400, 'salary_payable is not configured');
  if (!map.paye_payable) throw httpError(400, 'paye_payable is not configured');
  if (!map.pension_payable) throw httpError(400, 'pension_payable is not configured');

  const commissionExpense =
    map.sales_rep_commission_expense || map.salary_expense;
  const commissionPayable =
    map.sales_rep_commission_payable || map.salary_payable;

  const componentIds = [
    ...new Set(
      items.flatMap((i) => i.lines.map((l) => l.componentId).filter(Boolean) as string[])
    )
  ];
  const componentAccounts = componentIds.length
    ? await prisma.salaryComponent.findMany({
        where: { id: { in: componentIds }, businessId },
        select: { id: true, accountId: true, code: true }
      })
    : [];
  const accountByComponentId = new Map(
    componentAccounts.map((c) => [c.id, c.accountId])
  );

  const hasLines = items.some((i) => i.lines.length > 0);
  const debits = new Map<string, number>();
  const credits = new Map<string, number>();

  if (hasLines) {
    for (const item of items) {
      for (const line of item.lines) {
        const amt = roundMoney(Number(line.amount));
        if (amt <= 0) continue;
        const ownAccount = line.componentId
          ? accountByComponentId.get(line.componentId)
          : null;

        if (line.componentType === 'earning') {
          const isComm = line.calculationMethod === 'sales_commission';
          const exp =
            ownAccount || (isComm ? commissionExpense : map.salary_expense!);
          addAmount(debits, exp, amt);
        } else if (line.componentType === 'deduction') {
          const isPaye =
            line.calculationMethod === 'progressive_tax' ||
            line.componentCode === 'PAYE';
          const isPensionCode =
            line.componentCode === 'PENSION_EE' ||
            line.componentCode.startsWith('PENSION');
          const liab =
            ownAccount ||
            (isPaye
              ? map.paye_payable!
              : isPensionCode
                ? map.pension_payable!
                : map.salary_expense!); // orphan: contra expense
          addAmount(credits, liab, amt);
        } else if (
          line.componentType === 'employer_contribution' ||
          line.isEmployerContribution
        ) {
          const exp = ownAccount || map.salary_expense!;
          addAmount(debits, exp, amt);
          addAmount(credits, map.pension_payable!, amt);
        }
      }
    }

    const net = roundMoney(items.reduce((s, i) => s + Number(i.netPay), 0));
    addAmount(credits, map.salary_payable!, net);
  } else {
    // Legacy flat items (pre-H3 runs)
    const gross = roundMoney(
      items.reduce(
        (s, i) => s + Number(i.basicSalary) + Number(i.allowances) - Number(i.deductions),
        0
      )
    );
    const tax = roundMoney(items.reduce((s, i) => s + Number(i.taxAmount), 0));
    const pensionEmployee = roundMoney(
      items.reduce((s, i) => s + Number(i.pensionEmployee), 0)
    );
    const pensionEmployer = roundMoney(
      items.reduce((s, i) => s + Number(i.pensionEmployer), 0)
    );
    const commission = roundMoney(
      items.reduce((s, i) => s + Number(i.commissionAmount || 0), 0)
    );
    const net = roundMoney(items.reduce((s, i) => s + Number(i.netPay), 0));
    const salaryExpense = roundMoney(Math.max(0, gross - commission) + pensionEmployer);
    if (salaryExpense > 0) addAmount(debits, map.salary_expense!, salaryExpense);
    if (commission > 0) addAmount(debits, commissionExpense, commission);
    if (net > 0) addAmount(credits, map.salary_payable!, net);
    if (tax > 0) addAmount(credits, map.paye_payable!, tax);
    const pensionTotal = roundMoney(pensionEmployee + pensionEmployer);
    if (pensionTotal > 0) addAmount(credits, map.pension_payable!, pensionTotal);
  }

  const lines: JournalLineDraft[] = [];
  for (const [account_id, debit] of debits) {
    if (debit > 0) {
      lines.push({
        account_id,
        debit,
        description: `Payroll expense ${runNumber}`
      });
    }
  }
  for (const [account_id, credit] of credits) {
    if (credit > 0) {
      lines.push({
        account_id,
        credit,
        description: `Payroll liability ${runNumber}`
      });
    }
  }

  // Sanity: coalesce if imbalance from orphan contra (should still balance)
  const d = roundMoney(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const c = roundMoney(lines.reduce((s, l) => s + (l.credit || 0), 0));
  if (Math.abs(d - c) > 0.02) {
    throw httpError(
      400,
      `Payroll journal does not balance (debit ${d} vs credit ${c}). Check component GL accounts.`
    );
  }

  // silence unused when hasLines path — commissionPayable reserved for H5 split settlement
  void commissionPayable;

  return lines;
}

async function depleteOneTimeOverridesForRun(
  businessId: string,
  runId: string
) {
  const lines = await prisma.payrollItemLine.findMany({
    where: {
      payrollItem: { payrollRunId: runId },
      amount: { gt: 0 },
      calculationMethod: 'fixed'
    },
    select: {
      componentId: true,
      amount: true,
      payrollItem: { select: { employeeId: true } }
    }
  });

  for (const line of lines) {
    if (!line.componentId) continue;
    const override = await prisma.employeePayOverride.findFirst({
      where: {
        businessId,
        employeeId: line.payrollItem.employeeId,
        componentId: line.componentId,
        isActive: true,
        isContinuous: false
      }
    });
    if (!override) continue;
    const used = roundMoney(Number(line.amount));
    const bal =
      override.balanceRemaining != null
        ? Number(override.balanceRemaining)
        : Number(override.targetAmount ?? override.amount);
    const next = roundMoney(Math.max(0, bal - used));
    await prisma.employeePayOverride.update({
      where: { id: override.id },
      data: {
        balanceRemaining: toDec(next),
        ...(next <= 0 ? { isActive: false } : {})
      }
    });
  }
}

export async function listRuns(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.payrollRun.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: {
      items: { select: { id: true } },
      _count: { select: { items: true } }
    },
    orderBy: { payDate: 'desc' }
  });
  return serialize(rows);
}

export async function getRun(businessId: string, id: string) {
  const row = await prisma.payrollRun.findFirst({
    where: { id, businessId },
    include: runInclude
  });
  if (!row) throw httpError(404, 'Payroll run not found');
  return serialize(row);
}

async function loadEmployeesForRun(
  user: AuthUser,
  branchId: string,
  body: Record<string, any>
) {
  const ids = Array.isArray(body.employee_ids || body.employeeIds)
    ? (body.employee_ids || body.employeeIds).map(String)
    : null;

  return prisma.employee.findMany({
    where: {
      businessId: user.businessId,
      status: 'active',
      ...(ids?.length ? { id: { in: ids } } : { branchId })
    },
    include: {
      salesRep: { select: { id: true } }
    }
  });
}

async function buildComputedItems(
  user: AuthUser,
  employees: Awaited<ReturnType<typeof loadEmployeesForRun>>,
  periodStart: Date,
  periodEnd: Date,
  body: Record<string, any>
) {
  const componentCount = await prisma.salaryComponent.count({
    where: { businessId: user.businessId, isActive: true }
  });
  if (!componentCount) {
    await ensurePayrollDefaults(user);
  }

  const computed = await computeEmployeesForPeriod({
    businessId: user.businessId,
    employees: employees.map((e) => ({
      id: e.id,
      baseSalary: e.baseSalary,
      payGradeId: e.payGradeId,
      payStep: e.payStep,
      employmentType: e.employmentType || 'permanent',
      includeSalesCommission: e.includeSalesCommission,
      salesRepId: e.salesRep?.id ?? null
    })),
    periodStart,
    periodEnd,
    commissionPeriodOnly: Boolean(
      body.commission_period_only ?? body.commissionPeriodOnly ?? false
    )
  });

  // Drop employees with nothing to pay and no lines at all (still keep zero-pay for audit? keep all)
  return computed;
}

function totalsFromComputed(
  items: Awaited<ReturnType<typeof buildComputedItems>>
) {
  const totalGross = roundMoney(
    items.reduce((s, i) => s + i.basicSalary + i.allowances - i.deductions, 0)
  );
  const totalDeductions = roundMoney(
    items.reduce((s, i) => s + i.taxAmount + i.pensionEmployee + i.deductions, 0)
  );
  const totalNet = roundMoney(items.reduce((s, i) => s + i.netPay, 0));
  const totalCommission = roundMoney(items.reduce((s, i) => s + i.commissionAmount, 0));
  return { totalGross, totalDeductions, totalNet, totalCommission };
}

export async function createRun(user: AuthUser, body: Record<string, any>) {
  const periodStartRaw = body.period_start || body.periodStart;
  const periodEndRaw = body.period_end || body.periodEnd;
  if (!periodStartRaw || !periodEndRaw) {
    throw httpError(400, 'period_start and period_end are required');
  }

  const periodStart = new Date(periodStartRaw);
  const periodEnd = new Date(periodEndRaw);
  const payDate = body.pay_date || body.payDate ? new Date(body.pay_date || body.payDate) : periodEnd;
  const { year, month } = periodYearMonth(periodStart, periodEnd, body);

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const employees = await loadEmployeesForRun(user, branchId, body);
  if (!employees.length) throw httpError(400, 'No active employees to payroll');

  const computed = await buildComputedItems(user, employees, periodStart, periodEnd, body);
  if (!computed.length) throw httpError(400, 'No payroll items could be computed');

  const { totalGross, totalDeductions, totalNet, totalCommission } = totalsFromComputed(computed);
  const runNumber = body.run_number || body.runNumber || (await nextRunNumber(user.businessId));

  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.payrollRun.create({
      data: {
        id: shortId('pay'),
        businessId: user.businessId,
        branchId,
        runNumber,
        periodStart,
        periodEnd,
        payDate,
        year,
        month,
        status: 'draft',
        totalGross: toDec(totalGross),
        totalDeductions: toDec(totalDeductions),
        totalNet: toDec(totalNet),
        totalCommission: toDec(totalCommission),
        notes: body.notes || null,
        createdById: user.id,
        items: {
          create: computed.map((i) => ({
            id: shortId('pyi'),
            employeeId: i.employeeId,
            basicSalary: toDec(i.basicSalary),
            allowances: toDec(i.allowances),
            deductions: toDec(i.deductions),
            taxAmount: toDec(i.taxAmount),
            pensionEmployee: toDec(i.pensionEmployee),
            pensionEmployer: toDec(i.pensionEmployer),
            commissionAmount: toDec(i.commissionAmount),
            netPay: toDec(i.netPay),
            lines: {
              create: i.lines.map((l) => ({
                id: shortId('pyl'),
                componentId: l.componentId,
                componentCode: l.componentCode,
                componentName: l.componentName,
                componentType: l.componentType,
                calculationMethod: l.calculationMethod,
                amount: toDec(l.amount),
                isEmployerContribution: l.isEmployerContribution,
                sortOrder: l.sortOrder
              }))
            }
          }))
        }
      },
      include: runInclude
    });

    return run;
  });

  // One-time override balance depletion is deferred to post (avoids double-consume on recompute).

  await writeAudit({
    user,
    action: 'create',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: created.id,
    summary: `Computed payroll run ${runNumber} (${computed.length} employees)`
  });
  return serialize(created);
}

/** Recompute a draft run from current config / commissions / overrides. */
export async function recomputeRun(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'draft') throw httpError(400, 'Only draft payroll runs can be recomputed');

  const employeeIds = run.items.map((i) => i.employeeId);
  const employees = await prisma.employee.findMany({
    where: { businessId: user.businessId, id: { in: employeeIds }, status: 'active' },
    include: { salesRep: { select: { id: true } } }
  });
  if (!employees.length) throw httpError(400, 'No active employees left on this run');

  const computed = await buildComputedItems(
    user,
    employees,
    run.periodStart,
    run.periodEnd,
    body
  );
  const { totalGross, totalDeductions, totalNet, totalCommission } = totalsFromComputed(computed);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payrollItemLine.deleteMany({
      where: { payrollItem: { payrollRunId: id } }
    });
    await tx.payrollItem.deleteMany({ where: { payrollRunId: id } });

    await tx.payrollRun.update({
      where: { id },
      data: {
        totalGross: toDec(totalGross),
        totalDeductions: toDec(totalDeductions),
        totalNet: toDec(totalNet),
        totalCommission: toDec(totalCommission),
        items: {
          create: computed.map((i) => ({
            id: shortId('pyi'),
            employeeId: i.employeeId,
            basicSalary: toDec(i.basicSalary),
            allowances: toDec(i.allowances),
            deductions: toDec(i.deductions),
            taxAmount: toDec(i.taxAmount),
            pensionEmployee: toDec(i.pensionEmployee),
            pensionEmployer: toDec(i.pensionEmployer),
            commissionAmount: toDec(i.commissionAmount),
            netPay: toDec(i.netPay),
            lines: {
              create: i.lines.map((l) => ({
                id: shortId('pyl'),
                componentId: l.componentId,
                componentCode: l.componentCode,
                componentName: l.componentName,
                componentType: l.componentType,
                calculationMethod: l.calculationMethod,
                amount: toDec(l.amount),
                isEmployerContribution: l.isEmployerContribution,
                sortOrder: l.sortOrder
              }))
            }
          }))
        }
      }
    });

    return tx.payrollRun.findFirst({ where: { id }, include: runInclude });
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: id,
    summary: `Recomputed payroll run ${run.runNumber}`
  });

  return serialize(updated);
}

/**
 * Preview compute without saving (for UI).
 */
export async function previewCompute(user: AuthUser, body: Record<string, any>) {
  const periodStartRaw = body.period_start || body.periodStart;
  const periodEndRaw = body.period_end || body.periodEnd;
  if (!periodStartRaw || !periodEndRaw) {
    throw httpError(400, 'period_start and period_end are required');
  }
  const periodStart = new Date(periodStartRaw);
  const periodEnd = new Date(periodEndRaw);
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const employees = await loadEmployeesForRun(user, branchId, body);
  const computed = await buildComputedItems(user, employees, periodStart, periodEnd, body);
  const totals = totalsFromComputed(computed);
  return serialize({ totals, items: computed });
}

/** Approve a draft run (required before post). */
export async function approveRun(user: AuthUser, id: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'draft') {
    throw httpError(400, `Only draft runs can be approved (status=${run.status})`);
  }
  if (!run.items.length) throw httpError(400, 'Payroll run has no items to approve');
  assertPayrollSod(user, run.createdById, 'approve');

  const updated = await prisma.payrollRun.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.id
    },
    include: runInclude
  });

  await writeAudit({
    user,
    action: 'approve',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: id,
    summary: `Approved payroll ${run.runNumber}`
  });
  return serialize(updated);
}

/** Return approved run to draft for recompute/edit. */
export async function unapproveRun(user: AuthUser, id: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'approved') {
    throw httpError(400, `Only approved runs can be unapproved (status=${run.status})`);
  }

  const updated = await prisma.payrollRun.update({
    where: { id },
    data: {
      status: 'draft',
      approvedAt: null,
      approvedById: null
    },
    include: runInclude
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: id,
    summary: `Unapproved payroll ${run.runNumber}`
  });
  return serialize(updated);
}

/**
 * Post an approved payroll run to GL (component-aware journals).
 * Dr expenses (earnings + employer) / Cr PAYE, pension, net payable.
 */
export async function postRun(user: AuthUser, id: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      items: {
        include: {
          lines: {
            select: {
              componentId: true,
              componentCode: true,
              componentType: true,
              calculationMethod: true,
              amount: true,
              isEmployerContribution: true
            }
          }
        }
      }
    }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'approved') {
    throw httpError(400, 'Only approved payroll runs can be posted — approve first');
  }
  if (!run.items.length) throw httpError(400, 'Payroll run has no items');
  assertPayrollSod(user, run.approvedById, 'post');
  assertPayrollSod(user, run.createdById, 'post');

  const journalLines = await buildPayrollPostLines(
    user.businessId,
    run.runNumber,
    run.items
  );
  if (!journalLines.length) throw httpError(400, 'Nothing to post');

  const gross = roundMoney(
    run.items.reduce(
      (s, i) => s + Number(i.basicSalary) + Number(i.allowances) - Number(i.deductions),
      0
    )
  );
  const tax = roundMoney(run.items.reduce((s, i) => s + Number(i.taxAmount), 0));
  const pensionEmployee = roundMoney(
    run.items.reduce((s, i) => s + Number(i.pensionEmployee), 0)
  );
  const net = roundMoney(run.items.reduce((s, i) => s + Number(i.netPay), 0));
  const totalCommission = roundMoney(
    run.items.reduce((s, i) => s + Number(i.commissionAmount || 0), 0)
  );

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: run.payDate,
        memo: `Payroll ${run.runNumber}`,
        source_type: 'payroll',
        source_id: run.id,
        idempotency_key: `payroll:${run.id}`,
        branch_id: run.branchId || undefined,
        post: true,
        lines: journalLines
      },
      tx
    );

    return tx.payrollRun.update({
      where: { id },
      data: {
        status: 'posted',
        postedAt: new Date(),
        postedById: user.id,
        journalEntryId: (journal as any).id,
        totalGross: toDec(gross),
        totalDeductions: toDec(roundMoney(tax + pensionEmployee)),
        totalNet: toDec(net),
        totalCommission: toDec(totalCommission)
      },
      include: runInclude
    });
  });

  await depleteOneTimeOverridesForRun(user.businessId, id);

  await writeAudit({
    user,
    action: 'post',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: id,
    summary: `Posted payroll ${run.runNumber}`
  });
  return serialize(result);
}

/** Pay net salaries: Dr salary_payable / Cr bank|cash; mark included commissions paid. */
export async function payRun(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      items: {
        include: {
          lines: true,
          employee: { include: { salesRep: { select: { id: true } } } }
        }
      }
    }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'posted') throw httpError(400, 'Payroll must be posted before payment');
  if (run.paymentJournalEntryId) throw httpError(400, 'Payroll has already been paid');

  const map = await getDefaultAccountMap(user.businessId);
  if (!map.salary_payable) throw httpError(400, 'salary_payable is not configured');

  const method = String(body.method || body.pay_method || body.payMethod || 'bank').toLowerCase();
  let payGl = method === 'cash' ? map.cash : map.bank;
  const bankId = body.bank_account_id || body.bankAccountId;
  if (bankId) {
    const bank = await prisma.bankAccount.findFirst({
      where: { id: bankId, businessId: user.businessId }
    });
    if (!bank) throw httpError(400, 'Invalid bank_account_id');
    payGl = bank.glAccountId;
  }
  if (!payGl) throw httpError(400, 'Payment GL account is not configured');

  const amount = roundMoney(Number(run.totalNet));
  if (amount <= 0) throw httpError(400, 'Nothing to pay');

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: body.pay_date || body.payDate || run.payDate,
        memo: `Payroll payment ${run.runNumber}`,
        source_type: 'payroll_payment',
        source_id: run.id,
        idempotency_key: `payroll_payment:${run.id}`,
        branch_id: run.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: map.salary_payable,
            debit: amount,
            description: `Pay net salaries ${run.runNumber}`
          },
          {
            account_id: payGl!,
            credit: amount,
            description: `${method} payroll payment`
          }
        ]
      },
      tx
    );

    // Mark accrued commissions that were included in this run as paid
    for (const item of run.items) {
      if (Number(item.commissionAmount) <= 0 || !item.employee.salesRep?.id) continue;
      const periodOnly = Boolean(body.commission_period_only ?? body.commissionPeriodOnly);
      await tx.salesCommission.updateMany({
        where: {
          businessId: user.businessId,
          salesRepId: item.employee.salesRep.id,
          status: 'accrued',
          ...(periodOnly
            ? { createdAt: { gte: run.periodStart, lte: run.periodEnd } }
            : {})
        },
        data: {
          status: 'paid',
          payrollItemId: item.id,
          paidAt: new Date()
        }
      });
    }

    return tx.payrollRun.update({
      where: { id },
      data: {
        status: 'paid',
        paymentJournalEntryId: (journal as any).id
      },
      include: runInclude
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: id,
    summary: `Paid payroll ${run.runNumber}`
  });
  return serialize(result);
}
