import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { createStockMovement } from './inventory.service.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

async function nextTransferNumber(businessId: string) {
  return nextDocNumber(prisma.stockTransfer, businessId, 'transferNumber', 'TR', 6);
}

export async function listTransfers(
  user: AuthUser,
  status?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const branchFilter =
    typeof scope.branchId === 'string'
      ? {
          OR: [{ fromBranchId: scope.branchId }, { toBranchId: scope.branchId }]
        }
      : {
          OR: [
            { fromBranchId: { in: scope.branchId.in } },
            { toBranchId: { in: scope.branchId.in } }
          ]
        };
  return serialize(
    await prisma.stockTransfer.findMany({
      where: { businessId: user.businessId, ...branchFilter, ...(status ? { status } : {}) },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: true, variant: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  );
}

export async function createTransfer(user: AuthUser, body: Record<string, any>) {
  const fromWarehouseId = requireString(
    body.from_warehouse_id || body.fromWarehouseId,
    'from_warehouse_id'
  );
  const toWarehouseId = requireString(body.to_warehouse_id || body.toWarehouseId, 'to_warehouse_id');
  if (fromWarehouseId === toWarehouseId) {
    throw httpError(400, 'Source and destination warehouses must differ');
  }
  const items: any[] = body.items || [];
  if (!items.length) throw httpError(400, 'Transfer requires at least one item');

  const [fromWh, toWh] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: fromWarehouseId, businessId: user.businessId },
      include: { warehouseCategory: true }
    }),
    prisma.warehouse.findFirst({
      where: { id: toWarehouseId, businessId: user.businessId },
      include: { warehouseCategory: true }
    })
  ]);
  if (!fromWh || !toWh) throw httpError(400, 'Invalid warehouse');

  await branchAccess.assertBranchMembership(user, fromWh.branchId);
  await branchAccess.assertBranchActive(user.businessId, fromWh.branchId);
  await branchAccess.assertBranchMembership(user, toWh.branchId);
  await branchAccess.assertBranchActive(user.businessId, toWh.branchId);

  if (fromWh.branchId !== toWh.branchId) {
    const fromOk = fromWh.warehouseCategory?.allowInterBranchTransfer !== false;
    const toOk = toWh.warehouseCategory?.allowInterBranchTransfer !== false;
    if (!fromOk || !toOk) {
      const blocked = !fromOk ? fromWh.code : toWh.code;
      throw httpError(
        400,
        `Warehouse ${blocked} category does not allow inter-branch transfers`
      );
    }
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      id: shortId('tr'),
      businessId: user.businessId,
      transferNumber: await nextTransferNumber(user.businessId),
      fromWarehouseId,
      toWarehouseId,
      fromBranchId: fromWh.branchId,
      toBranchId: toWh.branchId,
      status: 'pending_approval',
      notes: body.notes || null,
      requestedById: user.id,
      items: {
        create: items.map((it) => ({
          id: shortId('tri'),
          productId: it.product_id || it.productId,
          variantId: it.variant_id || it.variantId,
          quantity: it.quantity,
          batchNumber: it.batch_number || it.batchNumber || null,
          expiryDate: it.expiry_date || it.expiryDate || null,
          fromLotId: it.lot_id || it.lotId || null
        }))
      }
    },
    include: { items: true, fromWarehouse: true, toWarehouse: true }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: transfer.id,
    summary: `Created transfer ${transfer.transferNumber}`
  });
  return serialize(transfer);
}

export async function approveTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (transfer.status !== 'pending_approval') {
    throw httpError(400, 'Only pending transfers can be approved');
  }
  const updated = await prisma.stockTransfer.update({
    where: { id },
    data: { status: 'approved', approvedById: user.id },
    include: { items: true, fromWarehouse: true, toWarehouse: true }
  });
  return serialize(updated);
}

/** Dispatch: stock leaves source and is marked in transit (not available either side). */
export async function dispatchTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (!['approved', 'pending_approval'].includes(transfer.status)) {
    throw httpError(400, 'Transfer cannot be dispatched in current status');
  }

  await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      const movement = await createStockMovement(
        user,
        {
          product_id: item.productId,
          variant_id: item.variantId,
          warehouse_id: transfer.fromWarehouseId,
          lot_id: item.fromLotId,
          movement_type: 'transfer_out',
          quantity_out: Number(item.quantity),
          batch_number: item.batchNumber,
          expiry_date: item.expiryDate,
          reference_type: 'stock_transfer',
          reference_id: transfer.id,
          idempotency_key: `transfer-out:${transfer.id}:${item.id}`,
          reason: `Transfer ${transfer.transferNumber} dispatch`
        },
        tx
      );

      if (movement.lotId) {
        await tx.stockLot.update({
          where: { id: movement.lotId },
          data: {
            // quantity already reduced by movement; track in-transit on a shadow basis via item refs
          }
        });
      }

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: {
          outMovementId: movement.id,
          fromLotId: movement.lotId,
          batchNumber: movement.batchNumber,
          expiryDate: movement.expiryDate
        }
      });
    }

    await tx.stockTransfer.update({
      where: { id },
      data: { status: 'in_transit', dispatchedAt: new Date(), approvedById: transfer.approvedById || user.id }
    });
  });

  await writeAudit({
    user,
    action: 'dispatch',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: id,
    summary: `Dispatched transfer ${transfer.transferNumber}`
  });

  return listOne(user.businessId, id);
}

/** Receive: stock lands at destination; no longer in transit. */
export async function receiveTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (transfer.status !== 'in_transit') {
    throw httpError(400, 'Only in-transit transfers can be received');
  }

  await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      const movement = await createStockMovement(
        user,
        {
          product_id: item.productId,
          variant_id: item.variantId,
          warehouse_id: transfer.toWarehouseId,
          movement_type: 'transfer_in',
          quantity_in: Number(item.quantity),
          batch_number: item.batchNumber,
          expiry_date: item.expiryDate,
          reference_type: 'stock_transfer',
          reference_id: transfer.id,
          idempotency_key: `transfer-in:${transfer.id}:${item.id}`,
          reason: `Transfer ${transfer.transferNumber} receive`
        },
        tx
      );
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { inMovementId: movement.id }
      });
    }
    await tx.stockTransfer.update({
      where: { id },
      data: { status: 'received', receivedAt: new Date() }
    });
  });

  await writeAudit({
    user,
    action: 'receive',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: id,
    summary: `Received transfer ${transfer.transferNumber}`
  });

  return listOne(user.businessId, id);
}

async function listOne(businessId: string, id: string) {
  const row = await prisma.stockTransfer.findFirst({
    where: { id, businessId },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      items: { include: { product: true, variant: true } }
    }
  });
  if (!row) throw httpError(404, 'Transfer not found');
  return serialize(row);
}
