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
import { allocateFefo, createStockMovement, lotAvailable } from './inventory.service.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import { assertUserCanAccessWarehouse, canManageAllWarehouses } from './warehouse.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function qtyNum(v: unknown) {
  return Number(v || 0);
}

/** Ensure Inventory / GIT default accounts exist for transfers (idempotent). */
async function ensureTransferAccounts(businessId: string) {
  let map = await getDefaultAccountMap(businessId);
  if (map.inventory && map.goods_in_transit) return map;

  const ensureAccount = async (code: string, name: string, key: string) => {
    let acc = await prisma.account.findFirst({ where: { businessId, code } });
    if (!acc) {
      acc = await prisma.account.create({
        data: {
          id: shortId('acc'),
          businessId,
          code,
          name,
          accountType: 'asset',
          isSystem: true,
          isActive: true
        }
      });
    }
    await prisma.defaultAccountSetting.upsert({
      where: { businessId_settingKey: { businessId, settingKey: key } },
      create: {
        id: shortId('das'),
        businessId,
        settingKey: key,
        accountId: acc.id
      },
      update: { accountId: acc.id }
    });
  };

  if (!map.inventory) await ensureAccount('1140', 'Inventory Asset', 'inventory');
  if (!map.goods_in_transit) await ensureAccount('1145', 'Goods in Transit', 'goods_in_transit');
  map = await getDefaultAccountMap(businessId);
  return map;
}

async function nextTransferNumber(businessId: string) {
  return nextDocNumber(prisma.stockTransfer, businessId, 'transferNumber', 'TR', 6);
}

function parseInclusiveDateRange(from?: string | Date, to?: string | Date) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    if (typeof to === 'string' && to.length <= 10) {
      toDate.setHours(23, 59, 59, 999);
    }
  }
  return {
    fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
    toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null
  };
}

/** Attach initiated_by / received_by display names (and movement fallback for older receives). */
async function withPeople<T extends {
  id: string;
  status: string;
  requestedById: string | null;
  receivedById: string | null;
}>(rows: T[]) {
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.requestedById) userIds.add(r.requestedById);
    if (r.receivedById) userIds.add(r.receivedById);
  }

  const needFallback = rows
    .filter((r) => r.status === 'received' && !r.receivedById)
    .map((r) => r.id);
  const receiverByTransfer = new Map<string, { id: string | null; name: string | null }>();
  if (needFallback.length) {
    const movs = await prisma.stockMovement.findMany({
      where: {
        referenceType: 'stock_transfer',
        referenceId: { in: needFallback },
        movementType: 'transfer_in'
      },
      select: { referenceId: true, performedById: true, performedByName: true },
      orderBy: { createdAt: 'asc' }
    });
    for (const m of movs) {
      if (!m.referenceId || receiverByTransfer.has(m.referenceId)) continue;
      receiverByTransfer.set(m.referenceId, {
        id: m.performedById,
        name: m.performedByName
      });
      if (m.performedById) userIds.add(m.performedById);
    }
  }

  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, fullName: true }
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  return rows.map((r) => {
    const fallback = receiverByTransfer.get(r.id);
    const receivedById = r.receivedById || fallback?.id || null;
    return {
      ...r,
      initiatedBy: r.requestedById ? nameById.get(r.requestedById) || null : null,
      receivedBy: receivedById
        ? nameById.get(receivedById) || fallback?.name || null
        : fallback?.name || null
    };
  });
}

async function listOne(businessId: string, id: string) {
  const row = await prisma.stockTransfer.findFirst({
    where: { id, businessId },
    include: {
      fromWarehouse: { include: { warehouseCategory: true, branch: true } },
      toWarehouse: { include: { warehouseCategory: true, branch: true } },
      items: { include: { product: true, variant: true, fromLot: true } }
    }
  });
  if (!row) throw httpError(404, 'Transfer not found');
  const [enriched] = await withPeople([row]);
  return serialize(enriched);
}

