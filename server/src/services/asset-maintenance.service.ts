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
import { createStockMovement } from './inventory.service.js';

const requestInclude = {
  asset: { select: { id: true, code: true, name: true, operationalStatus: true } },
  workOrders: { select: { id: true, workOrderNumber: true, status: true } }
};

const woInclude = {
  asset: { select: { id: true, code: true, name: true, operationalStatus: true } },
  request: { select: { id: true, requestNumber: true, title: true } },
  costs: true
};

async function nextRequestNumber(businessId: string) {
  return nextDocNumber(prisma.assetMaintenanceRequest, businessId, 'requestNumber', 'AMR', 5);
}

async function nextWorkOrderNumber(businessId: string) {
  return nextDocNumber(prisma.assetMaintenanceWorkOrder, businessId, 'workOrderNumber', 'AWO', 5);
}

async function requireAsset(businessId: string, assetId: string) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, businessId } });
  if (!asset) throw httpError(404, 'Asset not found');
  if (asset.financialStatus === 'disposed' || asset.operationalStatus === 'disposed') {
    throw httpError(400, 'Disposed assets cannot be maintained');
  }
  return asset;
}

export async function listRequests(user: AuthUser, opts?: { status?: string; asset_id?: string }) {
  const rows = await prisma.assetMaintenanceRequest.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {})
    },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function createRequest(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  await requireAsset(user.businessId, assetId);
  const title = requireString(body.title, 'title');
  const requestNumber = await nextRequestNumber(user.businessId);
  const row = await prisma.assetMaintenanceRequest.create({
    data: {
      id: shortId('amr'),
      businessId: user.businessId,
      requestNumber,
      assetId,
      status: 'draft',
      requestType: body.request_type || body.requestType || 'corrective',
      priority: body.priority || 'medium',
      title,
      description: body.description || null,
      requestedById: user.id
    },
    include: requestInclude
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetMaintenanceRequest',
    entityId: row.id,
    summary: `Created maintenance request ${requestNumber}`
  });
  return serialize(row);
}

export async function submitRequest(user: AuthUser, id: string) {
  const existing = await prisma.assetMaintenanceRequest.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Maintenance request not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft requests can be submitted');
  const updated = await prisma.assetMaintenanceRequest.update({
    where: { id },
    data: { status: 'submitted' },
    include: requestInclude
  });
  return serialize(updated);
}

export async function approveRequest(user: AuthUser, id: string) {
  const existing = await prisma.assetMaintenanceRequest.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Maintenance request not found');
  if (!['submitted', 'draft'].includes(existing.status)) {
    throw httpError(400, 'Request cannot be approved in current status');
  }
  const updated = await prisma.assetMaintenanceRequest.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.id
    },
    include: requestInclude
  });
  await writeAudit({
    user,
    action: 'approve',
    module: 'assets',
    entityType: 'AssetMaintenanceRequest',
    entityId: id,
    summary: `Approved maintenance request ${existing.requestNumber}`
  });
  return serialize(updated);
}

export async function rejectRequest(user: AuthUser, id: string) {
  const existing = await prisma.assetMaintenanceRequest.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Maintenance request not found');
  if (!['submitted', 'draft'].includes(existing.status)) {
    throw httpError(400, 'Request cannot be rejected in current status');
  }
  const updated = await prisma.assetMaintenanceRequest.update({
    where: { id },
    data: { status: 'rejected' },
    include: requestInclude
  });
  return serialize(updated);
}

export async function listWorkOrders(user: AuthUser, opts?: { status?: string; asset_id?: string }) {
  const rows = await prisma.assetMaintenanceWorkOrder.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {})
    },
    include: woInclude,
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function getWorkOrder(user: AuthUser, id: string) {
  const row = await prisma.assetMaintenanceWorkOrder.findFirst({
    where: { id, businessId: user.businessId },
    include: woInclude
  });
  if (!row) throw httpError(404, 'Work order not found');
  return serialize(row);
}

export async function createWorkOrder(user: AuthUser, body: Record<string, any>) {
  let assetId = body.asset_id || body.assetId || null;
  let requestId = body.request_id || body.requestId || null;
  let title = body.title || null;
  let description = body.description || null;

  if (requestId) {
    const req = await prisma.assetMaintenanceRequest.findFirst({
      where: { id: requestId, businessId: user.businessId }
    });
    if (!req) throw httpError(404, 'Maintenance request not found');
    if (!['approved', 'submitted'].includes(req.status)) {
      throw httpError(400, 'Request must be approved (or submitted) before converting to a work order');
    }
    assetId = req.assetId;
    title = title || req.title;
    description = description || req.description;
  }

  assetId = requireString(assetId, 'asset_id');
  title = requireString(title, 'title');
  await requireAsset(user.businessId, assetId);

  const workOrderNumber = await nextWorkOrderNumber(user.businessId);
  const result = await prisma.$transaction(async (tx) => {
    const wo = await tx.assetMaintenanceWorkOrder.create({
      data: {
        id: shortId('awo'),
        businessId: user.businessId,
        workOrderNumber,
        requestId,
        assetId,
        status: 'open',
        title,
        description,
        assignedToName: body.assigned_to_name || body.assignedToName || null,
        createdById: user.id
      },
      include: woInclude
    });

    if (requestId) {
      await tx.assetMaintenanceRequest.update({
        where: { id: requestId },
        data: { status: 'converted' }
      });
    }

    const asset = await tx.fixedAsset.findFirst({ where: { id: assetId } });
    if (asset && asset.operationalStatus !== 'under_maintenance') {
      await tx.fixedAsset.update({
        where: { id: assetId },
        data: { operationalStatus: 'under_maintenance' }
      });
      await tx.assetStatusHistory.create({
        data: {
          id: shortId('ash'),
          businessId: user.businessId,
          assetId,
          field: 'operational_status',
          fromValue: asset.operationalStatus,
          toValue: 'under_maintenance',
          reason: `Work order ${workOrderNumber}`,
          changedById: user.id
        }
      });
    }
    return wo;
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetMaintenanceWorkOrder',
    entityId: result.id,
    summary: `Created work order ${workOrderNumber}`
  });
  return serialize(result);
}

