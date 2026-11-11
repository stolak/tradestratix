import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const runInclude = {
  items: { include: { employee: true } }
};

const TAX_RATE = 0.075;
const PENSION_EMPLOYEE_RATE = 0.08;
const PENSION_EMPLOYER_RATE = 0.1;

async function nextRunNumber(businessId: string) {
  const count = await prisma.payrollRun.count({ where: { businessId } });
  return `PAY-${String(count + 1).padStart(5, '0')}`;
}

export async function listRuns(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.payrollRun.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: { items: true, _count: { select: { items: true } } },
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

export async function createRun(user: AuthUser, body: Record<string, any>) {
  const periodStart = body.period_start || body.periodStart;
  const periodEnd = body.period_end || body.periodEnd;
  if (!periodStart || !periodEnd) throw httpError(400, 'period_start and period_end are required');

  const payDate = body.pay_date || body.payDate ? new Date(body.pay_date || body.payDate) : new Date();
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const employees = await prisma.employee.findMany({
    where: {
      businessId: user.businessId,
      status: 'active',
      OR: [{ branchId }, { branchId: null }]
    }
  });
  if (!employees.length) throw httpError(400, 'No active employees to payroll');

  const allowanceOverrides: Record<string, number> = body.allowances || {};
  const deductionOverrides: Record<string, number> = body.deductions || {};

  const items = employees.map((emp) => {
    const basic = roundMoney(Number(emp.baseSalary));
    const allowances = roundMoney(Number(allowanceOverrides[emp.id] ?? 0));
    const deductions = roundMoney(Number(deductionOverrides[emp.id] ?? 0));
    const tax = roundMoney(basic * TAX_RATE);
    const pensionEmployee = roundMoney(basic * PENSION_EMPLOYEE_RATE);
    const pensionEmployer = roundMoney(basic * PENSION_EMPLOYER_RATE);
    const net = roundMoney(basic + allowances - deductions - tax - pensionEmployee);
    return {
      employeeId: emp.id,
      basicSalary: basic,
      allowances,
      deductions,
      taxAmount: tax,
      pensionEmployee,
      pensionEmployer,
      netPay: net
    };
  });

  const totalGross = roundMoney(
    items.reduce((s, i) => s + i.basicSalary + i.allowances - i.deductions, 0)
  );
  const totalDeductions = roundMoney(
    items.reduce((s, i) => s + i.taxAmount + i.pensionEmployee + i.deductions, 0)
  );
  const totalNet = roundMoney(items.reduce((s, i) => s + i.netPay, 0));

  const runNumber = body.run_number || body.runNumber || (await nextRunNumber(user.businessId));

  const created = await prisma.payrollRun.create({
    data: {
      id: shortId('pay'),
      businessId: user.businessId,
      branchId,
      runNumber,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      payDate,
      status: 'draft',
      totalGross: toDec(totalGross),
      totalDeductions: toDec(totalDeductions),
      totalNet: toDec(totalNet),
      notes: body.notes || null,
      createdById: user.id,
      items: {
        create: items.map((i) => ({
          id: shortId('pyi'),
          employeeId: i.employeeId,
          basicSalary: toDec(i.basicSalary),
          allowances: toDec(i.allowances),
          deductions: toDec(i.deductions),
          taxAmount: toDec(i.taxAmount),
          pensionEmployee: toDec(i.pensionEmployee),
          pensionEmployer: toDec(i.pensionEmployer),
          netPay: toDec(i.netPay)
        }))
      }
    },
    include: runInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'payroll',
    entityType: 'PayrollRun',
    entityId: created.id,
    summary: `Created payroll run ${runNumber}`
  });
  return serialize(created);
}

/**
 * Post payroll:
 * Dr salary_expense (gross + employer pension)
 * Cr salary_payable (net)
 * Cr paye_payable (tax)
 * Cr pension_payable (employee + employer)
 */
export async function postRun(user: AuthUser, id: string) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (run.status !== 'draft') throw httpError(400, 'Only draft payroll runs can be posted');
  if (!run.items.length) throw httpError(400, 'Payroll run has no items');

  const map = await getDefaultAccountMap(user.businessId);
  if (!map.salary_expense) throw httpError(400, 'salary_expense is not configured');
  if (!map.salary_payable) throw httpError(400, 'salary_payable is not configured');
  if (!map.paye_payable) throw httpError(400, 'paye_payable is not configured');
  if (!map.pension_payable) throw httpError(400, 'pension_payable is not configured');

  const gross = roundMoney(
    run.items.reduce((s, i) => s + Number(i.basicSalary) + Number(i.allowances) - Number(i.deductions), 0)
  );
  const tax = roundMoney(run.items.reduce((s, i) => s + Number(i.taxAmount), 0));
  const pensionEmployee = roundMoney(run.items.reduce((s, i) => s + Number(i.pensionEmployee), 0));
  const pensionEmployer = roundMoney(run.items.reduce((s, i) => s + Number(i.pensionEmployer), 0));
  const net = roundMoney(run.items.reduce((s, i) => s + Number(i.netPay), 0));
  const expenseTotal = roundMoney(gross + pensionEmployer);
  const pensionTotal = roundMoney(pensionEmployee + pensionEmployer);

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
        lines: [
          {
            account_id: map.salary_expense,
            debit: expenseTotal,
            description: `Salary expense ${run.runNumber}`
          },
          {
            account_id: map.salary_payable,
            credit: net,
            description: `Net pay ${run.runNumber}`
          },
          {
            account_id: map.paye_payable,
            credit: tax,
            description: `PAYE ${run.runNumber}`
          },
          {
            account_id: map.pension_payable,
            credit: pensionTotal,
            description: `Pension ${run.runNumber}`
          }
        ].filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0)
      },
      tx
    );

    return tx.payrollRun.update({
      where: { id },
      data: {
        status: 'posted',
        journalEntryId: (journal as any).id,
        totalGross: toDec(gross),
        totalDeductions: toDec(roundMoney(tax + pensionEmployee)),
        totalNet: toDec(net)
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
    summary: `Posted payroll ${run.runNumber}`
  });
  return serialize(result);
}

/** Pay net salaries: Dr salary_payable / Cr bank|cash */
export async function payRun(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, businessId: user.businessId }
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

    return tx.payrollRun.update({
      where: { id },
      data: { paymentJournalEntryId: (journal as any).id },
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