/** Warehouses the user may send from, plus all active destinations. */
export async function listTransferWarehouses(user: AuthUser) {
  const manage = canManageAllWarehouses(user) || user.role === 'business_owner';
  let fromIds: string[] | null = null;
  if (!manage) {
    const assignments = await prisma.userWarehouse.findMany({
      where: { userId: user.id, businessId: user.businessId, status: 'active' },
      select: { warehouseId: true }
    });
    fromIds = assignments.map((a) => a.warehouseId);
  }

  const [from, to] = await Promise.all([
    prisma.warehouse.findMany({
      where: {
        businessId: user.businessId,
        isActive: true,
        ...(fromIds ? { id: { in: fromIds } } : {})
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        warehouseCategory: true
      },
      orderBy: { name: 'asc' }
    }),
    prisma.warehouse.findMany({
      where: { businessId: user.businessId, isActive: true },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        warehouseCategory: true
      },
      orderBy: { name: 'asc' }
    })
  ]);

  return serialize({ from, to });
}

export async function listTransfers(
  user: AuthUser,
  filters: {
    status?: string;
    from?: string | Date;
    to?: string | Date;
  } & BranchListOpts = {}
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filters.branchId,
    allowConsolidated: filters.allowConsolidated
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
  const { fromDate, toDate } = parseInclusiveDateRange(filters.from, filters.to);
  const rows = await prisma.stockTransfer.findMany({
    where: {
      businessId: user.businessId,
      ...branchFilter,
      ...(filters.status ? { status: filters.status } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {})
            }
          }
        : {})
    },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      items: { include: { product: true, variant: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(await withPeople(rows));
}

/**
 * Send stock: hold as in-transit on source lots (still on hand / owned by source),
 * post Dr Goods in Transit / Cr Inventory, status → in_transit.
 */
export async function createTransfer(user: AuthUser, body: Record<string, any>) {
  const fromWarehouseId = requireString(
    body.from_warehouse_id || body.fromWarehouseId,
    'from_warehouse_id'
  );
  const toWarehouseId = requireString(body.to_warehouse_id || body.toWarehouseId, 'to_warehouse_id');
  if (fromWarehouseId === toWarehouseId) {
    throw httpError(400, 'Source and destination warehouses must differ');
  }
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];
  if (!itemsInput.length) throw httpError(400, 'Transfer requires at least one item');

  const fromWh = await assertUserCanAccessWarehouse(user, fromWarehouseId);
  const toWh = await prisma.warehouse.findFirst({
    where: { id: toWarehouseId, businessId: user.businessId, isActive: true },
    include: { warehouseCategory: true, branch: true }
  });
  if (!toWh) throw httpError(400, 'Invalid destination warehouse');

  await branchAccess.assertBranchActive(user.businessId, fromWh.branchId);
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

  // GL (Inventory → GIT) only for inter-branch; same-branch is stock-only.
  const crossBranch = fromWh.branchId !== toWh.branchId;
  const accountMap = crossBranch ? await ensureTransferAccounts(user.businessId) : null;
  if (crossBranch && (!accountMap?.inventory || !accountMap?.goods_in_transit)) {
    throw httpError(
      400,
      'Default accounts "inventory" and "goods_in_transit" must be configured for inter-branch transfers'
    );
  }

  type LineSpec = {
    productId: string;
    variantId: string;
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
    fromLotId: string | null;
    trackExpiry: boolean;
  };

  const lines: LineSpec[] = [];
  for (const [i, it] of itemsInput.entries()) {
    const productId = requireString(it.product_id || it.productId, `items[${i}].product_id`);
    const quantity = Number(it.quantity);
    if (!quantity || quantity <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);

    const product = await prisma.product.findFirst({
      where: { id: productId, businessId: user.businessId },
      include: { variants: { where: { isActive: true }, take: 1, orderBy: { createdAt: 'asc' } } }
    });
    if (!product) throw httpError(400, `items[${i}]: invalid product`);
    const variantId =
      it.variant_id || it.variantId || product.variants[0]?.id || null;
    if (!variantId) throw httpError(400, `items[${i}]: product has no variant`);

    lines.push({
      productId,
      variantId,
      quantity,
      batchNumber: it.batch_number || it.batchNumber || null,
      expiryDate: it.expiry_date || it.expiryDate || null,
      fromLotId: it.lot_id || it.lotId || null,
      trackExpiry: product.trackExpiry
    });
  }

  const transferId = shortId('tr');
  const transferNumber = await nextTransferNumber(user.businessId);

  const result = await prisma.$transaction(
    async (tx) => {
      const createdItems: {
        id: string;
        productId: string;
        variantId: string;
        quantity: number;
        fromLotId: string;
        batchNumber: string;
        expiryDate: string | null;
        unitCost: number;
        outMovementId: string;
      }[] = [];

      let totalCost = 0;

      for (const line of lines) {
        let allocations: { lotId: string; batchNumber: string; expiryDate: string | null; qty: number }[];
        if (line.fromLotId) {
          const lot = await tx.stockLot.findFirst({
            where: {
              id: line.fromLotId,
              businessId: user.businessId,
              warehouseId: fromWarehouseId,
              variantId: line.variantId
            }
          });
          if (!lot) throw httpError(400, 'Invalid lot for transfer line');
          const free = lotAvailable(lot);
          if (line.quantity > free + 1e-9) {
            throw httpError(
              400,
              `Insufficient available on lot ${lot.batchNumber} (need ${line.quantity}, available ${free})`
            );
          }
          allocations = [
            {
              lotId: lot.id,
              batchNumber: lot.batchNumber,
              expiryDate: lot.expiryDate,
              qty: line.quantity
            }
          ];
        } else {
          allocations = await allocateFefo(
            tx,
            line.variantId,
            fromWarehouseId,
            line.quantity,
            line.trackExpiry
          );
        }

        for (const alloc of allocations) {
          const lot = await tx.stockLot.findFirst({ where: { id: alloc.lotId } });
          if (!lot) throw httpError(400, 'Lot missing during transfer hold');
          const unitCost = qtyNum(lot.unitCost);
          const lineCost = roundMoney(unitCost * alloc.qty);
          totalCost = roundMoney(totalCost + lineCost);

          const itemId = shortId('tri');
          const newTransit = qtyNum(lot.quantityInTransit) + alloc.qty;
          await tx.stockLot.update({
            where: { id: lot.id },
            data: { quantityInTransit: toDec(newTransit) }
          });

          const movement = await tx.stockMovement.create({
            data: {
              id: shortId('sm'),
              businessId: user.businessId,
              branchId: fromWh.branchId,
              productId: line.productId,
              variantId: line.variantId,
              warehouseId: fromWarehouseId,
              lotId: lot.id,
              movementType: 'transfer_hold',
              quantityIn: toDec(0),
              quantityOut: toDec(alloc.qty),
              unitCost: unitCost ? toDec(unitCost) : null,
              totalCost: lineCost ? toDec(lineCost) : null,
              referenceType: 'stock_transfer',
              referenceId: transferId,
              batchNumber: alloc.batchNumber,
              expiryDate: alloc.expiryDate,
              reason: `Transfer ${transferNumber} hold (in transit)`,
              performedById: user.id,
              performedByName: user.fullName,
              idempotencyKey: `transfer-hold:${transferId}:${itemId}`,
              status: 'completed'
            }
          });

          createdItems.push({
            id: itemId,
            productId: line.productId,
            variantId: line.variantId,
            quantity: alloc.qty,
            fromLotId: lot.id,
            batchNumber: alloc.batchNumber,
            expiryDate: alloc.expiryDate,
            unitCost,
            outMovementId: movement.id
          });
        }
      }

      if (crossBranch && accountMap && totalCost > 0.0001) {
        await createJournal(
          user,
          {
            memo: `Stock transfer ${transferNumber} — goods in transit from ${fromWh.code}`,
            source_type: 'stock_transfer',
            source_id: transferId,
            idempotency_key: `stock_transfer:send:${transferId}`,
            branch_id: fromWh.branchId,
            post: true,
            lines: [
              {
                account_id: accountMap.goods_in_transit,
                debit: totalCost,
                description: `GIT ${transferNumber} → ${toWh.code}`
              },
              {
                account_id: accountMap.inventory,
                credit: totalCost,
                description: `Inventory held for transfer ${transferNumber}`
              }
            ]
          },
          tx
        );
      }

      const transfer = await tx.stockTransfer.create({
        data: {
          id: transferId,
          businessId: user.businessId,
          transferNumber,
          fromWarehouseId,
          toWarehouseId,
          fromBranchId: fromWh.branchId,
          toBranchId: toWh.branchId,
          status: 'in_transit',
          notes: body.notes || null,
          requestedById: user.id,
          approvedById: user.id,
          dispatchedAt: new Date(),
          items: {
            create: createdItems.map((it) => ({
              id: it.id,
              productId: it.productId,
              variantId: it.variantId,
              fromLotId: it.fromLotId,
              quantity: toDec(it.quantity),
              batchNumber: it.batchNumber,
              expiryDate: it.expiryDate,
              outMovementId: it.outMovementId
            }))
          }
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { product: true, variant: true } }
        }
      });

      return transfer;
    },
    { timeout: 30000, maxWait: 10000 }
  );

  await writeAudit({
    user,
    action: 'create',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: transferId,
    summary: `Sent transfer ${transferNumber} ${fromWh.code} → ${toWh.code}`
  });

  return serialize(result);
}

