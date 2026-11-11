import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const assetInclude = {
  branch: true,
  depreciationEntries: { orderBy: { periodLabel: 'desc' as const }, take: 24 }
};

export function monthlyDepreciationAmount(cost: number, salvage: number, usefulLifeMonths: number) {
  if (!usefulLifeMonths || usefulLifeMonths <= 0) return 0;
  return Math.max(0, roundMoney((cost - salvage) / usefulLifeMonths));
}

function defaultPeriodLabel(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function listAssets(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.fixedAsset.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: { branch: true },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function getAsset(businessId: string, id: string) {
  const row = await prisma.fixedAsset.findFirst({
    where: { id, businessId },
    include: assetInclude
  });
  if (!row) throw httpError(404, 'Asset not found');
  return serialize(row);
}

export async function createAsset(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const purchaseCost = roundMoney(Number(body.purchase_cost ?? body.purchaseCost ?? 0));
  if (purchaseCost <= 0) throw httpError(400, 'purchase_cost must be > 0');

  const salvageValue = roundMoney(Number(body.salvage_value ?? body.salvageValue ?? 0));
  const usefulLifeMonths = Number(body.useful_life_months ?? body.usefulLifeMonths ?? 36);
  if (!usefulLifeMonths || usefulLifeMonths <= 0) {
    throw httpError(400, 'useful_life_months must be > 0');
  }

  const purchaseDate = body.purchase_date || body.purchaseDate
    ? new Date(body.purchase_date || body.purchaseDate)
    : new Date();

  const payMethod = body.pay_method || body.payMethod || null;
  const shouldPost = Boolean(payMethod) || body.post === true;

  const assetId = shortId('fa');
  let acquisitionJournalEntryId: string | null = null;
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const created = await prisma.$transaction(async (tx) => {
    if (shouldPost) {
      const map = await getDefaultAccountMap(user.businessId);
      if (!map.fixed_assets) throw httpError(400, 'fixed_assets GL account is not configured');

      const method = String(payMethod || 'bank').toLowerCase();
      let creditAccountId =
        method === 'cash' ? map.cash : method === 'equity' ? map.equity : map.bank;
      if (method === 'bank' && (body.bank_account_id || body.bankAccountId)) {
        const bank = await tx.bankAccount.findFirst({
          where: { id: body.bank_account_id || body.bankAccountId, businessId: user.businessId }
        });
        if (!bank) throw httpError(400, 'Invalid bank_account_id');
        creditAccountId = bank.glAccountId;
      }
      if (!creditAccountId) throw httpError(400, 'Credit GL account is not configured for acquisition');

      const journal = await createJournal(
        user,
        {
          entry_date: purchaseDate,
          memo: `Asset acquisition — ${name}`,
          source_type: 'asset_acquisition',
          source_id: assetId,
          idempotency_key: `asset_acquisition:${assetId}`,
          branch_id: branchId,
          post: true,
          lines: [
            {
              account_id: map.fixed_assets,
              debit: purchaseCost,
              description: `Acquire ${name}`
            },
            {
              account_id: creditAccountId,
              credit: purchaseCost,
              description: `Pay ${method} for ${name}`
            }
          ]
        },
        tx
      );
      acquisitionJournalEntryId = (journal as any).id;
    }

    return tx.fixedAsset.create({
      data: {
        id: assetId,
        businessId: user.businessId,
        branchId,
        code: body.code ? String(body.code).trim() : null,
        name,
        category: body.category || 'equipment',
        purchaseDate,
        purchaseCost: toDec(purchaseCost),
        salvageValue: toDec(salvageValue),
        usefulLifeMonths,
        depreciationMethod: body.depreciation_method || body.depreciationMethod || 'straight_line',
        accumulatedDepreciation: toDec(0),
        status: 'active',
        notes: body.notes || null,
        acquisitionJournalEntryId,
        createdById: user.id
      },
      include: { branch: true }
    });
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'FixedAsset',
    entityId: created.id,
    summary: `Created asset ${name}`
  });
  return serialize(created);
}

export async function runDepreciation(
  user: AuthUser,
  opts: { period_label?: string; asset_ids?: string[] } = {}
) {
  const periodLabel = opts.period_label || defaultPeriodLabel();
  const map = await getDefaultAccountMap(user.businessId);
  if (!map.depreciation_expense) throw httpError(400, 'depreciation_expense is not configured');
  if (!map.accumulated_depreciation) {
    throw httpError(400, 'accumulated_depreciation is not configured');
  }

  const assets = await prisma.fixedAsset.findMany({
    where: {
      businessId: user.businessId,
      status: 'active',
      ...(opts.asset_ids?.length ? { id: { in: opts.asset_ids } } : {})
    }
  });

  const results: unknown[] = [];

  for (const asset of assets) {
    const cost = Number(asset.purchaseCost);
    const salvage = Number(asset.salvageValue);
    const accumulated = Number(asset.accumulatedDepreciation);
    const bookValue = roundMoney(cost - accumulated);
    if (bookValue <= salvage + 0.01) {
      if (asset.status === 'active') {
        await prisma.fixedAsset.update({
          where: { id: asset.id },
          data: { status: 'fully_depreciated' }
        });
      }
      continue;
    }

    const existing = await prisma.depreciationEntry.findUnique({
      where: { assetId_periodLabel: { assetId: asset.id, periodLabel } }
    });
    if (existing) continue;

    let amount = monthlyDepreciationAmount(cost, salvage, asset.usefulLifeMonths);
    const maxDep = roundMoney(bookValue - salvage);
    if (amount > maxDep) amount = maxDep;
    if (amount <= 0) continue;

    const entryId = shortId('dep');
    const posted = await prisma.$transaction(async (tx) => {
      const journal = await createJournal(
        user,
        {
          memo: `Depreciation ${periodLabel} — ${asset.name}`,
          source_type: 'depreciation',
          source_id: entryId,
          idempotency_key: `depreciation:${asset.id}:${periodLabel}`,
          branch_id: asset.branchId || undefined,
          post: true,
          lines: [
            {
              account_id: map.depreciation_expense,
              debit: amount,
              description: `Depreciation ${asset.name}`
            },
            {
              account_id: map.accumulated_depreciation,
              credit: amount,
              description: `Accum. dep. ${asset.name}`
            }
          ]
        },
        tx
      );

      const newAccum = roundMoney(accumulated + amount);
      const newBook = roundMoney(cost - newAccum);
      const fully = newBook <= salvage + 0.01;

      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          accumulatedDepreciation: toDec(newAccum),
          status: fully ? 'fully_depreciated' : 'active'
        }
      });

      return tx.depreciationEntry.create({
        data: {
          id: entryId,
          businessId: user.businessId,
          assetId: asset.id,
          periodLabel,
          runDate: new Date(),
          amount: toDec(amount),
          journalEntryId: (journal as any).id,
          createdById: user.id
        },
        include: { asset: true }
      });
    });

    results.push(serialize(posted));
  }

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'DepreciationEntry',
    entityId: periodLabel,
    summary: `Ran depreciation for ${periodLabel} (${results.length} entries)`
  });

  return { period_label: periodLabel, entries: results, count: results.length };
}

export async function listDepreciationEntries(
  businessId: string,
  opts: { asset_id?: string; period_label?: string } = {}
) {
  const rows = await prisma.depreciationEntry.findMany({
    where: {
      businessId,
      ...(opts.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts.period_label ? { periodLabel: opts.period_label } : {})
    },
    include: { asset: true },
    orderBy: [{ periodLabel: 'desc' }, { createdAt: 'desc' }],
    take: 200
  });
  return serialize(rows);
}
