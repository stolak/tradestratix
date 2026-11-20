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
import * as branchAccess from './branch-access.service.js';
import { createNotification } from './notification.service.js';

const include = {
  asset: { select: { id: true, code: true, name: true, financialStatus: true, operationalStatus: true } }
};

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

async function nextNumber(businessId: string) {
  return nextDocNumber(prisma.assetDisposal, businessId, 'disposalNumber', 'ADS', 5);
}

function snapshotFromAsset(asset: any, proceeds: number) {
  const costAmount = grossCost(asset);
  const accumDepAmount = roundMoney(Number(asset.accumulatedDepreciation || 0));
  const accumImpAmount = roundMoney(Number(asset.accumulatedImpairment || 0));
  const nbvAmount = netBookValue(asset);
  const gainLossAmount = roundMoney(proceeds - nbvAmount);
  return { costAmount, accumDepAmount, accumImpAmount, nbvAmount, gainLossAmount };
}

export async function listDisposals(user: AuthUser, opts?: { asset_id?: string; status?: string }) {
  const scope = await branchAccess.branchScopeWhereLoose(user, { allowConsolidated: true });
  const rows = await prisma.assetDisposal.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts?.status ? { status: opts.status } : {})
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function createDisposal(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, businessId: user.businessId }
  });
  if (!asset) throw httpError(404, 'Asset not found');
  if (asset.financialStatus === 'disposed' || asset.operationalStatus === 'disposed') {
    throw httpError(400, 'Asset is already disposed');
  }
  const pending = await prisma.assetDisposal.findFirst({
    where: {
      businessId: user.businessId,
      assetId,
      status: { in: ['draft', 'pending_approval', 'approved'] }
    }
  });
  if (pending) throw httpError(400, 'Asset already has an open disposal');

  const proceeds = roundMoney(Number(body.proceeds ?? 0));
  if (proceeds < 0) throw httpError(400, 'proceeds cannot be negative');
  const disposalDate = new Date(body.disposal_date || body.disposalDate || new Date());
  if (Number.isNaN(disposalDate.getTime())) throw httpError(400, 'Invalid disposal_date');
  const snap = snapshotFromAsset(asset, proceeds);
  const disposalNumber = await nextNumber(user.businessId);

  const row = await prisma.assetDisposal.create({
    data: {
      id: shortId('ads'),
      businessId: user.businessId,
      branchId: asset.branchId,
      disposalNumber,
      assetId,
      status: 'draft',
      disposalType: body.disposal_type || body.disposalType || 'sale',
      disposalDate,
      proceeds: toDec(proceeds),
      proceedsMethod: body.proceeds_method || body.proceedsMethod || (proceeds > 0 ? 'bank' : 'none'),
      bankAccountId: body.bank_account_id || body.bankAccountId || null,
      costAmount: toDec(snap.costAmount),
      accumDepAmount: toDec(snap.accumDepAmount),
      accumImpAmount: toDec(snap.accumImpAmount),
      nbvAmount: toDec(snap.nbvAmount),
      gainLossAmount: toDec(snap.gainLossAmount),
      reason: body.reason || null,
      createdById: user.id
    },
    include
  });

  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: { operationalStatus: 'disposal_pending' }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetDisposal',
    entityId: row.id,
    summary: `Draft disposal ${disposalNumber} for ${asset.code || asset.name}`
  });
  return serialize(row);
}

export async function submitDisposal(user: AuthUser, id: string) {
  const existing = await prisma.assetDisposal.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Disposal not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft disposals can be submitted');
  const updated = await prisma.assetDisposal.update({
    where: { id },
    data: { status: 'pending_approval' },
    include
  });
  await createNotification({
    businessId: user.businessId,
    title: `Disposal pending approval — ${existing.disposalNumber}`,
    body: 'An asset disposal was submitted and needs approval before posting.',
    module: 'assets',
    entityType: 'AssetDisposal',
    entityId: id
  }).catch(() => undefined);
  return serialize(updated);
}

export async function approveDisposal(user: AuthUser, id: string) {
  const existing = await prisma.assetDisposal.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Disposal not found');
  if (existing.status !== 'pending_approval') {
    throw httpError(400, 'Only pending_approval disposals can be approved');
  }
  const updated = await prisma.assetDisposal.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.id
    },
    include
  });
  await createNotification({
    businessId: user.businessId,
    userId: existing.createdById,
    title: `Disposal approved — ${existing.disposalNumber}`,
    body: 'Disposal approved and ready to post.',
    module: 'assets',
    entityType: 'AssetDisposal',
    entityId: id
  }).catch(() => undefined);
  return serialize(updated);
}

export async function cancelDisposal(user: AuthUser, id: string) {
  const existing = await prisma.assetDisposal.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Disposal not found');
  if (existing.status === 'posted') throw httpError(400, 'Posted disposals cannot be cancelled');
  if (existing.status === 'cancelled') return serialize(await prisma.assetDisposal.findFirst({ where: { id }, include }));

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.assetDisposal.update({
      where: { id },
      data: { status: 'cancelled' },
      include
    });
    const asset = await tx.fixedAsset.findFirst({ where: { id: existing.assetId } });
    if (asset && asset.operationalStatus === 'disposal_pending') {
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { operationalStatus: 'in_use' }
      });
    }
    return row;
  });
  return serialize(updated);
}