/** @deprecated Prefer createTransfer (send). Kept for older clients. */
export async function approveTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (transfer.status === 'in_transit' || transfer.status === 'received') {
    return listOne(user.businessId, id);
  }
  if (transfer.status !== 'pending_approval' && transfer.status !== 'approved') {
    throw httpError(400, 'Transfer cannot be approved in current status');
  }
  // Legacy pending rows: treat approve+dispatch via dispatchTransfer.
  return dispatchTransfer(user, id);
}

/**
 * Legacy dispatch for transfers created as pending_approval / approved before send-on-create.
 * New transfers are already in_transit after createTransfer.
 */
export async function dispatchTransfer(user: AuthUser, id: string) {
  const existing = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      items: true,
      fromWarehouse: { include: { warehouseCategory: true } },
      toWarehouse: { include: { warehouseCategory: true } }
    }
  });
  if (!existing) throw httpError(404, 'Transfer not found');
  if (existing.status === 'in_transit') return listOne(user.businessId, id);
  if (!['approved', 'pending_approval', 'draft'].includes(existing.status)) {
    throw httpError(400, 'Transfer cannot be dispatched in current status');
  }

  await assertUserCanAccessWarehouse(user, existing.fromWarehouseId);

  const crossBranch =
    !!existing.fromBranchId &&
    !!existing.toBranchId &&
    existing.fromBranchId !== existing.toBranchId;
  const accountMap = crossBranch ? await ensureTransferAccounts(user.businessId) : null;
  if (crossBranch && (!accountMap?.inventory || !accountMap?.goods_in_transit)) {
    throw httpError(
      400,
      'Default accounts "inventory" and "goods_in_transit" must be configured for inter-branch transfers'
    );
  }

  await prisma.$transaction(async (tx) => {
    let totalCost = 0;
    for (const item of existing.items) {
      const qty = qtyNum(item.quantity);
      let lot =
        item.fromLotId
          ? await tx.stockLot.findFirst({ where: { id: item.fromLotId } })
          : null;
      if (!lot) {
        const product = await tx.product.findFirst({ where: { id: item.productId } });
        const allocs = await allocateFefo(
          tx,
          item.variantId,
          existing.fromWarehouseId,
          qty,
          !!product?.trackExpiry
        );
        if (!allocs.length) throw httpError(400, 'Insufficient stock to dispatch');
        // Legacy single-line: require one allocation covering qty
        const covered = allocs.reduce((s, a) => s + a.qty, 0);
        if (covered + 1e-9 < qty) throw httpError(400, 'Insufficient stock to dispatch');
        lot = await tx.stockLot.findFirst({ where: { id: allocs[0].lotId } });
        if (!lot) throw httpError(400, 'Lot missing');
        // If FEFO split, only support exact single-lot for legacy dispatch
        if (allocs.length > 1 || allocs[0].qty + 1e-9 < qty) {
          throw httpError(
            400,
            'Legacy transfer line spans multiple lots — cancel and create a new transfer'
          );
        }
      }
      const free = lotAvailable(lot);
      if (qty > free + 1e-9) {
        throw httpError(400, `Insufficient available on lot ${lot.batchNumber}`);
      }
      const unitCost = qtyNum(lot.unitCost);
      totalCost = roundMoney(totalCost + unitCost * qty);
      await tx.stockLot.update({
        where: { id: lot.id },
        data: { quantityInTransit: toDec(qtyNum(lot.quantityInTransit) + qty) }
      });
      const movement = await tx.stockMovement.create({
        data: {
          id: shortId('sm'),
          businessId: user.businessId,
          branchId: existing.fromBranchId,
          productId: item.productId,
          variantId: item.variantId,
          warehouseId: existing.fromWarehouseId,
          lotId: lot.id,
          movementType: 'transfer_hold',
          quantityIn: toDec(0),
          quantityOut: toDec(qty),
          unitCost: unitCost ? toDec(unitCost) : null,
          totalCost: unitCost ? toDec(roundMoney(unitCost * qty)) : null,
          referenceType: 'stock_transfer',
          referenceId: existing.id,
          batchNumber: lot.batchNumber,
          expiryDate: lot.expiryDate,
          reason: `Transfer ${existing.transferNumber} hold (in transit)`,
          performedById: user.id,
          performedByName: user.fullName,
          idempotencyKey: `transfer-hold:${existing.id}:${item.id}`,
          status: 'completed'
        }
      });
      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: {
          fromLotId: lot.id,
          batchNumber: lot.batchNumber,
          expiryDate: lot.expiryDate,
          outMovementId: movement.id
        }
      });
    }

    if (crossBranch && accountMap && totalCost > 0.0001) {
      await createJournal(
        user,
        {
          memo: `Stock transfer ${existing.transferNumber} — goods in transit`,
          source_type: 'stock_transfer',
          source_id: existing.id,
          idempotency_key: `stock_transfer:send:${existing.id}`,
          branch_id: existing.fromBranchId!,
          post: true,
          lines: [
            {
              account_id: accountMap.goods_in_transit,
              debit: totalCost,
              description: `GIT ${existing.transferNumber}`
            },
            {
              account_id: accountMap.inventory,
              credit: totalCost,
              description: `Inventory held for transfer ${existing.transferNumber}`
            }
          ]
        },
        tx,
        { trustedBranch: true }
      );
    }

    await tx.stockTransfer.update({
      where: { id },
      data: {
        status: 'in_transit',
        dispatchedAt: new Date(),
        approvedById: existing.approvedById || user.id
      }
    });
  });

  await writeAudit({
    user,
    action: 'dispatch',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: id,
    summary: `Dispatched transfer ${existing.transferNumber}`
  });

  return listOne(user.businessId, id);
}

