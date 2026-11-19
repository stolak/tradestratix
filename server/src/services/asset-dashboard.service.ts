import { prisma } from '../utils/prisma.js';
import { roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';
import { getDefaultAccountMap, trialBalance } from './accounting.service.js';
import { netBookValue } from './asset.service.js';

function grossCost(asset: {
  purchaseCost: unknown;
  freightCost?: unknown;
  installationCost?: unknown;
  otherCapitalCost?: unknown;
}) {
  return roundMoney(
    Number(asset.purchaseCost || 0) +
      Number(asset.freightCost || 0) +
      Number(asset.installationCost || 0) +
      Number(asset.otherCapitalCost || 0)
  );
}

async function assetBranchScope(user: AuthUser, branchId?: string | null) {
  return branchAccess.branchScopeWhereLoose(user, {
    branchId: branchId || undefined,
    allowConsolidated: !branchId
  });
}

function isActiveRegister(financialStatus: string) {
  return financialStatus !== 'disposed';
}

export async function getDashboard(
  user: AuthUser,
  opts?: { branch_id?: string | null; as_at?: string }
) {
  const scope = await assetBranchScope(user, opts?.branch_id);
  const assets = await prisma.fixedAsset.findMany({
    where: { businessId: user.businessId, ...scope },
    select: {
      id: true,
      branchId: true,
      categoryId: true,
      financialStatus: true,
      operationalStatus: true,
      purchaseCost: true,
      freightCost: true,
      installationCost: true,
      otherCapitalCost: true,
      accumulatedDepreciation: true,
      accumulatedImpairment: true,
      assetCategory: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } }
    }
  });

  const active = assets.filter((a) => isActiveRegister(a.financialStatus));
  const disposed = assets.filter((a) => a.financialStatus === 'disposed');

  let totalCost = 0;
  let totalAccumDep = 0;
  let totalAccumImp = 0;
  let totalNbv = 0;
  const byFinancial: Record<string, { count: number; cost: number; nbv: number }> = {};
  const byOperational: Record<string, number> = {};
  const byCategory = new Map<
    string,
    { category_id: string | null; code: string; name: string; count: number; cost: number; nbv: number }
  >();
  const byBranch = new Map<
    string,
    { branch_id: string | null; code: string; name: string; count: number; cost: number; nbv: number }
  >();

  for (const a of active) {
    const cost = grossCost(a);
    const accumDep = roundMoney(Number(a.accumulatedDepreciation || 0));
    const accumImp = roundMoney(Number(a.accumulatedImpairment || 0));
    const nbv = netBookValue(a);
    totalCost = roundMoney(totalCost + cost);
    totalAccumDep = roundMoney(totalAccumDep + accumDep);
    totalAccumImp = roundMoney(totalAccumImp + accumImp);
    totalNbv = roundMoney(totalNbv + nbv);

    const fs = a.financialStatus || 'unknown';
    const fRow = byFinancial[fs] || { count: 0, cost: 0, nbv: 0 };
    fRow.count += 1;
    fRow.cost = roundMoney(fRow.cost + cost);
    fRow.nbv = roundMoney(fRow.nbv + nbv);
    byFinancial[fs] = fRow;

    const os = a.operationalStatus || 'unknown';
    byOperational[os] = (byOperational[os] || 0) + 1;

    const catKey = a.categoryId || '__none__';
    const cat = byCategory.get(catKey) || {
      category_id: a.categoryId,
      code: a.assetCategory?.code || '—',
      name: a.assetCategory?.name || 'Uncategorised',
      count: 0,
      cost: 0,
      nbv: 0
    };
    cat.count += 1;
    cat.cost = roundMoney(cat.cost + cost);
    cat.nbv = roundMoney(cat.nbv + nbv);
    byCategory.set(catKey, cat);

    const brKey = a.branchId || '__none__';
    const br = byBranch.get(brKey) || {
      branch_id: a.branchId,
      code: a.branch?.code || '—',
      name: a.branch?.name || 'Unassigned',
      count: 0,
      cost: 0,
      nbv: 0
    };
    br.count += 1;
    br.cost = roundMoney(br.cost + cost);
    br.nbv = roundMoney(br.nbv + nbv);
    byBranch.set(brKey, br);
  }

  const [openDepRuns, openCip, openDisposals, openVerify] = await Promise.all([
    prisma.assetDepreciationRun.count({
      where: {
        businessId: user.businessId,
        status: { in: ['previewed', 'approved'] }
      }
    }),
    prisma.capitalProject.count({
      where: {
        businessId: user.businessId,
        status: { in: ['draft', 'active', 'completed'] },
        ...(opts?.branch_id ? { branchId: opts.branch_id } : {})
      }
    }),
    prisma.assetDisposal.count({
      where: {
        businessId: user.businessId,
        status: { in: ['draft', 'pending_approval', 'approved'] },
        ...(opts?.branch_id ? { branchId: opts.branch_id } : {})
      }
    }),
    prisma.assetVerificationCampaign.count({
      where: {
        businessId: user.businessId,
        status: 'open',
        ...(opts?.branch_id ? { branchId: opts.branch_id } : {})
      }
    })
  ]);

  return serialize({
    as_at: opts?.as_at || new Date().toISOString().slice(0, 10),
    summary: {
      active_count: active.length,
      disposed_count: disposed.length,
      total_cost: totalCost,
      accumulated_depreciation: totalAccumDep,
      accumulated_impairment: totalAccumImp,
      net_book_value: totalNbv
    },
    by_financial_status: byFinancial,
    by_operational_status: byOperational,
    by_category: [...byCategory.values()].sort((a, b) => a.name.localeCompare(b.name)),
    by_branch: [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name)),
    workflow: {
      open_depreciation_runs: openDepRuns,
      open_cip_projects: openCip,
      open_disposals: openDisposals,
      open_verification_campaigns: openVerify
    }
  });
}

