import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import {
  assertPeriodOpen,
  createJournal,
  getDefaultAccountMap,
  reverseJournal
} from './accounting.service.js';
import { monthlyDepreciationAmount, netBookValue } from './asset.service.js';
import * as branchAccess from './branch-access.service.js';

const runInclude = {
  book: true,
  lines: {
    include: {
      asset: { select: { id: true, code: true, name: true, depreciationMethod: true } }
    },
    orderBy: [{ lineStatus: 'asc' as const }, { amount: 'desc' as const }]
  }
};

function defaultPeriodLabel(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parsePeriodLabel(label: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || '').trim());
  if (!m) throw httpError(400, 'period_label must be YYYY-MM');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw httpError(400, 'period_label month must be 01–12');
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return { year, month, periodStart, periodEnd, label: `${year}-${String(month).padStart(2, '0')}` };
}

function periodEntryDate(periodEnd: Date) {
  return periodEnd;
}

function assetCost(asset: {
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

/** Annual reducing-balance rate as decimal (e.g. 0.25). Monthly = rate/12. */
function reducingBalanceMonthlyAmount(
  openingNbv: number,
  residual: number,
  annualRate: number | null | undefined,
  usefulLifeMonths: number
) {
  const rate =
    annualRate != null && Number(annualRate) > 0
      ? Number(annualRate)
      : usefulLifeMonths > 0
        ? Math.min(1, 2 / (usefulLifeMonths / 12))
        : 0;
  if (rate <= 0) return 0;
  const raw = roundMoney(openingNbv * (rate / 12));
  const maxDep = roundMoney(Math.max(0, openingNbv - residual));
  return Math.min(raw, maxDep);
}

function unitsOfProductionAmount(
  cost: number,
  residual: number,
  estimatedUnits: number | null | undefined,
  actualUnits: number
) {
  const est = Number(estimatedUnits || 0);
  if (est <= 0 || actualUnits <= 0) return 0;
  const perUnit = (cost - residual) / est;
  return roundMoney(Math.max(0, perUnit * actualUnits));
}

export async function ensureDefaultBook(businessId: string) {
  let book = await prisma.assetDepreciationBook.findFirst({
    where: { businessId, code: 'financial' }
  });
  if (!book) {
    book = await prisma.assetDepreciationBook.create({
      data: {
        id: shortId('adb'),
        businessId,
        code: 'financial',
        name: 'Financial',
        isDefault: true,
        isActive: true
      }
    });
  }
  return book;
}

async function nextRunNumber(businessId: string) {
  const year = new Date().getFullYear();
  const prefix = `DEP-${year}-`;
  const latest = await prisma.assetDepreciationRun.findFirst({
    where: { businessId, runNumber: { startsWith: prefix } },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true }
  });
  const seq = latest ? Number(latest.runNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

type CalcLine = {
  assetId: string;
  branchId: string | null;
  method: string;
  costBasis: number;
  openingAccum: number;
  openingNbv: number;
  residual: number;
  unitsActual: number | null;
  amount: number;
  lineStatus: 'included' | 'skipped';
  exceptionReason: string | null;
};

function calculateLineForAsset(
  asset: any,
  period: { periodStart: Date; periodEnd: Date; label: string },
  unitsActual: number | undefined,
  alreadyPosted: boolean
): CalcLine {
  const method = String(asset.depreciationMethod || 'straight_line').toLowerCase();
  const cost = assetCost(asset);
  const residual = Number(asset.salvageValue || 0);
  const openingAccum = Number(asset.accumulatedDepreciation || 0);
  const openingNbv = netBookValue(asset);
  const base = {
    assetId: asset.id,
    branchId: asset.branchId || null,
    method,
    costBasis: cost,
    openingAccum,
    openingNbv,
    residual,
    unitsActual: unitsActual ?? null,
    amount: 0,
    lineStatus: 'skipped' as const,
    exceptionReason: null as string | null
  };

  if (alreadyPosted) {
    return { ...base, exceptionReason: `Already depreciated for ${period.label}` };
  }
  if (asset.financialStatus === 'disposed' || asset.financialStatus === 'not_capitalised') {
    return { ...base, exceptionReason: `Financial status is ${asset.financialStatus}` };
  }
  if (asset.status === 'disposed') {
    return { ...base, exceptionReason: 'Asset is disposed' };
  }
  const start = asset.depreciationStartDate || asset.availableForUseDate;
  if (start && new Date(start) > period.periodEnd) {
    return { ...base, exceptionReason: 'Not yet available for use in this period' };
  }
  if (method === 'none' || !asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) {
    return { ...base, exceptionReason: 'Non-depreciable (method none / zero life)' };
  }
  if (openingNbv <= residual + 0.01) {
    return { ...base, exceptionReason: 'Fully depreciated to residual' };
  }

  let amount = 0;
  if (method === 'reducing_balance') {
    amount = reducingBalanceMonthlyAmount(
      openingNbv,
      residual,
      asset.reducingBalanceRate != null ? Number(asset.reducingBalanceRate) : null,
      asset.usefulLifeMonths
    );
  } else if (method === 'units_of_production') {
    const units = Number(unitsActual ?? 0);
    if (units <= 0) {
      return {
        ...base,
        unitsActual: units || null,
        exceptionReason: 'Units of production requires actual units for the period'
      };
    }
    if (!asset.estimatedProductionUnits || Number(asset.estimatedProductionUnits) <= 0) {
      return {
        ...base,
        unitsActual: units,
        exceptionReason: 'estimated_production_units is not set on the asset'
      };
    }
    amount = unitsOfProductionAmount(
      cost,
      residual,
      Number(asset.estimatedProductionUnits),
      units
    );
  } else {
    // straight_line (default)
    amount = monthlyDepreciationAmount(cost, residual, asset.usefulLifeMonths);
  }

  const maxDep = roundMoney(openingNbv - residual);
  if (amount > maxDep) amount = maxDep;
  amount = roundMoney(amount);
  if (amount <= 0) {
    return { ...base, exceptionReason: 'Calculated amount is zero' };
  }

  return {
    ...base,
    amount,
    lineStatus: 'included',
    exceptionReason: null,
    unitsActual: method === 'units_of_production' ? Number(unitsActual || 0) : null
  };
}

export async function listRuns(
  user: AuthUser,
  opts?: { period_label?: string; status?: string; limit?: number }
) {
  await ensureDefaultBook(user.businessId);
  const rows = await prisma.assetDepreciationRun.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.period_label ? { periodLabel: opts.period_label } : {}),
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: {
      book: true,
      _count: { select: { lines: true } }
    },
    orderBy: [{ periodLabel: 'desc' }, { createdAt: 'desc' }],
    take: opts?.limit ?? 50
  });
  return serialize(rows);
}

