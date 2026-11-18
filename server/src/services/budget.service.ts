import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const lineInclude = {
  account: true,
  assetCategory: true
};

export async function listBudgets(
  user: AuthUser,
  fiscalYear?: number,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.budget.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(fiscalYear ? { fiscalYear } : {})
    },
    include: {
      lines: { include: lineInclude },
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

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw httpError(400, 'At least one budget line is required');

  const lines: {
    accountId: string;
    assetCategoryId: string | null;
    periodNo: number;
    amount: number;
  }[] = [];

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const line = rawLines[idx];
    const amount = roundMoney(Number(line.amount ?? 0));
    if (amount < 0) throw httpError(400, `lines[${idx}].amount must be >= 0`);
    const periodNo = Number(line.period_no ?? line.periodNo ?? 0);

    let assetCategoryId: string | null =
      line.asset_category_id || line.assetCategoryId || body.asset_category_id || body.assetCategoryId || null;
    let accountId: string | null = line.account_id || line.accountId || null;

    if (assetCategoryId) {
      const cat = await prisma.assetCategory.findFirst({
        where: { id: assetCategoryId, businessId: user.businessId }
      });
      if (!cat) throw httpError(400, `lines[${idx}].asset_category_id is invalid`);
      // CapEx budget posts against the category cost account when present
      if (!accountId) {
        accountId = cat.costAccountId;
      }
      if (!accountId) {
        throw httpError(
          400,
          `Category ${cat.code} has no cost account — set it on Categories before budgeting`
        );
      }
      assetCategoryId = cat.id;
    }

    if (!accountId) {
      throw httpError(400, `lines[${idx}] requires asset_category_id or account_id`);
    }

    const acc = await prisma.account.findFirst({
      where: { id: accountId, businessId: user.businessId }
    });
    if (!acc) throw httpError(400, `Invalid account_id ${accountId}`);

    lines.push({
      accountId: String(accountId),
      assetCategoryId,
      periodNo,
      amount
    });
  }

  const budget = await prisma.budget.create({
    data: {
      id: shortId('bud'),
      businessId: user.businessId,
      branchId,
      name,
      fiscalYear,
      status: 'draft',
      notes: body.notes || null,
      createdById: user.id,
      lines: {
        create: lines.map((l) => ({
          id: shortId('bln'),
          accountId: l.accountId,
          assetCategoryId: l.assetCategoryId,
          periodNo: l.periodNo,
          amount: toDec(l.amount)
        }))
      }
    },
    include: { lines: { include: lineInclude } }
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
      include: { lines: { include: lineInclude } }
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
    include: { lines: { include: lineInclude } }
  });
  if (!budget) throw httpError(404, 'Budget not found');

  const yearStart = new Date(budget.fiscalYear, 0, 1);
  const yearEnd = new Date(budget.fiscalYear, 11, 31, 23, 59, 59);

  const categoryIds = [
    ...new Set(budget.lines.map((l) => l.assetCategoryId).filter(Boolean) as string[])
  ];

  /** CapEx actuals: capitalised asset cost by category in the fiscal year */
  const capexByCategory = new Map<string, number>();
  if (categoryIds.length) {
    const assets = await prisma.fixedAsset.findMany({
      where: {
        businessId,
        categoryId: { in: categoryIds },
        financialStatus: { in: ['capitalised', 'depreciating', 'fully_depreciated'] },
        OR: [
          { capitalisationDate: { gte: yearStart, lte: yearEnd } },
          {
            capitalisationDate: null,
            purchaseDate: { gte: yearStart, lte: yearEnd }
          }
        ]
      },
      select: {
        categoryId: true,
        purchaseCost: true,
        freightCost: true,
        installationCost: true,
        otherCapitalCost: true
      }
    });
    for (const a of assets) {
      if (!a.categoryId) continue;
      const cost = roundMoney(
        Number(a.purchaseCost || 0) +
          Number(a.freightCost || 0) +
          Number(a.installationCost || 0) +
          Number(a.otherCapitalCost || 0)
      );
      capexByCategory.set(a.categoryId, roundMoney((capexByCategory.get(a.categoryId) || 0) + cost));
    }
  }

  const accountIds = [...new Set(budget.lines.map((l) => l.accountId))];
  const journalLines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: accountIds },
      journalEntry: {
        businessId,
        status: 'posted',
        entryDate: { gte: yearStart, lte: yearEnd }
      }
    }
  });

  const actualByAccount = new Map<string, number>();
  for (const jl of journalLines) {
    const net = roundMoney(Number(jl.debit) - Number(jl.credit));
    actualByAccount.set(jl.accountId, roundMoney((actualByAccount.get(jl.accountId) || 0) + net));
  }

  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } } });
  const typeById = new Map(accounts.map((a) => [a.id, a.accountType]));

  const rows = budget.lines.map((line) => {
    const budgetAmt = Number(line.amount);
    let actual = 0;
    let actualSource: 'category_capex' | 'gl' = 'gl';

    if (line.assetCategoryId) {
      actual = capexByCategory.get(line.assetCategoryId) || 0;
      actualSource = 'category_capex';
    } else {
      const raw = actualByAccount.get(line.accountId) || 0;
      const t = typeById.get(line.accountId) || 'expense';
      actual =
        t === 'revenue' || t === 'liability' || t === 'equity'
          ? roundMoney(Math.abs(-raw))
          : roundMoney(Math.abs(raw));
    }

    return {
      account_id: line.accountId,
      account: serialize(line.account),
      asset_category_id: line.assetCategoryId,
      asset_category: line.assetCategory ? serialize(line.assetCategory) : null,
      period_no: line.periodNo,
      budget: budgetAmt,
      actual: roundMoney(actual),
      variance: roundMoney(budgetAmt - actual),
      actual_source: actualSource
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