/**
 * Receive at destination: leave source on-hand + clear in-transit, land stock at dest.
 * GL: clear GIT → inventory (same branch) or via inter-branch clearing.
 */
export async function receiveTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      items: true,
      fromWarehouse: true,
      toWarehouse: true
    }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (transfer.status !== 'in_transit') {
    throw httpError(400, 'Only in-transit transfers can be received');
  }

  await assertUserCanAccessWarehouse(user, transfer.toWarehouseId);

  const crossBranch =
    !!transfer.fromBranchId &&
    !!transfer.toBranchId &&
    transfer.fromBranchId !== transfer.toBranchId;
  const accountMap = crossBranch ? await ensureTransferAccounts(user.businessId) : null;
  if (crossBranch && (!accountMap?.inventory || !accountMap?.goods_in_transit)) {
    throw httpError(
      400,
      'Default accounts "inventory" and "goods_in_transit" must be configured for inter-branch transfers'
    );
  }
  if (crossBranch && !accountMap?.inter_branch_clearing) {
    throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
  }

  await prisma.$transaction(
    async (tx) => {
      let totalCost = 0;

      for (const item of transfer.items) {
        if (!item.fromLotId) {
          throw httpError(400, `Transfer line ${item.id} has no source lot`);
        }
        const lot = await tx.stockLot.findFirst({ where: { id: item.fromLotId } });
        if (!lot) throw httpError(400, 'Source lot missing');
        const qty = qtyNum(item.quantity);
        const inTransit = qtyNum(lot.quantityInTransit);
        if (qty > inTransit + 1e-9) {
          throw httpError(
            400,
            `In-transit qty mismatch on lot ${lot.batchNumber} (need ${qty}, in transit ${inTransit})`
          );
        }
        if (qty > qtyNum(lot.quantityOnHand) + 1e-9) {
          throw httpError(400, `Source on-hand insufficient to complete transfer for ${lot.batchNumber}`);
        }

        const unitCost = qtyNum(item.fromLotId ? lot.unitCost : 0) || qtyNum(lot.unitCost);
        const lineCost = roundMoney(unitCost * qty);
        totalCost = roundMoney(totalCost + lineCost);

        await tx.stockLot.update({
          where: { id: lot.id },
          data: {
            quantityOnHand: toDec(qtyNum(lot.quantityOnHand) - qty),
            quantityInTransit: toDec(inTransit - qty)
          }
        });

        const outMovement = await tx.stockMovement.create({
          data: {
            id: shortId('sm'),
            businessId: user.businessId,
            branchId: transfer.fromBranchId,
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: transfer.fromWarehouseId,
            lotId: lot.id,
            movementType: 'transfer_out',
            quantityIn: toDec(0),
            quantityOut: toDec(qty),
            unitCost: unitCost ? toDec(unitCost) : null,
            totalCost: lineCost ? toDec(lineCost) : null,
            referenceType: 'stock_transfer',
            referenceId: transfer.id,
            batchNumber: item.batchNumber || lot.batchNumber,
            expiryDate: item.expiryDate || lot.expiryDate,
            reason: `Transfer ${transfer.transferNumber} leave source`,
            performedById: user.id,
            performedByName: user.fullName,
            idempotencyKey: `transfer-out:${transfer.id}:${item.id}`,
            status: 'completed'
          }
        });

        const inMovement = await createStockMovement(
          user,
          {
            product_id: item.productId,
            variant_id: item.variantId,
            warehouse_id: transfer.toWarehouseId,
            movement_type: 'transfer_in',
            quantity_in: qty,
            unit_cost: unitCost || null,
            batch_number: item.batchNumber || lot.batchNumber,
            expiry_date: item.expiryDate || lot.expiryDate,
            reference_type: 'stock_transfer',
            reference_id: transfer.id,
            idempotency_key: `transfer-in:${transfer.id}:${item.id}`,
            reason: `Transfer ${transfer.transferNumber} receive`
          },
          tx
        );

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: {
            outMovementId: item.outMovementId || outMovement.id,
            inMovementId: inMovement.id
          }
        });
      }

      // Same-branch: stock only. Inter-branch: clear GIT at source and book inventory at dest.
      if (crossBranch && accountMap && totalCost > 0.0001) {
        await createJournal(
          user,
          {
            memo: `Stock transfer ${transfer.transferNumber} — clear GIT (source)`,
            source_type: 'stock_transfer',
            source_id: transfer.id,
            idempotency_key: `stock_transfer:receive:src:${transfer.id}`,
            branch_id: transfer.fromBranchId!,
            post: true,
            lines: [
              {
                account_id: accountMap.inter_branch_clearing!,
                debit: totalCost,
                description: `Clear GIT ${transfer.transferNumber}`
              },
              {
                account_id: accountMap.goods_in_transit,
                credit: totalCost,
                description: `GIT received at ${transfer.toWarehouse.code}`
              }
            ]
          },
          tx,
          { trustedBranch: true }
        );
        await createJournal(
          user,
          {
            memo: `Stock transfer ${transfer.transferNumber} — inventory in (destination)`,
            source_type: 'stock_transfer',
            source_id: transfer.id,
            idempotency_key: `stock_transfer:receive:dst:${transfer.id}`,
            branch_id: transfer.toBranchId!,
            post: true,
            lines: [
              {
                account_id: accountMap.inventory,
                debit: totalCost,
                description: `Inventory from ${transfer.fromWarehouse.code}`
              },
              {
                account_id: accountMap.inter_branch_clearing!,
                credit: totalCost,
                description: `Due from source ${transfer.transferNumber}`
              }
            ]
          },
          tx,
          { trustedBranch: true }
        );
      }

      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'received',
          receivedAt: new Date(),
          receivedById: user.id
        }
      });
    },
    { timeout: 30000, maxWait: 10000 }
  );

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