export async function postDisposal(user: AuthUser, id: string) {
  const existing = await prisma.assetDisposal.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      asset: { include: { assetCategory: true } }
    }
  });
  if (!existing) throw httpError(404, 'Disposal not found');
  if (existing.status !== 'approved') {
    throw httpError(400, 'Only approved disposals can be posted');
  }

  const asset = existing.asset;
  if (asset.financialStatus === 'disposed') throw httpError(400, 'Asset already disposed');

  const proceeds = roundMoney(Number(existing.proceeds));
  const snap = snapshotFromAsset(asset, proceeds);
  const map = await getDefaultAccountMap(user.businessId);

  const costAccountId =
    asset.costAccountId || asset.assetCategory?.costAccountId || map.fixed_assets || null;
  const accumDepId =
    asset.accumDepAccountId || asset.assetCategory?.accumDepAccountId || map.accumulated_depreciation || null;
  const accumImpId = map.accumulated_impairment || null;
  const gainId =
    asset.assetCategory?.disposalGainAccountId || map.asset_disposal_gain || null;
  const lossId =
    asset.assetCategory?.disposalLossAccountId || map.asset_disposal_loss || null;

  if (!costAccountId) throw httpError(400, 'fixed_assets GL account is not configured');

  let proceedsAccountId: string | null = null;
  if (proceeds > 0) {
    const method = existing.proceedsMethod || 'bank';
    if (method === 'bank') {
      if (!existing.bankAccountId) throw httpError(400, 'bank_account_id is required for bank proceeds');
      const bank = await prisma.bankAccount.findFirst({
        where: { id: existing.bankAccountId, businessId: user.businessId }
      });
      if (!bank) throw httpError(400, 'Invalid bank_account_id');
      proceedsAccountId = bank.glAccountId;
    } else if (method === 'cash') {
      if (existing.bankAccountId) {
        const bank = await prisma.bankAccount.findFirst({
          where: { id: existing.bankAccountId, businessId: user.businessId }
        });
        if (!bank) throw httpError(400, 'Invalid bank_account_id');
        proceedsAccountId = bank.glAccountId;
      } else {
        proceedsAccountId = map.cash || null;
      }
    } else {
      proceedsAccountId = map.cash || map.bank || null;
    }
    if (!proceedsAccountId) throw httpError(400, 'Proceeds GL account is not configured');
  }

  const lines: { account_id: string; debit?: number; credit?: number; description: string }[] = [];

  if (snap.accumDepAmount > 0) {
    if (!accumDepId) throw httpError(400, 'accumulated_depreciation is not configured');
    lines.push({
      account_id: accumDepId,
      debit: snap.accumDepAmount,
      description: `Clear accum. dep. — ${asset.name}`
    });
  }
  if (snap.accumImpAmount > 0) {
    if (!accumImpId) throw httpError(400, 'accumulated_impairment is not configured');
    lines.push({
      account_id: accumImpId,
      debit: snap.accumImpAmount,
      description: `Clear accum. impairment — ${asset.name}`
    });
  }
  if (proceeds > 0 && proceedsAccountId) {
    lines.push({
      account_id: proceedsAccountId,
      debit: proceeds,
      description: `Disposal proceeds — ${asset.name}`
    });
  }
  if (snap.gainLossAmount < 0) {
    if (!lossId) throw httpError(400, 'asset_disposal_loss is not configured');
    lines.push({
      account_id: lossId,
      debit: Math.abs(snap.gainLossAmount),
      description: `Loss on disposal — ${asset.name}`
    });
  }

  lines.push({
    account_id: costAccountId,
    credit: snap.costAmount,
    description: `Remove cost — ${asset.name}`
  });

  if (snap.gainLossAmount > 0) {
    if (!gainId) throw httpError(400, 'asset_disposal_gain is not configured');
    lines.push({
      account_id: gainId,
      credit: snap.gainLossAmount,
      description: `Gain on disposal — ${asset.name}`
    });
  }

  const today = new Date();
  const journalDate =
    existing.disposalDate.getTime() > today.getTime() ? today : existing.disposalDate;

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: journalDate,
        memo: `Asset disposal — ${existing.disposalNumber}`,
        source_type: 'asset_disposal',
        source_id: existing.id,
        idempotency_key: `asset_disposal:${existing.id}`,
        branch_id: existing.branchId || undefined,
        post: true,
        lines
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;

    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        status: 'disposed',
        operationalStatus: 'disposed',
        financialStatus: 'disposed',
        version: { increment: 1 }
      }
    });
    await tx.assetStatusHistory.create({
      data: {
        id: shortId('ash'),
        businessId: user.businessId,
        assetId: asset.id,
        field: 'financial_status',
        fromValue: asset.financialStatus,
        toValue: 'disposed',
        reason: existing.reason || `Disposal ${existing.disposalNumber}`,
        changedById: user.id
      }
    });

    const updated = await tx.assetDisposal.update({
      where: { id },
      data: {
        status: 'posted',
        costAmount: toDec(snap.costAmount),
        accumDepAmount: toDec(snap.accumDepAmount),
        accumImpAmount: toDec(snap.accumImpAmount),
        nbvAmount: toDec(snap.nbvAmount),
        gainLossAmount: toDec(snap.gainLossAmount),
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
        eventType: 'disposal',
        sourceType: 'AssetDisposal',
        sourceId: id,
        amount: toDec(snap.gainLossAmount),
        journalEntryId,
        summary: `Posted disposal ${existing.disposalNumber}`,
        createdById: user.id
      }
    });
    return updated;
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'AssetDisposal',
    entityId: id,
    summary: `Posted disposal ${existing.disposalNumber}`
  });
  return serialize(result);
}
