import { prisma } from '../utils/prisma.js';
import {
  httpError,
  requireString,
  roundMoney,
  serialize,
  shortId,
  toDec
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

const include = {
  parentAsset: { select: { id: true, code: true, name: true } },
  childAsset: { select: { id: true, code: true, name: true } }
};

export async function listComponents(user: AuthUser, opts?: { parent_asset_id?: string }) {
  const scope = await branchAccess.branchScopeWhereLoose(user, { allowConsolidated: true });
  const rows = await prisma.assetComponent.findMany({
    where: {
      businessId: user.businessId,
      parentAsset: scope,
      ...(opts?.parent_asset_id ? { parentAssetId: opts.parent_asset_id } : {})
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return serialize(rows);
}

export async function createComponent(user: AuthUser, body: Record<string, any>) {
  const parentAssetId = requireString(body.parent_asset_id || body.parentAssetId, 'parent_asset_id');
  const name = requireString(body.name, 'name');
  const parent = await prisma.fixedAsset.findFirst({
    where: { id: parentAssetId, businessId: user.businessId }
  });
  if (!parent) throw httpError(404, 'Parent asset not found');
  if (parent.financialStatus === 'disposed') throw httpError(400, 'Cannot add components to disposed assets');

  let childAssetId = body.child_asset_id || body.childAssetId || null;
  if (childAssetId) {
    if (childAssetId === parentAssetId) throw httpError(400, 'Child cannot be the parent');
    const child = await prisma.fixedAsset.findFirst({
      where: { id: childAssetId, businessId: user.businessId }
    });
    if (!child) throw httpError(400, 'Invalid child_asset_id');
  }

  const costAmount = roundMoney(Number(body.cost_amount ?? body.costAmount ?? 0));
  if (costAmount < 0) throw httpError(400, 'cost_amount cannot be negative');

  const result = await prisma.$transaction(async (tx) => {
    if (childAssetId) {
      await tx.fixedAsset.update({
        where: { id: childAssetId },
        data: { parentAssetId }
      });
    }
    const row = await tx.assetComponent.create({
      data: {
        id: shortId('acm'),
        businessId: user.businessId,
        parentAssetId,
        childAssetId,
        name,
        description: body.description || null,
        costAmount: toDec(costAmount),
        usefulLifeMonths:
          body.useful_life_months != null || body.usefulLifeMonths != null
            ? Number(body.useful_life_months ?? body.usefulLifeMonths)
            : null,
        status: 'active',
        createdById: user.id
      },
      include
    });
    await tx.assetAccountingEvent.create({
      data: {
        id: shortId('aae'),
        businessId: user.businessId,
        assetId: parentAssetId,
        eventType: 'component',
        sourceType: 'AssetComponent',
        sourceId: row.id,
        amount: toDec(costAmount),
        summary: `Component ${name} on ${parent.code || parent.name}`,
        createdById: user.id
      }
    });
    return row;
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetComponent',
    entityId: result.id,
    summary: `Added component ${name}`
  });
  return serialize(result);
}

export async function retireComponent(user: AuthUser, id: string) {
  const existing = await prisma.assetComponent.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Component not found');
  if (existing.status === 'retired') return serialize(await prisma.assetComponent.findFirst({ where: { id }, include }));

  const updated = await prisma.$transaction(async (tx) => {
    if (existing.childAssetId) {
      await tx.fixedAsset.update({
        where: { id: existing.childAssetId },
        data: { parentAssetId: null }
      });
    }
    return tx.assetComponent.update({
      where: { id },
      data: { status: 'retired' },
      include
    });
  });
  return serialize(updated);
}