/** Cancel in-transit transfer: release holds back to available; reverse GIT journal. */
export async function cancelTransfer(user: AuthUser, id: string) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true, fromWarehouse: true, toWarehouse: true }
  });
  if (!transfer) throw httpError(404, 'Transfer not found');
  if (transfer.status !== 'in_transit') {
    throw httpError(400, 'Only in-transit transfers can be cancelled');
  }

  await assertUserCanAccessWarehouse(user, transfer.fromWarehouseId);

  const crossBranch =
    !!transfer.fromBranchId &&
    !!transfer.toBranchId &&
    transfer.fromBranchId !== transfer.toBranchId;
  const accountMap = crossBranch ? await ensureTransferAccounts(user.businessId) : null;
  if (crossBranch && (!accountMap?.inventory || !accountMap?.goods_in_transit)) {
    throw httpError(
      400,
      'Default accounts "inventory" and "goods_in_transit" must be configured for inter-branch transfers'
    );
  }

  await prisma.$transaction(async (tx) => {
    let totalCost = 0;
    for (const item of transfer.items) {
      if (!item.fromLotId) continue;
      const lot = await tx.stockLot.findFirst({ where: { id: item.fromLotId } });
      if (!lot) continue;
      const qty = qtyNum(item.quantity);
      const inTransit = qtyNum(lot.quantityInTransit);
      const release = Math.min(qty, inTransit);
      const unitCost = qtyNum(lot.unitCost);
      totalCost = roundMoney(totalCost + unitCost * release);

      await tx.stockLot.update({
        where: { id: lot.id },
        data: { quantityInTransit: toDec(Math.max(0, inTransit - release)) }
      });

      await tx.stockMovement.create({
        data: {
          id: shortId('sm'),
          businessId: user.businessId,
          branchId: transfer.fromBranchId,
          productId: item.productId,
          variantId: item.variantId,
          warehouseId: transfer.fromWarehouseId,
          lotId: lot.id,
          movementType: 'transfer_cancel',
          quantityIn: toDec(release),
          quantityOut: toDec(0),
          unitCost: unitCost ? toDec(unitCost) : null,
          totalCost: release && unitCost ? toDec(roundMoney(unitCost * release)) : null,
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          reason: `Transfer ${transfer.transferNumber} cancelled — release hold`,
          performedById: user.id,
          performedByName: user.fullName,
          idempotencyKey: `transfer-cancel:${transfer.id}:${item.id}`,
          status: 'completed'
        }
      });
    }

    if (crossBranch && accountMap && totalCost > 0.0001) {
      await createJournal(
        user,
        {
          memo: `Stock transfer ${transfer.transferNumber} cancelled — release GIT`,
          source_type: 'stock_transfer',
          source_id: transfer.id,
          idempotency_key: `stock_transfer:cancel:${transfer.id}`,
          branch_id: transfer.fromBranchId!,
          post: true,
          lines: [
            {
              account_id: accountMap.inventory,
              debit: totalCost,
              description: `Release GIT ${transfer.transferNumber}`
            },
            {
              account_id: accountMap.goods_in_transit,
              credit: totalCost,
              description: `Cancel transfer ${transfer.transferNumber}`
            }
          ]
        },
        tx,
        { trustedBranch: true }
      );
    }

    await tx.stockTransfer.update({
      where: { id },
      data: { status: 'cancelled' }
    });
  });

  await writeAudit({
    user,
    action: 'cancel',
    module: 'inventory',
    entityType: 'StockTransfer',
    entityId: id,
    summary: `Cancelled transfer ${transfer.transferNumber}`
  });

  return listOne(user.businessId, id);
}
