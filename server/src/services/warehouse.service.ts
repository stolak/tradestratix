import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

async function warehouseIdsWithActivity(businessId: string, warehouseIds: string[]) {
  if (!warehouseIds.length) return new Set<string>();

  const whereIn = { businessId, warehouseId: { in: warehouseIds } };
  const [
    stockLots,
    stockMovements,
    transfersFrom,
    transfersTo,
    purchaseOrders,
    goodsReceipts,
    salesInvoices,
    deliveryOrders
  ] = await Promise.all([
    prisma.stockLot.findMany({ where: whereIn, select: { warehouseId: true }, distinct: ['warehouseId'] }),
    prisma.stockMovement.findMany({
      where: whereIn,
      select: { warehouseId: true },
      distinct: ['warehouseId']
    }),
    prisma.stockTransfer.findMany({
      where: { businessId, fromWarehouseId: { in: warehouseIds } },
      select: { fromWarehouseId: true },
      distinct: ['fromWarehouseId']
    }),
    prisma.stockTransfer.findMany({
      where: { businessId, toWarehouseId: { in: warehouseIds } },
      select: { toWarehouseId: true },
      distinct: ['toWarehouseId']
    }),
    prisma.purchaseOrder.findMany({
      where: whereIn,
      select: { warehouseId: true },
      distinct: ['warehouseId']
    }),
    prisma.goodsReceiptNote.findMany({
      where: whereIn,
      select: { warehouseId: true },
      distinct: ['warehouseId']
    }),
    prisma.salesInvoice.findMany({
      where: whereIn,
      select: { warehouseId: true },
      distinct: ['warehouseId']
    }),
    prisma.deliveryOrder.findMany({
      where: whereIn,
      select: { warehouseId: true },
      distinct: ['warehouseId']
    })
  ]);

  const blocked = new Set<string>();
  for (const row of stockLots) blocked.add(row.warehouseId);
  for (const row of stockMovements) blocked.add(row.warehouseId);
  for (const row of transfersFrom) blocked.add(row.fromWarehouseId);
  for (const row of transfersTo) blocked.add(row.toWarehouseId);
  for (const row of purchaseOrders) blocked.add(row.warehouseId);
  for (const row of goodsReceipts) blocked.add(row.warehouseId);
  for (const row of salesInvoices) blocked.add(row.warehouseId);
  for (const row of deliveryOrders) blocked.add(row.warehouseId);
  return blocked;
}

export async function listWarehouses(user: AuthUser, branchId?: string) {
  const rows = await prisma.warehouse.findMany({
    where: {
      businessId: user.businessId,
      ...(branchId ? { branchId } : {})
    },
    include: { branch: true },
    orderBy: { name: 'asc' }
  });
  const blocked = await warehouseIdsWithActivity(
    user.businessId,
    rows.map((r) => r.id)
  );
  return serialize(
    rows.map((r) => ({
      ...r,
      canChangeBranch: !blocked.has(r.id),
      hasActivity: blocked.has(r.id)
    }))
  );
}