export async function getRun(user: AuthUser, id: string) {
  const row = await prisma.assetDepreciationRun.findFirst({
    where: { id, businessId: user.businessId },
    include: runInclude
  });
  if (!row) throw httpError(404, 'Depreciation run not found');
  return serialize(row);
}

/**
 * Create a depreciation run and calculate preview lines.
 * Status ends as `previewed`.
 */
export async function createPreviewRun(user: AuthUser, body: Record<string, any> = {}) {
  const period = parsePeriodLabel(body.period_label || body.periodLabel || defaultPeriodLabel());
  const book = await ensureDefaultBook(user.businessId);
  const bookCode = book.code;

  const assetIds: string[] | undefined = body.asset_ids || body.assetIds || undefined;
  const unitsMap: Record<string, number> = {};
  const rawUnits = body.units || body.units_by_asset || body.unitsByAsset || {};
  if (rawUnits && typeof rawUnits === 'object') {
    for (const [k, v] of Object.entries(rawUnits)) {
      unitsMap[k] = Number(v);
    }
  }

  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: body.branch_id || body.branchId,
    allowConsolidated: true
  });

  const assets = await prisma.fixedAsset.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      status: { in: ['active', 'fully_depreciated'] },
      financialStatus: { in: ['capitalised', 'depreciating', 'fully_depreciated'] },
      ...(assetIds?.length ? { id: { in: assetIds } } : {})
    },
    include: {
      assetCategory: { select: { depExpenseAccountId: true, accumDepAccountId: true } }
    }
  });

  const existingEntries = await prisma.depreciationEntry.findMany({
    where: {
      businessId: user.businessId,
      periodLabel: period.label,
      bookCode,
      status: 'posted',
      assetId: { in: assets.map((a) => a.id) }
    },
    select: { assetId: true }
  });
  const postedSet = new Set(existingEntries.map((e) => e.assetId));

  const openRun = await prisma.assetDepreciationRun.findFirst({
    where: {
      businessId: user.businessId,
      bookId: book.id,
      periodLabel: period.label,
      status: { in: ['draft', 'previewed', 'approved'] }
    }
  });
  if (openRun) {
    throw httpError(
      400,
      `Open depreciation run ${openRun.runNumber} already exists for ${period.label} — approve/post or reverse first`
    );
  }

  const calcLines = assets.map((asset) =>
    calculateLineForAsset(asset, period, unitsMap[asset.id], postedSet.has(asset.id))
  );

  const included = calcLines.filter((l) => l.lineStatus === 'included');
  const totalAmount = roundMoney(included.reduce((s, l) => s + l.amount, 0));
  const runNumber = await nextRunNumber(user.businessId);

  const run = await prisma.assetDepreciationRun.create({
    data: {
      id: shortId('adr'),
      businessId: user.businessId,
      bookId: book.id,
      runNumber,
      periodLabel: period.label,
      status: 'previewed',
      totalAmount: toDec(totalAmount),
      lineCount: calcLines.length,
      includedCount: included.length,
      notes: body.notes || null,
      previewedAt: new Date(),
      createdById: user.id,
      lines: {
        create: calcLines.map((l) => ({
          id: shortId('adl'),
          businessId: user.businessId,
          assetId: l.assetId,
          branchId: l.branchId,
          method: l.method,
          costBasis: toDec(l.costBasis),
          openingAccum: toDec(l.openingAccum),
          openingNbv: toDec(l.openingNbv),
          residual: toDec(l.residual),
          unitsActual: l.unitsActual != null ? toDec(l.unitsActual) : null,
          amount: toDec(l.amount),
          lineStatus: l.lineStatus,
          exceptionReason: l.exceptionReason
        }))
      }
    },
    include: runInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetDepreciationRun',
    entityId: run.id,
    summary: `Previewed depreciation ${run.runNumber} ${period.label} (${included.length} lines, ${totalAmount})`
  });

  return serialize(run);
}

