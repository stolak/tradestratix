import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  serialize,
  shortId
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import { createNotification } from './notification.service.js';

const transferInclude = {
  fromBranch: { select: { id: true, code: true, name: true } },
  toBranch: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      asset: { select: { id: true, code: true, name: true, operationalStatus: true } }
    }
  }
};

async function nextTransferNumber(businessId: string) {
  return nextDocNumber(prisma.assetTransfer, businessId, 'transferNumber', 'ATR', 5);
}

export async function listTransfers(
  user: AuthUser,
  opts?: { status?: string; branchId?: string | null; allowConsolidated?: boolean }
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated ?? true
  });
  const branchIds =
    typeof scope.branchId === 'string'
      ? [scope.branchId]
      : Array.isArray((scope.branchId as any)?.in)
        ? ((scope.branchId as any).in as string[])
        : [];
  const branchFilter = branchIds.length
    ? {
        OR: [
          { fromBranchId: { in: branchIds } },
          { toBranchId: { in: branchIds } }
        ]
      }
    : {};
  const rows = await prisma.assetTransfer.findMany({
    where: {
      businessId: user.businessId,
      ...branchFilter,
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: transferInclude,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function getTransfer(user: AuthUser, id: string) {
  const row = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: transferInclude
  });
  if (!row) throw httpError(404, 'Transfer not found');
  return serialize(row);
}

export async function createTransfer(user: AuthUser, body: Record<string, any>) {
  const toBranchId = body.to_branch_id || body.toBranchId || null;
  const fromBranchId =
    body.from_branch_id || body.fromBranchId || user.activeBranchId || null;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw httpError(400, 'At least one transfer line (asset) is required');
  if (!toBranchId && !rawLines.some((l: any) => l.to_location_id || l.toLocationId || l.to_custodian_id || l.toCustodianId || l.to_department || l.toDepartment)) {
    throw httpError(400, 'Provide to_branch_id and/or destination location/custodian/department on lines');
  }

  if (toBranchId) {
    const b = await prisma.branch.findFirst({
      where: { id: toBranchId, businessId: user.businessId }
    });
    if (!b) throw httpError(400, 'Invalid to_branch_id');
  }
  if (fromBranchId) {
    const b = await prisma.branch.findFirst({
      where: { id: fromBranchId, businessId: user.businessId }
    });
    if (!b) throw httpError(400, 'Invalid from_branch_id');
  }

  const assetIds = [
    ...new Set(
      rawLines.map((l: any) => requireString(l.asset_id || l.assetId, 'lines[].asset_id'))
    )
  ];
  const assets = await prisma.fixedAsset.findMany({
    where: { businessId: user.businessId, id: { in: assetIds } }
  });
  if (assets.length !== assetIds.length) throw httpError(400, 'One or more assets are invalid');
  for (const a of assets) {
    if (a.financialStatus === 'disposed' || a.operationalStatus === 'disposed') {
      throw httpError(400, `Asset ${a.code || a.name} is disposed`);
    }
    if (a.operationalStatus === 'transfer_pending') {
      throw httpError(400, `Asset ${a.code || a.name} already has a pending transfer`);
    }
  }
  const byId = new Map(assets.map((a) => [a.id, a]));

  const transferNumber = await nextTransferNumber(user.businessId);
  const id = shortId('atr');
  const row = await prisma.assetTransfer.create({
    data: {
      id,
      businessId: user.businessId,
      transferNumber,
      status: 'draft',
      fromBranchId,
      toBranchId,
      reason: body.reason || null,
      notes: body.notes || null,
      createdById: user.id,
      lines: {
        create: rawLines.map((l: any) => {
          const assetId = String(l.asset_id || l.assetId);
          const asset = byId.get(assetId)!;
          return {
            id: shortId('atl'),
            businessId: user.businessId,
            assetId,
            fromLocationId: asset.locationId,
            toLocationId: l.to_location_id || l.toLocationId || null,
            fromDepartment: asset.department,
            toDepartment: l.to_department || l.toDepartment || null,
            fromCustodianId: asset.custodianEmployeeId,
            toCustodianId: l.to_custodian_id || l.toCustodianId || null,
            notes: l.notes || null
          };
        })
      }
    },
    include: transferInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Created asset transfer ${transferNumber}`
  });
  return serialize(row);
}

export async function submitTransfer(user: AuthUser, id: string) {
  const existing = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft transfers can be submitted');
  if (!existing.lines.length) throw httpError(400, 'Transfer has no lines');

  const updated = await prisma.assetTransfer.update({
    where: { id },
    data: { status: 'pending_approval' },
    include: transferInclude
  });
  await writeAudit({
    user,
    action: 'submit',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Submitted transfer ${existing.transferNumber}`
  });
  await createNotification({
    businessId: user.businessId,
    title: `Transfer pending approval — ${existing.transferNumber}`,
    body: 'An asset transfer was submitted and needs approval.',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id
  }).catch(() => undefined);
  return serialize(updated);
}

export async function approveTransfer(user: AuthUser, id: string) {
  const existing = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (existing.status !== 'pending_approval') {
    throw httpError(400, 'Only submitted transfers can be approved');
  }
  const updated = await prisma.assetTransfer.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.id
    },
    include: transferInclude
  });
  await writeAudit({
    user,
    action: 'approve',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Approved transfer ${existing.transferNumber}`
  });
  await createNotification({
    businessId: user.businessId,
    userId: existing.createdById,
    title: `Transfer approved — ${existing.transferNumber}`,
    body: 'Transfer approved and ready to dispatch.',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id
  }).catch(() => undefined);
  return serialize(updated);
}

export async function dispatchTransfer(user: AuthUser, id: string) {
  const existing = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (existing.status !== 'approved') {
    throw httpError(400, 'Only approved transfers can be dispatched');
  }

  await prisma.$transaction(async (tx) => {
    for (const line of existing.lines) {
      const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
      if (!asset) continue;
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { operationalStatus: 'transfer_pending' }
      });
      await tx.assetStatusHistory.create({
        data: {
          id: shortId('ash'),
          businessId: user.businessId,
          assetId: asset.id,
          field: 'operational_status',
          fromValue: asset.operationalStatus,
          toValue: 'transfer_pending',
          reason: `Dispatch ${existing.transferNumber}`,
          changedById: user.id
        }
      });
    }
    await tx.assetTransfer.update({
      where: { id },
      data: {
        status: 'in_transit',
        dispatchedAt: new Date(),
        dispatchedById: user.id
      }
    });
  });

  await writeAudit({
    user,
    action: 'dispatch',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Dispatched transfer ${existing.transferNumber}`
  });
  return getTransfer(user, id);
}

