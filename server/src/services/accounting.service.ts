import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs']);

export async function listAccounts(businessId: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId },
    orderBy: { code: 'asc' }
  });
  return serialize(accounts);
}

async function assertValidParent(
  businessId: string,
  parentId: string | null | undefined,
  accountType: string
) {
  if (!parentId) return null;
  const parent = await prisma.account.findFirst({ where: { id: parentId, businessId } });
  if (!parent) throw httpError(400, 'Parent account not found');
  if (parent.accountType !== accountType) {
    throw httpError(
      400,
      `Parent account type (${parent.accountType}) must match child type (${accountType})`
    );
  }
  return parent;
}

export async function createAccount(user: AuthUser, body: Record<string, any>) {
  const accountType = String(body.account_type || body.accountType || '');
  if (!ACCOUNT_TYPES.has(accountType)) throw httpError(400, 'Invalid account_type');
  const code = requireString(body.code, 'code');
  const name = requireString(body.name, 'name');
  const parentId = body.parent_id || body.parentId || null;
  await assertValidParent(user.businessId, parentId, accountType);

  try {
    const created = await prisma.account.create({
      data: {
        id: shortId('acc'),
        businessId: user.businessId,
        code,
        name,
        accountType,
        parentId,
        isActive: body.is_active !== false && body.isActive !== false,
        description: body.description || null
      }
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'An account with this code already exists');
    throw err;
  }
}

export async function getDefaultAccountMap(businessId: string): Promise<Record<string, string>> {
  const settings = await prisma.defaultAccountSetting.findMany({ where: { businessId } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.settingKey] = s.accountId;
  return map;
}

export async function listDefaultAccountSettings(businessId: string) {
  const rows = await prisma.defaultAccountSetting.findMany({
    where: { businessId },
    include: { account: true }
  });
  return serialize(rows);
}

type JournalLineInput = {
  account_id?: string;
  accountId?: string;
  description?: string;
  debit?: number;
  credit?: number;
};

async function nextEntryNumber(businessId: string, tx: Prisma.TransactionClient) {
  const count = await tx.journalEntry.count({ where: { businessId } });
  return `JE-${String(count + 1).padStart(6, '0')}`;
}

/** Reject posts into locked accounting periods or closed financial years. */
export async function assertPeriodOpen(businessId: string, entryDate: Date | string) {
  const date = entryDate instanceof Date ? entryDate : new Date(entryDate);
  if (Number.isNaN(date.getTime())) throw httpError(400, 'Invalid entry date');

  const period = await prisma.accountingPeriod.findFirst({
    where: {
      businessId,
      startsOn: { lte: date },
      endsOn: { gte: date }
    },
    include: { financialYear: true }
  });

  if (period?.isLocked) {
    throw httpError(400, `Accounting period "${period.name}" is locked`);
  }
  if (period?.financialYear?.isClosed) {
    throw httpError(400, `Financial year "${period.financialYear.name}" is closed`);
  }
}

/**
 * Central posting engine: creates a balanced journal, optionally posts immediately.
 * Idempotent when idempotency_key or sourceType+sourceId is provided for posted entries.
 */
export async function createJournal(
  user: AuthUser,
  body: {
    entry_date?: string | Date;
    memo?: string;
    branch_id?: string;
    branchId?: string;
    source_type?: string;
    source_id?: string;
    sourceType?: string;
    sourceId?: string;
    idempotency_key?: string;
    idempotencyKey?: string;
    currency_code?: string;
    currencyCode?: string;
    post?: boolean;
    lines: JournalLineInput[];
  },
  outerTx?: Prisma.TransactionClient
) {
  const lines = body.lines || [];
  if (lines.length < 2) throw httpError(400, 'Journal requires at least two lines');

  const entryDateEarly = body.entry_date ? new Date(body.entry_date) : new Date();
  if (body.post !== false) {
    await assertPeriodOpen(user.businessId, entryDateEarly);
  }

  const normalized = lines.map((l, idx) => {
    const accountId = l.account_id || l.accountId;
    if (!accountId) throw httpError(400, `lines[${idx}].account_id is required`);
    const debit = roundMoney(Number(l.debit || 0));
    const credit = roundMoney(Number(l.credit || 0));
    if (debit < 0 || credit < 0) throw httpError(400, 'Debit/credit cannot be negative');
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw httpError(400, `lines[${idx}] must have either debit or credit`);
    }
    return {
      accountId,
      description: l.description || null,
      debit,
      credit,
      lineNo: idx + 1
    };
  });

  const totalDebit = roundMoney(normalized.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(normalized.reduce((s, l) => s + l.credit, 0));
  if (totalDebit !== totalCredit) {
    throw httpError(400, `Journal unbalanced: debit ${totalDebit} != credit ${totalCredit}`);
  }

  const sourceType = body.source_type || body.sourceType || null;
  const sourceId = body.source_id || body.sourceId || null;
  const idempotencyKey =
    body.idempotency_key ||
    body.idempotencyKey ||
    (sourceType && sourceId ? `${sourceType}:${sourceId}` : null);

  const client = outerTx || prisma;

  if (idempotencyKey) {
    const existing = await client.journalEntry.findFirst({
      where: { businessId: user.businessId, idempotencyKey },
      include: { lines: true }
    });
    if (existing) return serialize(existing);
  }

  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const accounts = await client.account.findMany({
    where: { businessId: user.businessId, id: { in: accountIds } }
  });
  if (accounts.length !== accountIds.length) {
    throw httpError(400, 'One or more accounts are invalid for this business');
  }

  const shouldPost = body.post !== false;
  const entryDate = body.entry_date ? new Date(body.entry_date) : new Date();

  const run = async (tx: Prisma.TransactionClient) => {
    const entryNumber = await nextEntryNumber(user.businessId, tx);
    return tx.journalEntry.create({
      data: {
        id: shortId('je'),
        businessId: user.businessId,
        branchId: body.branch_id || body.branchId || user.defaultBranchId || null,
        entryNumber,
        entryDate,
        memo: body.memo || null,
        status: shouldPost ? 'posted' : 'draft',
        sourceType,
        sourceId,
        idempotencyKey,
        currencyCode: body.currency_code || body.currencyCode || 'NGN',
        postedAt: shouldPost ? new Date() : null,
        postedById: shouldPost ? user.id : null,
        createdById: user.id,
        lines: {
          create: normalized.map((l) => ({
            id: shortId('jl'),
            accountId: l.accountId,
            description: l.description,
            debit: toDec(l.debit),
            credit: toDec(l.credit),
            lineNo: l.lineNo
          }))
        }
      },
      include: { lines: true }
    });
  };

  const created = outerTx ? await run(outerTx) : await prisma.$transaction(run);

  await writeAudit({
    user,
    action: shouldPost ? 'post' : 'create',
    module: 'accounting',
    entityType: 'JournalEntry',
    entityId: created.id,
    summary: `${shouldPost ? 'Posted' : 'Drafted'} journal ${created.entryNumber}`
  });

  return serialize(created);
}

export async function reverseJournal(user: AuthUser, id: string, memo?: string) {
  const original = await prisma.journalEntry.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!original) throw httpError(404, 'Journal not found');
  if (original.status !== 'posted') throw httpError(400, 'Only posted journals can be reversed');
  if (original.reversedByEntryId) throw httpError(400, 'Journal already reversed');

  const reversal = await createJournal(user, {
    entry_date: new Date(),
    memo: memo || `Reversal of ${original.entryNumber}`,
    branch_id: original.branchId || undefined,
    source_type: 'reversal',
    source_id: original.id,
    idempotency_key: `reversal:${original.id}`,
    currency_code: original.currencyCode,
    post: true,
    lines: original.lines.map((l) => ({
      account_id: l.accountId,
      description: l.description || undefined,
      debit: Number(l.credit),
      credit: Number(l.debit)
    }))
  });

  await prisma.journalEntry.update({
    where: { id: original.id },
    data: { status: 'reversed', reversedByEntryId: (reversal as any).id }
  });

  return reversal;
}

export async function listJournals(businessId: string, opts?: { limit?: number; status?: string }) {
  const rows = await prisma.journalEntry.findMany({
    where: {
      businessId,
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: { lines: { include: { account: true } } },
    orderBy: { entryDate: 'desc' },
    take: opts?.limit ?? 50
  });
  return serialize(rows);
}

export async function trialBalance(businessId: string) {
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: { businessId, status: 'posted' }
    },
    include: { account: true }
  });

  const map = new Map<
    string,
    { account_id: string; code: string; name: string; account_type: string; debit: number; credit: number }
  >();

  for (const line of lines) {
    const key = line.accountId;
    const cur = map.get(key) || {
      account_id: line.accountId,
      code: line.account.code,
      name: line.account.name,
      account_type: line.account.accountType,
      debit: 0,
      credit: 0
    };
    cur.debit = roundMoney(cur.debit + Number(line.debit));
    cur.credit = roundMoney(cur.credit + Number(line.credit));
    map.set(key, cur);
  }

  const rows = [...map.values()]
    .map((r) => {
      const net = roundMoney(r.debit - r.credit);
      return {
        ...r,
        balance_debit: net > 0 ? net : 0,
        balance_credit: net < 0 ? Math.abs(net) : 0
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = roundMoney(rows.reduce((s, r) => s + r.balance_debit, 0));
  const totalCredit = roundMoney(rows.reduce((s, r) => s + r.balance_credit, 0));

  return { rows, total_debit: totalDebit, total_credit: totalCredit, balanced: totalDebit === totalCredit };
}

export async function listPeriods(businessId: string) {
  const rows = await prisma.accountingPeriod.findMany({
    where: { businessId },
    include: { financialYear: true },
    orderBy: { startsOn: 'asc' }
  });
  return serialize(rows);
}

export async function setPeriodLocked(user: AuthUser, id: string, locked: boolean) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!period) throw httpError(404, 'Period not found');
  const updated = await prisma.accountingPeriod.update({
    where: { id },
    data: { isLocked: locked },
    include: { financialYear: true }
  });
  await writeAudit({
    user,
    action: 'edit',
    module: 'accounting',
    entityType: 'AccountingPeriod',
    entityId: id,
    summary: `${locked ? 'Locked' : 'Unlocked'} period ${updated.name}`
  });
  return serialize(updated);
}