export async function startWorkOrder(user: AuthUser, id: string) {
  const existing = await prisma.assetMaintenanceWorkOrder.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Work order not found');
  if (existing.status !== 'open') throw httpError(400, 'Only open work orders can be started');
  const updated = await prisma.assetMaintenanceWorkOrder.update({
    where: { id },
    data: { status: 'in_progress', startedAt: new Date() },
    include: woInclude
  });
  return serialize(updated);
}

export async function completeWorkOrder(user: AuthUser, id: string) {
  const existing = await prisma.assetMaintenanceWorkOrder.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Work order not found');
  if (!['open', 'in_progress'].includes(existing.status)) {
    throw httpError(400, 'Work order cannot be completed in current status');
  }

  await prisma.$transaction(async (tx) => {
    await tx.assetMaintenanceWorkOrder.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        completedById: user.id
      }
    });
    const openCount = await tx.assetMaintenanceWorkOrder.count({
      where: {
        businessId: user.businessId,
        assetId: existing.assetId,
        status: { in: ['open', 'in_progress'] },
        id: { not: id }
      }
    });
    if (openCount === 0) {
      const asset = await tx.fixedAsset.findFirst({ where: { id: existing.assetId } });
      if (asset && asset.operationalStatus === 'under_maintenance') {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { operationalStatus: 'in_use', lastMaintenanceDate: new Date() }
        });
        await tx.assetStatusHistory.create({
          data: {
            id: shortId('ash'),
            businessId: user.businessId,
            assetId: asset.id,
            field: 'operational_status',
            fromValue: 'under_maintenance',
            toValue: 'in_use',
            reason: `Completed work order ${existing.workOrderNumber}`,
            changedById: user.id
          }
        });
      }
    }
  });

  await writeAudit({
    user,
    action: 'complete',
    module: 'assets',
    entityType: 'AssetMaintenanceWorkOrder',
    entityId: id,
    summary: `Completed work order ${existing.workOrderNumber}`
  });
  return getWorkOrder(user, id);
}

export async function addMaintenanceCost(user: AuthUser, workOrderId: string, body: Record<string, any>) {
  const wo = await prisma.assetMaintenanceWorkOrder.findFirst({
    where: { id: workOrderId, businessId: user.businessId }
  });
  if (!wo) throw httpError(404, 'Work order not found');
  if (wo.status === 'cancelled' || wo.status === 'completed') {
    throw httpError(400, 'Cannot add costs to a completed/cancelled work order');
  }

  const description = requireString(body.description, 'description');
  const amount = roundMoney(Number(body.amount ?? 0));
  if (amount < 0) throw httpError(400, 'amount must be >= 0');

  const productId = body.product_id || body.productId || null;
  const warehouseId = body.warehouse_id || body.warehouseId || null;
  const quantity = body.quantity != null ? Number(body.quantity) : null;
  let stockMovementId: string | null = null;

  if (productId || warehouseId || quantity) {
    if (!productId || !warehouseId || !quantity || quantity <= 0) {
      throw httpError(400, 'Parts issue requires product_id, warehouse_id and quantity > 0');
    }
    const movement = await createStockMovement(user, {
      product_id: productId,
      warehouse_id: warehouseId,
      movement_type: 'asset_maintenance',
      quantity_in: 0,
      quantity_out: quantity,
      unit_cost: body.unit_cost ?? body.unitCost ?? null,
      reason: `Maintenance ${wo.workOrderNumber}: ${description}`,
      reference_type: 'asset_maintenance_cost',
      reference_id: workOrderId,
      idempotency_key: body.idempotency_key || `amc_stock:${workOrderId}:${shortId('t')}`
    });
    stockMovementId = (movement as any).id;
  }

  const row = await prisma.assetMaintenanceCost.create({
    data: {
      id: shortId('amc'),
      businessId: user.businessId,
      workOrderId,
      assetId: wo.assetId,
      costType: body.cost_type || body.costType || (productId ? 'parts' : 'other'),
      description,
      amount: toDec(amount),
      productId,
      warehouseId,
      quantity: quantity != null ? toDec(quantity) : null,
      stockMovementId,
      createdById: user.id
    }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetMaintenanceCost',
    entityId: row.id,
    summary: `Added maintenance cost ${amount} on ${wo.workOrderNumber}`
  });
  return serialize(row);
}