export async function getRegisterReport(
  user: AuthUser,
  opts?: {
    branch_id?: string | null;
    category_id?: string;
    financial_status?: string;
    include_disposed?: boolean;
  }
) {
  const scope = await assetBranchScope(user, opts?.branch_id);
  const rows = await prisma.fixedAsset.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.category_id ? { categoryId: opts.category_id } : {}),
      ...(opts?.financial_status
        ? { financialStatus: opts.financial_status }
        : opts?.include_disposed
          ? {}
          : { financialStatus: { not: 'disposed' } })
    },
    include: {
      assetCategory: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } }
    },
    orderBy: [{ code: 'asc' }, { name: 'asc' }],
    take: 2000
  });

  const lines = rows.map((a) => {
    const cost = grossCost(a);
    const accumDep = roundMoney(Number(a.accumulatedDepreciation || 0));
    const accumImp = roundMoney(Number(a.accumulatedImpairment || 0));
    const nbv = netBookValue(a);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      category: a.assetCategory
        ? { id: a.assetCategory.id, code: a.assetCategory.code, name: a.assetCategory.name }
        : null,
      branch: a.branch ? { id: a.branch.id, code: a.branch.code, name: a.branch.name } : null,
      location: a.location
        ? { id: a.location.id, code: a.location.code, name: a.location.name }
        : null,
      financial_status: a.financialStatus,
      operational_status: a.operationalStatus,
      cost,
      accumulated_depreciation: accumDep,
      accumulated_impairment: accumImp,
      net_book_value: nbv,
      useful_life_months: a.usefulLifeMonths,
      depreciation_method: a.depreciationMethod,
      available_for_use_date: a.availableForUseDate
    };
  });

  const totals = lines.reduce(
    (acc, l) => ({
      count: acc.count + 1,
      cost: roundMoney(acc.cost + l.cost),
      accumulated_depreciation: roundMoney(acc.accumulated_depreciation + l.accumulated_depreciation),
      accumulated_impairment: roundMoney(acc.accumulated_impairment + l.accumulated_impairment),
      net_book_value: roundMoney(acc.net_book_value + l.net_book_value)
    }),
    { count: 0, cost: 0, accumulated_depreciation: 0, accumulated_impairment: 0, net_book_value: 0 }
  );

  return serialize({ lines, totals });
}

/**
 * Register carrying amounts vs GL trial balance for mapped asset accounts.
 * Differences can come from timing, unposted runs, or unmapped category overrides.
 */