function accountNet(debit: number, credit: number, accountType: string) {
  // Assets/expenses/cogs: debit-normal; liabilities/equity/revenue: credit-normal
  const debitNormal = ['asset', 'expense', 'cogs'].includes(accountType);
  return debitNormal ? roundMoney(debit - credit) : roundMoney(credit - debit);
}

async function postedLinesInRange(
  businessId: string,
  from?: Date | null,
  to?: Date | null
) {
  return prisma.journalLine.findMany({
    where: {
      journalEntry: {
        businessId,
        status: 'posted',
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      }
    },
    include: { account: true }
  });
}

export async function profitAndLoss(
  businessId: string,
  from?: string | Date,
  to?: string | Date
) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const lines = await postedLinesInRange(businessId, fromDate, toDate);

  const buckets: Record<string, { code: string; name: string; amount: number }[]> = {
    revenue: [],
    cogs: [],
    expense: []
  };
  const totals = { revenue: 0, cogs: 0, expense: 0 };

  const map = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  for (const line of lines) {
    const t = line.account.accountType;
    if (!['revenue', 'cogs', 'expense'].includes(t)) continue;
    const cur = map.get(line.accountId) || {
      code: line.account.code,
      name: line.account.name,
      type: t,
      debit: 0,
      credit: 0
    };
    cur.debit += Number(line.debit);
    cur.credit += Number(line.credit);
    map.set(line.accountId, cur);
  }

  for (const row of map.values()) {
    const amount = accountNet(row.debit, row.credit, row.type);
    buckets[row.type].push({ code: row.code, name: row.name, amount });
    totals[row.type as keyof typeof totals] = roundMoney(
      totals[row.type as keyof typeof totals] + amount
    );
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => a.code.localeCompare(b.code));
  }

  const grossProfit = roundMoney(totals.revenue - totals.cogs);
  const netProfit = roundMoney(grossProfit - totals.expense);

  return {
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    revenue: buckets.revenue,
    cogs: buckets.cogs,
    expenses: buckets.expense,
    totals: {
      revenue: totals.revenue,
      cogs: totals.cogs,
      expenses: totals.expense,
      gross_profit: grossProfit,
      net_profit: netProfit
    }
  };
}