export async function approveRun(user: AuthUser, id: string) {
  const run = await prisma.assetDepreciationRun.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!run) throw httpError(404, 'Depreciation run not found');
  if (run.status !== 'previewed') {
    throw httpError(400, `Only previewed runs can be approved (status=${run.status})`);
  }
  if (run.includedCount <= 0) {
    throw httpError(400, 'Run has no included lines to approve');
  }

  const updated = await prisma.assetDepreciationRun.update({
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
    module: 'assets',
    entityType: 'AssetDepreciationRun',
    entityId: id,
    summary: `Approved depreciation ${run.runNumber}`
  });
  return serialize(updated);
}

export async function postRun(user: AuthUser, id: string) {
  const existing = await prisma.assetDepreciationRun.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      book: true,
      lines: {
        where: { lineStatus: 'included' },
        include: {
          asset: {
            include: {
              assetCategory: {
                select: { depExpenseAccountId: true, accumDepAccountId: true }
              }
            }
          }
        }
      }
    }
  });
  if (!existing) throw httpError(404, 'Depreciation run not found');
  if (existing.status !== 'approved') {
    throw httpError(400, `Only approved runs can be posted (status=${existing.status})`);
  }
  if (!existing.lines.length) throw httpError(400, 'No included lines to post');

  const period = parsePeriodLabel(existing.periodLabel);
  // Journal economic date = period end, but never in the future (createJournal rejects future dates)
  const today = new Date();
  const entryDate =
    period.periodEnd.getTime() > today.getTime() ? today : periodEntryDate(period.periodEnd);
  await assertPeriodOpen(user.businessId, entryDate);

  const map = await getDefaultAccountMap(user.businessId);
  if (!map.depreciation_expense) throw httpError(400, 'depreciation_expense is not configured');
  if (!map.accumulated_depreciation) {
    throw httpError(400, 'accumulated_depreciation is not configured');
  }

  // Re-check uniqueness
  const conflicts = await prisma.depreciationEntry.findMany({
    where: {
      businessId: user.businessId,
      bookCode: existing.book.code,
      periodLabel: existing.periodLabel,
      status: 'posted',
      assetId: { in: existing.lines.map((l) => l.assetId) }
    }
  });
  if (conflicts.length) {
    throw httpError(
      400,
      `Assets already posted for ${existing.periodLabel}: ${conflicts.map((c) => c.assetId).join(', ')}`
    );
  }

  const byBranch = new Map<string, typeof existing.lines>();
  for (const line of existing.lines) {
    const key = line.branchId || '__none__';
    const list = byBranch.get(key) || [];
    list.push(line);
    byBranch.set(key, list);
  }

  const result = await prisma.$transaction(async (tx) => {
    const journalIds: string[] = [];
    const entryByLine = new Map<string, string>();

    for (const [branchKey, lines] of byBranch) {
      const branchId = branchKey === '__none__' ? undefined : branchKey;
      const journalLines: {
        account_id: string;
        debit?: number;
        credit?: number;
        description: string;
      }[] = [];

      for (const line of lines) {
        const expenseId =
          line.asset.depExpenseAccountId ||
          line.asset.assetCategory?.depExpenseAccountId ||
          map.depreciation_expense;
        const accumId =
          line.asset.accumDepAccountId ||
          line.asset.assetCategory?.accumDepAccountId ||
          map.accumulated_depreciation;
        const amt = Number(line.amount);
        journalLines.push({
          account_id: expenseId!,
          debit: amt,
          description: `Dep ${existing.periodLabel} — ${line.asset.name}`
        });
        journalLines.push({
          account_id: accumId!,
          credit: amt,
          description: `Accum dep ${existing.periodLabel} — ${line.asset.name}`
        });
      }

      const journal = await createJournal(
        user,
        {
          entry_date: entryDate,
          memo: `Depreciation ${existing.runNumber} ${existing.periodLabel}`,
          source_type: 'depreciation_run',
          source_id: `${existing.id}:${branchKey}`,
          idempotency_key: `depreciation_run:${existing.id}:${branchKey}`,
          branch_id: branchId,
          post: true,
          lines: journalLines
        },
        tx
      );
      const journalId = (journal as any).id as string;
      journalIds.push(journalId);

      for (const line of lines) {
        const entryId = shortId('dep');
        await tx.depreciationEntry.create({
          data: {
            id: entryId,
            businessId: user.businessId,
            assetId: line.assetId,
            bookCode: existing.book.code,
            runId: existing.id,
            runLineId: line.id,
            periodLabel: existing.periodLabel,
            runDate: new Date(),
            amount: line.amount,
            journalEntryId: journalId,
            status: 'posted',
            createdById: user.id
          }
        });
        entryByLine.set(line.id, entryId);

        const asset = line.asset;
        const cost = assetCost(asset);
        const salvage = Number(asset.salvageValue || 0);
        const newAccum = roundMoney(Number(asset.accumulatedDepreciation) + Number(line.amount));
        const newNbv = roundMoney(
          cost - newAccum - Number(asset.accumulatedImpairment || 0)
        );
        const fully = newNbv <= salvage + 0.01;
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciation: toDec(newAccum),
            status: fully ? 'fully_depreciated' : 'active',
            financialStatus: fully ? 'fully_depreciated' : 'depreciating'
          }
        });

        await tx.assetDepreciationRunLine.update({
          where: { id: line.id },
          data: { depreciationEntryId: entryId }
        });
      }
    }

    const run = await tx.assetDepreciationRun.update({
      where: { id: existing.id },
      data: {
        status: 'posted',
        postedAt: new Date(),
        postedById: user.id,
        journalEntryIdsJson: JSON.stringify(journalIds)
      },
      include: runInclude
    });

    return { run, journalIds };
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'AssetDepreciationRun',
    entityId: id,
    summary: `Posted depreciation ${existing.runNumber} (${existing.includedCount} assets)`
  });

  return serialize({
    ...result.run,
    journal_entry_ids: result.journalIds
  });
}