export async function createWarehouse(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = requireString(body.code, 'code').toUpperCase();
  const branchId = requireString(body.branch_id || body.branchId, 'branch_id');

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(400, 'Invalid branch_id');

  const planSub = await prisma.businessSubscription.findFirst({
    where: { businessId: user.businessId, status: { in: ['trial', 'active'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  if (planSub) {
    const count = await prisma.warehouse.count({ where: { businessId: user.businessId } });
    if (count >= planSub.plan.maxWarehouses) {
      throw httpError(
        403,
        `Warehouse limit reached (${planSub.plan.maxWarehouses}) for current plan`
      );
    }
  }

  try {
    const created = await prisma.warehouse.create({
      data: {
        id: shortId('wh'),
        businessId: user.businessId,
        branchId,
        name,
        code,
        category: body.category || 'main',
        managerUserId: body.manager_user_id || body.managerUserId || null,
        capacity: body.capacity ?? null,
        addressLine1: body.address_line1 || body.addressLine1 || null,
        createdById: user.id
      },
      include: { branch: true }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'warehouses',
      entityType: 'Warehouse',
      entityId: created.id,
      summary: `Created warehouse ${code}`
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Warehouse code already exists');
    throw err;
  }
}

export async function updateWarehouse(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.warehouse.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warehouse not found');

  const nextActive =
    body.is_active !== undefined || body.isActive !== undefined
      ? Boolean(body.is_active ?? body.isActive)
      : undefined;

  if (nextActive === false && existing.isActive) {
    const activeCount = await prisma.warehouse.count({
      where: { businessId: user.businessId, branchId: existing.branchId, isActive: true }
    });
    if (activeCount <= 1) {
      throw httpError(409, 'Cannot disable the only active warehouse for this branch');
    }
  }

  let nextBranchId: string | undefined;
  if (body.branch_id !== undefined || body.branchId !== undefined) {
    nextBranchId = requireString(body.branch_id || body.branchId, 'branch_id');
    if (nextBranchId !== existing.branchId) {
      const deps = await countWarehouseDependents(user.businessId, id);
      if (deps.total > 0) {
        throw httpError(
          409,
          'Branch cannot be changed once the warehouse has stock or transaction history'
        );
      }
      const branch = await prisma.branch.findFirst({
        where: { id: nextBranchId, businessId: user.businessId }
      });
      if (!branch) throw httpError(400, 'Invalid branch_id');
    }
  }

  const updated = await prisma.warehouse.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: String(body.name).trim() } : {}),
      ...(body.category != null ? { category: String(body.category) } : {}),
      ...(nextBranchId && nextBranchId !== existing.branchId ? { branchId: nextBranchId } : {}),
      ...(body.manager_user_id !== undefined || body.managerUserId !== undefined
        ? { managerUserId: body.manager_user_id || body.managerUserId || null }
        : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      ...(body.address_line1 !== undefined || body.addressLine1 !== undefined
        ? { addressLine1: body.address_line1 || body.addressLine1 || null }
        : {}),
      ...(nextActive !== undefined ? { isActive: nextActive } : {}),
      updatedById: user.id
    },
    include: { branch: true }
  });
  await writeAudit({
    user,
    action: 'update',
    module: 'warehouses',
    entityType: 'Warehouse',
    entityId: id,
    summary: `Updated warehouse ${updated.code}`
  });
  return serialize(updated);
}

async function countWarehouseDependents(businessId: string, warehouseId: string) {
  const [
    stockLots,
    stockMovements,
    transfersFrom,
    transfersTo,
    purchaseOrders,
    goodsReceipts,
    salesInvoices,
    deliveryOrders
  ] = await Promise.all([
    prisma.stockLot.count({ where: { businessId, warehouseId } }),
    prisma.stockMovement.count({ where: { businessId, warehouseId } }),
    prisma.stockTransfer.count({ where: { businessId, fromWarehouseId: warehouseId } }),
    prisma.stockTransfer.count({ where: { businessId, toWarehouseId: warehouseId } }),
    prisma.purchaseOrder.count({ where: { businessId, warehouseId } }),
    prisma.goodsReceiptNote.count({ where: { businessId, warehouseId } }),
    prisma.salesInvoice.count({ where: { businessId, warehouseId } }),
    prisma.deliveryOrder.count({ where: { businessId, warehouseId } })
  ]);

  return {
    stockLots,
    stockMovements,
    transfersFrom,
    transfersTo,
    purchaseOrders,
    goodsReceipts,
    salesInvoices,
    deliveryOrders,
    total:
      stockLots +
      stockMovements +
      transfersFrom +
      transfersTo +
      purchaseOrders +
      goodsReceipts +
      salesInvoices +
      deliveryOrders
  };
}

export async function deleteWarehouse(user: AuthUser, id: string) {
  const existing = await prisma.warehouse.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warehouse not found');

  const activeCount = await prisma.warehouse.count({
    where: { businessId: user.businessId, branchId: existing.branchId, isActive: true }
  });
  if (existing.isActive && activeCount <= 1) {
    throw httpError(409, 'Cannot delete the only active warehouse for this branch');
  }

  const deps = await countWarehouseDependents(user.businessId, id);
  if (deps.total > 0) {
    throw httpError(
      409,
      'Warehouse has stock or transaction history; disable it instead of deleting',
      { dependents: deps }
    );
  }

  await prisma.warehouse.delete({ where: { id } });

  await writeAudit({
    user,
    action: 'delete',
    module: 'warehouses',
    entityType: 'Warehouse',
    entityId: id,
    summary: `Deleted warehouse ${existing.code}`
  });
  return { deleted: true, id };
}