export async function receiveTransfer(user: AuthUser, id: string) {
  const existing = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (existing.status !== 'in_transit') {
    throw httpError(400, 'Only in-transit transfers can be received');
  }

  await prisma.$transaction(async (tx) => {
    for (const line of existing.lines) {
      const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
      if (!asset) continue;
      const toBranchId = existing.toBranchId ?? asset.branchId;
      const toLocationId =
        line.toLocationId !== undefined && line.toLocationId !== null
          ? line.toLocationId
          : asset.locationId;
      const toDepartment =
        line.toDepartment !== undefined && line.toDepartment !== null
          ? line.toDepartment
          : asset.department;
      const toCustodianId =
        line.toCustodianId !== undefined && line.toCustodianId !== null
          ? line.toCustodianId
          : asset.custodianEmployeeId;

      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          branchId: toBranchId,
          locationId: toLocationId,
          department: toDepartment,
          custodianEmployeeId: toCustodianId,
          operationalStatus: 'in_use'
        }
      });
      await tx.assetAssignmentHistory.create({
        data: {
          id: shortId('aah'),
          businessId: user.businessId,
          assetId: asset.id,
          fromBranchId: asset.branchId,
          toBranchId,
          fromLocationId: asset.locationId,
          toLocationId,
          fromDepartment: asset.department,
          toDepartment,
          fromCustodianId: asset.custodianEmployeeId,
          toCustodianId,
          reason: `Received transfer ${existing.transferNumber}`,
          changedById: user.id
        }
      });
      await tx.assetStatusHistory.create({
        data: {
          id: shortId('ash'),
          businessId: user.businessId,
          assetId: asset.id,
          field: 'operational_status',
          fromValue: asset.operationalStatus,
          toValue: 'in_use',
          reason: `Received transfer ${existing.transferNumber}`,
          changedById: user.id
        }
      });
    }
    await tx.assetTransfer.update({
      where: { id },
      data: {
        status: 'received',
        receivedAt: new Date(),
        receivedById: user.id
      }
    });
  });

  await writeAudit({
    user,
    action: 'receive',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Received transfer ${existing.transferNumber}`
  });
  return getTransfer(user, id);
}

export async function cancelTransfer(user: AuthUser, id: string) {
  const existing = await prisma.assetTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (['received', 'cancelled'].includes(existing.status)) {
    throw httpError(400, 'Transfer cannot be cancelled');
  }

  await prisma.$transaction(async (tx) => {
    if (existing.status === 'in_transit') {
      for (const line of existing.lines) {
        const asset = await tx.fixedAsset.findFirst({ where: { id: line.assetId } });
        if (!asset || asset.operationalStatus !== 'transfer_pending') continue;
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { operationalStatus: 'in_use' }
        });
      }
    }
    await tx.assetTransfer.update({
      where: { id },
      data: { status: 'cancelled' }
    });
  });

  await writeAudit({
    user,
    action: 'cancel',
    module: 'assets',
    entityType: 'AssetTransfer',
    entityId: id,
    summary: `Cancelled transfer ${existing.transferNumber}`
  });
  return getTransfer(user, id);
}
