import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  roundMoney,
  serialize,
  shortId,
  toDec
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import { netBookValue } from './asset.service.js';

const include = {
  asset: { select: { id: true, code: true, name: true, financialStatus: true } }
};

async function nextNumber(businessId: string) {
  return nextDocNumber(prisma.assetRevaluation, businessId, 'revaluationNumber', 'ARV', 5);
}

export async function listRevaluations(user: AuthUser, opts?: { asset_id?: string; status?: string }) {
  const rows = await prisma.assetRevaluation.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts?.status ? { status: opts.status } : {})
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function createRevaluation(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, businessId: user.businessId }
  });
  if (!asset) throw httpError(404, 'Asset not found');
  if (asset.financialStatus === 'disposed' || asset.operationalStatus === 'disposed') {
    throw httpError(400, 'Disposed assets cannot be revalued');
  }
  const newCarrying = roundMoney(Number(body.new_carrying_amount ?? body.newCarryingAmount));
  if (!(newCarrying >= 0)) throw httpError(400, 'new_carrying_amount must be >= 0');
  const carryingBefore = netBookValue(asset);
  const adjustment = roundMoney(newCarrying - carryingBefore);
  if (adjustment === 0) throw httpError(400, 'new_carrying_amount equals current carrying amount');

  const revaluationDate = new Date(body.revaluation_date || body.revaluationDate || new Date());
  if (Number.isNaN(revaluationDate.getTime())) throw httpError(400, 'Invalid revaluation_date');

  const revaluationNumber = await nextNumber(user.businessId);
  const row = await prisma.assetRevaluation.create({
    data: {
      id: shortId('arv'),
      businessId: user.businessId,
      branchId: asset.branchId,
      revaluationNumber,
      assetId,
      status: 'draft',
      revaluationDate,
      newCarryingAmount: toDec(newCarrying),
      carryingBefore: toDec(carryingBefore),
      adjustmentAmount: toDec(adjustment),
      reason: body.reason || null,
      createdById: user.id
    },
    include
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetRevaluation',
    entityId: row.id,
    summary: `Draft revaluation ${revaluationNumber} for ${asset.code || asset.name}`
  });
  return serialize(row);
}

export async function postRevaluation(user: AuthUser, id: string) {
  const existing = await prisma.assetRevaluation.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      asset: { include: { assetCategory: true } }
    }
  });
  if (!existing) throw httpError(404, 'Revaluation not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft revaluations can be posted');

  const asset = existing.asset;
  const carryingBefore = netBookValue(asset);
  const newCarrying = roundMoney(Number(existing.newCarryingAmount));
  const adjustment = roundMoney(newCarrying - carryingBefore);
  if (adjustment === 0) throw httpError(400, 'No adjustment to post');

  const map = await getDefaultAccountMap(user.businessId);
  const costAccountId = asset.costAccountId || asset.assetCategory?.costAccountId || map.fixed_assets;
  if (!costAccountId) throw httpError(400, 'fixed_assets GL account is not configured');

  const surplusId = map.asset_revaluation_surplus || map.equity || null;
  const downExpenseId = map.impairment_expense || map.asset_disposal_loss || null;

  const absAdj = Math.abs(adjustment);
  const lines: { account_id: string; debit?: number; credit?: number; description: string }[] = [];

  if (adjustment > 0) {
    if (!surplusId) throw httpError(400, 'asset_revaluation_surplus (or equity) is not configured');
    lines.push({
      account_id: costAccountId,
      debit: absAdj,
      description: `Revaluation uplift — ${asset.name}`
    });
    lines.push({
      account_id: surplusId,
      credit: absAdj,
      description: `Revaluation surplus — ${asset.name}`
    });
  } else {
    if (!downExpenseId) throw httpError(400, 'impairment_expense GL account is not configured');
    lines.push({
      account_id: downExpenseId,
      debit: absAdj,
      description: `Revaluation decrease — ${asset.name}`
    });
    lines.push({
      account_id: costAccountId,
      credit: absAdj,
      description: `Reduce cost — ${asset.name}`
    });
  }

  const today = new Date();
  const journalDate =
    existing.revaluationDate.getTime() > today.getTime() ? today : existing.revaluationDate;

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: journalDate,
        memo: `Asset revaluation — ${existing.revaluationNumber}`,
        source_type: 'asset_revaluation',
        source_id: existing.id,
        idempotency_key: `asset_revaluation:${existing.id}`,
        branch_id: existing.branchId || undefined,
        post: true,
        lines
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;

    // Adjust purchaseCost so NBV moves by adjustment (cost ± adj)
    const newPurchaseCost = roundMoney(Number(asset.purchaseCost) + adjustment);
    if (newPurchaseCost < 0) throw httpError(400, 'Revaluation would drive cost negative');

    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        purchaseCost: toDec(newPurchaseCost),
        version: { increment: 1 }
      }
    });

    const updated = await tx.assetRevaluation.update({
      where: { id },
      data: {
        status: 'posted',
        carryingBefore: toDec(carryingBefore),
        adjustmentAmount: toDec(adjustment),
        journalEntryId,
        postedAt: new Date(),
        postedById: user.id
      },
      include
    });

    await tx.assetAccountingEvent.create({
      data: {
        id: shortId('aae'),
        businessId: user.businessId,
        assetId: asset.id,
        eventType: 'revaluation',
        sourceType: 'AssetRevaluation',
        sourceId: id,
        amount: toDec(adjustment),
        journalEntryId,
        summary: `Posted revaluation ${existing.revaluationNumber}`,
        createdById: user.id
      }
    });
    return updated;
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'AssetRevaluation',
    entityId: id,
    summary: `Posted revaluation ${existing.revaluationNumber}`
  });
  return serialize(result);
}