export async function reverseRun(user: AuthUser, id: string) {
  const existing = await prisma.assetDepreciationRun.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      book: true,
      lines: { where: { lineStatus: 'included' } }
    }
  });
  if (!existing) throw httpError(404, 'Depreciation run not found');
  if (existing.status !== 'posted') {
    throw httpError(400, `Only posted runs can be reversed (status=${existing.status})`);
  }

  let journalIds: string[] = [];
  try {
    journalIds = existing.journalEntryIdsJson
      ? (JSON.parse(existing.journalEntryIdsJson) as string[])
      : [];
  } catch {
    journalIds = [];
  }

  for (const jid of journalIds) {
    await reverseJournal(user, jid, `Reversal of depreciation ${existing.runNumber}`);
  }

  await prisma.$transaction(async (tx) => {
    for (const line of existing.lines) {
      const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
      if (!asset) continue;
      const newAccum = roundMoney(
        Math.max(0, Number(asset.accumulatedDepreciation) - Number(line.amount))
      );
      const cost = assetCost(asset);
      const salvage = Number(asset.salvageValue || 0);
      const nbv = roundMoney(cost - newAccum - Number(asset.accumulatedImpairment || 0));
      const fully = nbv <= salvage + 0.01;
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          accumulatedDepreciation: toDec(newAccum),
          status: fully ? 'fully_depreciated' : 'active',
          financialStatus: fully ? 'fully_depreciated' : 'depreciating'
        }
      });
    }

    await tx.depreciationEntry.updateMany({
      where: { runId: existing.id, status: 'posted' },
      data: { status: 'reversed' }
    });

    await tx.assetDepreciationRun.update({
      where: { id: existing.id },
      data: {
        status: 'reversed',
        reversedAt: new Date(),
        reversedById: user.id
      }
    });
  });

  await writeAudit({
    user,
    action: 'reverse',
    module: 'assets',
    entityType: 'AssetDepreciationRun',
    entityId: id,
    summary: `Reversed depreciation ${existing.runNumber}`
  });

  return getRun(user, id);
}

