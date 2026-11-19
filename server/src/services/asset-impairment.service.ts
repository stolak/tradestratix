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
  return nextDocNumber(prisma.assetImpairment, businessId, 'impairmentNumber', 'AIM', 5);
}

async function recordEvent(tx: any, opts: {
  businessId: string;
  assetId: string;
  sourceId: string;
  amount: number;
  journalEntryId?: string | null;
  summary: string;
  createdById?: string | null;
}) {
  await tx.assetAccountingEvent.create({
    data: {
      id: shortId('aae'),
      businessId: opts.businessId,
      assetId: opts.assetId,
      eventType: 'impairment',
      sourceType: 'AssetImpairment',
      sourceId: opts.sourceId,
      amount: toDec(roundMoney(opts.amount)),
      journalEntryId: opts.journalEntryId || null,
      summary: opts.summary,
      createdById: opts.createdById || null
    }
  });
}

export async function listImpairments(user: AuthUser, opts?: { asset_id?: string; status?: string }) {
  const rows = await prisma.assetImpairment.findMany({
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

export async function createImpairment(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, businessId: user.businessId },
    include: { assetCategory: true }
  });
  if (!asset) throw httpError(404, 'Asset not found');
  if (asset.financialStatus === 'disposed' || asset.operationalStatus === 'disposed') {
    throw httpError(400, 'Disposed assets cannot be impaired');
  }
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw httpError(400, 'amount must be > 0');
  const carryingBefore = netBookValue(asset);
  if (amount > carryingBefore) {
    throw httpError(400, `Impairment ${amount} exceeds carrying amount ${carryingBefore}`);
  }
  const impairmentDate = new Date(body.impairment_date || body.impairmentDate || new Date());
  if (Number.isNaN(impairmentDate.getTime())) throw httpError(400, 'Invalid impairment_date');

  const impairmentNumber = await nextNumber(user.businessId);
  const row = await prisma.assetImpairment.create({
    data: {
      id: shortId('aim'),
      businessId: user.businessId,
      branchId: asset.branchId,
      impairmentNumber,
      assetId,
      status: 'draft',
      impairmentDate,
      amount: toDec(amount),
      carryingBefore: toDec(carryingBefore),
      carryingAfter: toDec(roundMoney(carryingBefore - amount)),
      reason: body.reason || null,
      createdById: user.id
    },
    include
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetImpairment',
    entityId: row.id,
    summary: `Draft impairment ${impairmentNumber} for ${asset.code || asset.name}`
  });
  return serialize(row);
}

export async function postImpairment(user: AuthUser, id: string) {
  const existing = await prisma.assetImpairment.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      asset: { include: { assetCategory: true } }
    }
  });
  if (!existing) throw httpError(404, 'Impairment not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft impairments can be posted');

  const asset = existing.asset;
  const amount = roundMoney(Number(existing.amount));
  const carryingBefore = netBookValue(asset);
  if (amount > carryingBefore) {
    throw httpError(400, `Impairment ${amount} exceeds current carrying amount ${carryingBefore}`);
  }

  const map = await getDefaultAccountMap(user.businessId);
  const expenseId =
    asset.assetCategory?.impairmentAccountId || map.impairment_expense || null;
  const accumId = map.accumulated_impairment || null;
  if (!expenseId) throw httpError(400, 'impairment_expense GL account is not configured');
  if (!accumId) throw httpError(400, 'accumulated_impairment GL account is not configured');

  const entryDate = existing.impairmentDate;
  const today = new Date();
  const journalDate = entryDate.getTime() > today.getTime() ? today : entryDate;

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: journalDate,
        memo: `Asset impairment — ${existing.impairmentNumber}`,
        source_type: 'asset_impairment',
        source_id: existing.id,
        idempotency_key: `asset_impairment:${existing.id}`,
        branch_id: existing.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: expenseId,
            debit: amount,
            description: `Impairment — ${asset.name}`
          },
          {
            account_id: accumId,
            credit: amount,
            description: `Accum. impairment — ${asset.name}`
          }
        ]
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;
    const newAccum = roundMoney(Number(asset.accumulatedImpairment || 0) + amount);
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        accumulatedImpairment: toDec(newAccum),
        financialStatus: 'impaired',
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
        toValue: 'impaired',
        reason: existing.reason || `Impairment ${existing.impairmentNumber}`,
        changedById: user.id
      }
    });
    const updated = await tx.assetImpairment.update({
      where: { id },
      data: {
        status: 'posted',
        carryingBefore: toDec(carryingBefore),
        carryingAfter: toDec(roundMoney(carryingBefore - amount)),
        journalEntryId,
        postedAt: new Date(),
        postedById: user.id
      },
      include
    });
    await recordEvent(tx, {
      businessId: user.businessId,
      assetId: asset.id,
      sourceId: id,
      amount,
      journalEntryId,
      summary: `Posted impairment ${existing.impairmentNumber}`,
      createdById: user.id
    });
    return updated;
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'assets',
    entityType: 'AssetImpairment',
    entityId: id,
    summary: `Posted impairment ${existing.impairmentNumber}`
  });
  return serialize(result);
}