export async function getGlReconciliation(
  user: AuthUser,
  opts?: { branch_id?: string | null; as_at?: string }
) {
  const dash = await getDashboard(user, { branch_id: opts?.branch_id, as_at: opts?.as_at });
  const map = await getDefaultAccountMap(user.businessId);
  const tb = await trialBalance(user, {
    branchId: opts?.branch_id || undefined,
    allowConsolidated: !opts?.branch_id,
    asAt: opts?.as_at
  });

  const findGl = (accountId?: string | null) => {
    if (!accountId) return null;
    return tb.rows.find((r) => r.account_id === accountId) || null;
  };

  const glCost = findGl(map.fixed_assets);
  const glAccumDep = findGl(map.accumulated_depreciation);
  const glAccumImp = findGl(map.accumulated_impairment);
  const glCip = findGl(map.asset_cip);

  // CIP still on projects (not yet capitalised)
  const cipProjects = await prisma.capitalProject.findMany({
    where: {
      businessId: user.businessId,
      status: { in: ['draft', 'active', 'completed'] },
      ...(opts?.branch_id ? { branchId: opts.branch_id } : {})
    },
    select: { totalCost: true, status: true }
  });
  const registerCip = roundMoney(
    cipProjects.reduce((s, p) => s + Number(p.totalCost || 0), 0)
  );

  const register = dash.summary as {
    total_cost: number;
    accumulated_depreciation: number;
    accumulated_impairment: number;
    net_book_value: number;
  };

  // Asset accounts: debit balance expected for cost/CIP; credit-ish for contra (negative balance in TB)
  const glCostBal = roundMoney(glCost?.balance ?? 0);
  const glAccumDepBal = roundMoney(Math.abs(glAccumDep?.balance ?? 0));
  const glAccumImpBal = roundMoney(Math.abs(glAccumImp?.balance ?? 0));
  const glCipBal = roundMoney(glCip?.balance ?? 0);

  const lines = [
    {
      key: 'fixed_assets_cost',
      label: 'Fixed asset cost',
      account_id: map.fixed_assets || null,
      account_code: glCost?.code || null,
      register_amount: register.total_cost,
      gl_amount: glCostBal,
      difference: roundMoney(register.total_cost - glCostBal)
    },
    {
      key: 'accumulated_depreciation',
      label: 'Accumulated depreciation',
      account_id: map.accumulated_depreciation || null,
      account_code: glAccumDep?.code || null,
      register_amount: register.accumulated_depreciation,
      gl_amount: glAccumDepBal,
      difference: roundMoney(register.accumulated_depreciation - glAccumDepBal)
    },
    {
      key: 'accumulated_impairment',
      label: 'Accumulated impairment',
      account_id: map.accumulated_impairment || null,
      account_code: glAccumImp?.code || null,
      register_amount: register.accumulated_impairment,
      gl_amount: glAccumImpBal,
      difference: roundMoney(register.accumulated_impairment - glAccumImpBal)
    },
    {
      key: 'asset_cip',
      label: 'Capital work in progress',
      account_id: map.asset_cip || null,
      account_code: glCip?.code || null,
      register_amount: registerCip,
      gl_amount: glCipBal,
      difference: roundMoney(registerCip - glCipBal)
    },
    {
      key: 'net_book_value',
      label: 'Net book value (cost − accum. dep − accum. imp)',
      account_id: null,
      account_code: null,
      register_amount: register.net_book_value,
      gl_amount: roundMoney(glCostBal - glAccumDepBal - glAccumImpBal),
      difference: roundMoney(
        register.net_book_value - (glCostBal - glAccumDepBal - glAccumImpBal)
      )
    }
  ];

  const maxAbsDiff = Math.max(...lines.map((l) => Math.abs(l.difference)));
  return serialize({
    as_at: opts?.as_at || tb.as_at,
    branch_id: opts?.branch_id || null,
    balanced: maxAbsDiff < 0.02,
    max_abs_difference: maxAbsDiff,
    note:
      'Category/asset-level account overrides are not rolled into default-key GL balances; differences may be timing, unposted runs, or alternate account mappings.',
    lines,
    trial_balance_balanced: tb.balanced
  });
}

export async function getDepreciationSummary(
  user: AuthUser,
  opts?: { period_label?: string; branch_id?: string | null }
) {
  const periodLabel =
    opts?.period_label ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const runs = await prisma.assetDepreciationRun.findMany({
    where: {
      businessId: user.businessId,
      periodLabel,
      ...(opts?.branch_id
        ? {
            lines: { some: { branchId: opts.branch_id } }
          }
        : {})
    },
    include: {
      book: { select: { code: true, name: true } },
      lines: {
        where: opts?.branch_id ? { branchId: opts.branch_id } : undefined,
        select: { amount: true, lineStatus: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  if (!runs.length && !opts?.period_label) {
    // allow empty — still return structure
  }

  const summary = runs.map((r) => {
    const included = r.lines.filter((l) => l.lineStatus === 'included');
    const amount = roundMoney(included.reduce((s, l) => s + Number(l.amount || 0), 0));
    return {
      id: r.id,
      run_number: r.runNumber,
      period_label: r.periodLabel,
      status: r.status,
      book: r.book,
      line_count: r.lines.length,
      included_count: included.length,
      total_amount: amount
    };
  });

  return serialize({
    period_label: periodLabel,
    runs: summary,
    posted_total: roundMoney(
      summary.filter((s) => s.status === 'posted').reduce((a, s) => a + s.total_amount, 0)
    )
  });
}
