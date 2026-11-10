import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listBudgets(businessId: string, fiscalYear?: number) {
  const rows = await prisma.budget.findMany({
    where: {
      businessId,
      ...(fiscalYear ? { fiscalYear } : {})
    },
    include: {
      lines: { include: { account: true } },
      _count: { select: { lines: true } }
    },
    orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }]
  });
  return serialize(rows);
}

export async function createBudget(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const fiscalYear = Number(body.fiscal_year ?? body.fiscalYear ?? new Date().getFullYear());
  if (!fiscalYear) throw httpError(400, 'fiscal_year is required');

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw httpError(400, 'At least one budget line is required');

  const lines = rawLines.map((line: any, idx: number) => {
    const accountId = line.account_id || line.accountId;
    if (!accountId) throw httpError(400, `lines[${idx}].account_id is required`);
    const amount = roundMoney(Number(line.amount ?? 0));
    if (amount < 0) throw httpError(400, `lines[${idx}].amount must be >= 0`);
    return {
      accountId: String(accountId),
      periodNo: Number(line.period_no ?? line.periodNo ?? 0),
      amount
    };
  });

  for (const line of lines) {
    const acc = await prisma.account.findFirst({
      where: { id: line.accountId, businessId: user.businessId }
    });
    if (!acc) throw httpError(400, `Invalid account_id ${line.accountId}`);
  }

  const budget = await prisma.budget.create({
    data: {
      id: shortId('bud'),
      businessId: user.businessId,
      name,
      fiscalYear,
      status: 'draft',
      notes: body.notes || null,
      createdById: user.id,
      lines: {
        create: lines.map((l) => ({
          id: shortId('bln'),
          accountId: l.accountId,
          periodNo: l.periodNo,
          amount: toDec(l.amount)
        }))
      }
    },
    include: { lines: { include: { account: true } } }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'accounting',
    entityType: 'Budget',
    entityId: budget.id,
    summary: `Created budget ${name} FY${fiscalYear}`
  });
  return serialize(budget);
}

export async function activateBudget(user: AuthUser, id: string) {
  const budget = await prisma.budget.findFirst({ where: { id, businessId: user.businessId } });
  if (!budget) throw httpError(404, 'Budget not found');
  if (budget.status === 'closed') throw httpError(400, 'Closed budgets cannot be activated');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.budget.updateMany({
      where: {
        businessId: user.businessId,
        fiscalYear: budget.fiscalYear,
        status: 'active',
        id: { not: id }
      },
      data: { status: 'draft' }
    });
    return tx.budget.update({
      where: { id },
      data: { status: 'active' },
      include: { lines: { include: { account: true } } }
    });
  });

  await writeAudit({
    user,
    action: 'approve',
    module: 'accounting',
    entityType: 'Budget',
    entityId: id,
    summary: `Activated budget ${budget.name}`
  });
  return serialize(updated);
}

export async function budgetVsActual(businessId: string, budgetId: string) {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, businessId },
    include: { lines: { include: { account: true } } }
  });
  if (!budget) throw httpError(404, 'Budget not found');

  const yearStart = new Date(budget.fiscalYear, 0, 1);
  const yearEnd = new Date(budget.fiscalYear, 11, 31, 23, 59, 59);

  const accountIds = [...new Set(budget.lines.map((l) => l.accountId))];
  const journalLines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: accountIds },
      journalEntry: {
        businessId,
        status: 'posted',
        entryDate: { gte: yearStart, lte: yearEnd }
      }
    },
    include: { journalEntry: { select: { entryDate: true } } }
  });

  const actualByAccount = new Map<string, number>();
  for (const jl of journalLines) {
    const debit = Number(jl.debit);
    const credit = Number(jl.credit);
    const type = (jl as any).account?.accountType;
    // Prefer signed activity: expenses/cogs/assets use debit-credit; revenue/liability/equity credit-debit
    void type;
    const net = roundMoney(debit - credit);
    actualByAccount.set(jl.accountId, roundMoney((actualByAccount.get(jl.accountId) || 0) + net));
  }

  // Enrich with account types for proper sign
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } }
  });
  const typeById = new Map(accounts.map((a) => [a.id, a.accountType]));

  const rows = budget.lines.map((line) => {
    const raw = actualByAccount.get(line.accountId) || 0;
    const t = typeById.get(line.accountId) || 'expense';
    const actual =
      t === 'revenue' || t === 'liability' || t === 'equity' ? roundMoney(-raw) : raw;
    const budgetAmt = Number(line.amount);
    return {
      account_id: line.accountId,
      account: serialize(line.account),
      period_no: line.periodNo,
      budget: budgetAmt,
      actual: roundMoney(Math.abs(actual)),
      variance: roundMoney(budgetAmt - Math.abs(actual))
    };
  });

  return serialize({
    budget: {
      id: budget.id,
      name: budget.name,
      fiscal_year: budget.fiscalYear,
      status: budget.status
    },
    lines: rows
  });
}