/** Legacy one-shot: preview → approve → post for a period. */
export async function runDepreciationImmediate(
  user: AuthUser,
  opts: { period_label?: string; asset_ids?: string[]; units?: Record<string, number> } = {}
) {
  const preview = await createPreviewRun(user, {
    period_label: opts.period_label,
    asset_ids: opts.asset_ids,
    units: opts.units
  });
  if (!preview.included_count) {
    return {
      period_label: preview.period_label,
      run: preview,
      count: 0,
      entries: [],
      message: 'No assets to depreciate for this period'
    };
  }
  await approveRun(user, preview.id);
  const posted = await postRun(user, preview.id);
  const entries = await prisma.depreciationEntry.findMany({
    where: { runId: preview.id },
    include: { asset: true }
  });
  return {
    period_label: posted.period_label,
    run: posted,
    count: entries.length,
    entries: serialize(entries)
  };
}

export async function listDepreciationEntries(
  businessId: string,
  opts: { asset_id?: string; period_label?: string; run_id?: string } = {}
) {
  const rows = await prisma.depreciationEntry.findMany({
    where: {
      businessId,
      ...(opts.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts.period_label ? { periodLabel: opts.period_label } : {}),
      ...(opts.run_id ? { runId: opts.run_id } : {})
    },
    include: { asset: true },
    orderBy: [{ periodLabel: 'desc' }, { createdAt: 'desc' }],
    take: 200
  });
  return serialize(rows);
}