export async function balanceSheet(businessId: string, asOf?: string | Date) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const lines = await postedLinesInRange(businessId, null, asOfDate);

  const map = new Map<
    string,
    { code: string; name: string; type: string; debit: number; credit: number }
  >();
  for (const line of lines) {
    const t = line.account.accountType;
    if (!['asset', 'liability', 'equity'].includes(t)) continue;
    const cur = map.get(line.accountId) || {
      code: line.account.code,
      name: line.account.name,
      type: t,
      debit: 0,
      credit: 0
    };
    cur.debit += Number(line.debit);
    cur.credit += Number(line.credit);
    map.set(line.accountId, cur);
  }

  const sections: Record<string, { code: string; name: string; amount: number }[]> = {
    asset: [],
    liability: [],
    equity: []
  };
  const totals = { asset: 0, liability: 0, equity: 0 };

  for (const row of map.values()) {
    const amount = accountNet(row.debit, row.credit, row.type);
    sections[row.type].push({ code: row.code, name: row.name, amount });
    totals[row.type as keyof typeof totals] = roundMoney(
      totals[row.type as keyof typeof totals] + amount
    );
  }

  // Fold P&L into equity as current-year earnings
  const pl = await profitAndLoss(businessId, undefined, asOfDate);
  const netProfit = pl.totals.net_profit;
  if (netProfit !== 0) {
    sections.equity.push({
      code: 'NI',
      name: 'Net income (current period)',
      amount: netProfit
    });
    totals.equity = roundMoney(totals.equity + netProfit);
  }

  for (const key of Object.keys(sections)) {
    sections[key].sort((a, b) => a.code.localeCompare(b.code));
  }

  const liabilitiesAndEquity = roundMoney(totals.liability + totals.equity);

  return {
    as_of: asOfDate.toISOString(),
    assets: sections.asset,
    liabilities: sections.liability,
    equity: sections.equity,
    totals: {
      assets: totals.asset,
      liabilities: totals.liability,
      equity: totals.equity,
      liabilities_and_equity: liabilitiesAndEquity,
      balanced: totals.asset === liabilitiesAndEquity
    }
  };
}
