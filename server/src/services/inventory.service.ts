import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  assertWholeSerialQty,
  issueSerials,
  normalizeSerialList,
  receiveSerials
} from './stock-serial.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

type DbClient = Prisma.TransactionClient | typeof prisma;

export function normalizeBatch(batch?: string | null): string {
  return (batch || '').trim() || 'BULK';
}

export function normalizeExpiry(expiry?: string | null): string | null {
  const e = (expiry || '').trim();
  if (!e) return null;
  return e.slice(0, 10);
}

function expiryKeyPart(expiry?: string | null): string {
  return normalizeExpiry(expiry) || 'NONE';
}

export function lotKey(
  variantId: string,
  warehouseId: string,
  batchNumber: string | null | undefined,
  expiryDate: string | null | undefined
): string {
  return `${variantId}|${warehouseId}|${normalizeBatch(batchNumber)}|${expiryKeyPart(expiryDate)}`;
}

function qtyNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v == null) return 0;
  return Number(v);
}

/** Sellable / issuable qty: on hand less sales reservations and goods held in transit. */
export function lotAvailable(lot: {
  quantityOnHand?: Prisma.Decimal | number | string | null;
  quantityReserved?: Prisma.Decimal | number | string | null;
  quantityInTransit?: Prisma.Decimal | number | string | null;
}) {
  return Math.max(
    0,
    qtyNum(lot.quantityOnHand) - qtyNum(lot.quantityReserved) - qtyNum(lot.quantityInTransit)
  );
}

async function findOrCreateLot(
  client: DbClient,
  input: {
    businessId: string;
    productId: string;
    variantId: string;
    warehouseId: string;
    batchNumber?: string | null;
    expiryDate?: string | null;
    manufacturingDate?: string | null;
    unitCost?: number | null;
  }
) {
  const batchNumber = normalizeBatch(input.batchNumber);
  const expiryDate = normalizeExpiry(input.expiryDate);
  const key = lotKey(input.variantId, input.warehouseId, batchNumber, expiryDate);

  const existing = await client.stockLot.findFirst({
    where: { businessId: input.businessId, lotKey: key }
  });
  if (existing) {
    if (input.unitCost != null && existing.unitCost == null) {
      return client.stockLot.update({
        where: { id: existing.id },
        data: { unitCost: toDec(input.unitCost) }
      });
    }
    return existing;
  }

  return client.stockLot.create({
    data: {
      id: shortId('lot'),
      businessId: input.businessId,
      productId: input.productId,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      lotKey: key,
      batchNumber,
      expiryDate,
      manufacturingDate: input.manufacturingDate
        ? normalizeExpiry(input.manufacturingDate)
        : null,
      quantityOnHand: 0,
      unitCost: input.unitCost != null ? toDec(input.unitCost) : null
    }
  });
}

/** FEFO when expiry tracked; otherwise FIFO by createdAt. Available = on hand − reserved − in transit. */
export async function allocateFefo(
  client: DbClient,
  variantId: string,
  warehouseId: string,
  quantity: number,
  trackExpiry: boolean
): Promise<{ lotId: string; batchNumber: string; expiryDate: string | null; qty: number }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const orderBy = trackExpiry
    ? ([{ expiryDate: 'asc' as const }, { createdAt: 'asc' as const }] as const)
    : ([{ createdAt: 'asc' as const }] as const);

  let lots = await client.stockLot.findMany({
    where: {
      variantId,
      warehouseId,
      status: 'available',
      quantityOnHand: { gt: 0 }
    },
    orderBy: [...orderBy]
  });

  if (trackExpiry) {
    const nonExpired = lots.filter((l) => !l.expiryDate || l.expiryDate >= today);
    const nonExpiredQty = nonExpired.reduce((s, l) => s + lotAvailable(l), 0);
    if (nonExpiredQty >= quantity) lots = nonExpired;
  }

  const available = lots.reduce((s, l) => s + lotAvailable(l), 0);
  if (available + 1e-9 < quantity) {
    throw httpError(400, `Insufficient stock (need ${quantity}, available ${available})`);
  }

  let remaining = quantity;
  const allocations: {
    lotId: string;
    batchNumber: string;
    expiryDate: string | null;
    qty: number;
  }[] = [];
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const free = lotAvailable(lot);
    const take = Math.min(free, remaining);
    if (take <= 0) continue;
    allocations.push({
      lotId: lot.id,
      batchNumber: lot.batchNumber,
      expiryDate: lot.expiryDate,
      qty: take
    });
    remaining -= take;
  }
  return allocations;
}

export async function convertToBaseQty(
  client: DbClient,
  productId: string,
  fromUomId: string,
  quantity: number,
  baseUomId: string
): Promise<number> {
  if (fromUomId === baseUomId) return quantity;
  const direct = await client.productUnitConversion.findFirst({
    where: { productId, fromUomId, toUomId: baseUomId }
  });
  if (direct) return quantity * qtyNum(direct.factor);

  // Try reverse: 1 base = factor from → invert
  const reverse = await client.productUnitConversion.findFirst({
    where: { productId, fromUomId: baseUomId, toUomId: fromUomId }
  });
  if (reverse && qtyNum(reverse.factor) !== 0) {
    return quantity / qtyNum(reverse.factor);
  }

  // One-hop via packaging chain: from → X → base
  const fromLinks = await client.productUnitConversion.findMany({ where: { productId, fromUomId } });
  for (const link of fromLinks) {
    if (link.toUomId === baseUomId) return quantity * qtyNum(link.factor);
    const next = await client.productUnitConversion.findFirst({
      where: { productId, fromUomId: link.toUomId, toUomId: baseUomId }
    });
    if (next) return quantity * qtyNum(link.factor) * qtyNum(next.factor);
  }

  throw httpError(400, 'No unit conversion path to base UoM for this product');
}

type MovementInput = {
  product_id: string;
  variant_id?: string | null;
  warehouse_id: string;
  lot_id?: string | null;
  movement_type: string;
  quantity_in?: number;
  quantity_out?: number;
  unit_cost?: number | null;
  reference_type?: string | null;
  reference_id?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  manufacturing_date?: string | null;
  reason?: string | null;
  idempotency_key?: string | null;
  transaction_quantity?: number | null;
  transaction_uom_id?: string | null;
  allow_expired?: boolean;
  /** Required when product.trackSerial on receive/issue (unless reservation_id for issue). */
  serial_numbers?: string[] | null;
  /** When issuing reserved stock, prefer serials bound to this reservation. */
  reservation_id?: string | null;
};

async function createSingleMovement(
  client: DbClient,
  user: AuthUser,
  input: MovementInput & {
    product_id: string;
    variant_id: string;
    lot_id: string;
    batch_number: string;
    expiry_date: string | null;
    quantity_in: number;
    quantity_out: number;
  }
) {
  const lot = await client.stockLot.findFirst({
    where: { id: input.lot_id, businessId: user.businessId }
  });
  if (!lot) throw httpError(404, 'Stock lot not found');
  if (lot.variantId !== input.variant_id) {
    throw httpError(400, 'Lot does not belong to this variant');
  }
  if (lot.warehouseId !== input.warehouse_id) {
    throw httpError(400, 'Lot warehouse mismatch');
  }
  if (input.quantity_out > 0) {
    const free = lotAvailable(lot);
    if (input.quantity_out > free + 1e-9) {
      throw httpError(
        400,
        `Insufficient available quantity on lot ${lot.batchNumber}: need ${input.quantity_out}, available ${free}`
      );
    }
  }

  const newQty = qtyNum(lot.quantityOnHand) + input.quantity_in - input.quantity_out;
  await client.stockLot.update({
    where: { id: lot.id },
    data: {
      quantityOnHand: toDec(newQty),
      ...(input.unit_cost != null ? { unitCost: toDec(input.unit_cost) } : {})
    }
  });

  const moved = input.quantity_in || input.quantity_out;
  const unitCost = input.unit_cost != null ? Number(input.unit_cost) : qtyNum(lot.unitCost) || null;
  const totalCost = unitCost != null ? roundMoney(unitCost * moved) : null;

  const warehouse = await client.warehouse.findFirst({
    where: { id: input.warehouse_id, businessId: user.businessId },
    select: { branchId: true }
  });

  return client.stockMovement.create({
    data: {
      id: shortId('sm'),
      businessId: user.businessId,
      branchId: warehouse?.branchId || null,
      productId: input.product_id,
      variantId: input.variant_id,
      warehouseId: input.warehouse_id,
      lotId: lot.id,
      movementType: input.movement_type,
      quantityIn: toDec(input.quantity_in),
      quantityOut: toDec(input.quantity_out),
      transactionQuantity:
        input.transaction_quantity != null ? toDec(input.transaction_quantity) : null,
      transactionUomId: input.transaction_uom_id || null,
      unitCost: unitCost != null ? toDec(unitCost) : null,
      totalCost: totalCost != null ? toDec(totalCost) : null,
      referenceType: input.reference_type || null,
      referenceId: input.reference_id || null,
      batchNumber: input.batch_number,
      expiryDate: input.expiry_date,
      reason: input.reason || null,
      performedById: user.id,
      performedByName: user.fullName,
      idempotencyKey: input.idempotency_key || null,
      status: 'completed'
    }
  });
}

/**
 * Sole controlled path for stock quantity changes.
 * Receipts create/update lots; issues allocate FEFO/FIFO unless lot_id provided.
 */
export async function createStockMovement(user: AuthUser, input: MovementInput, tx?: Prisma.TransactionClient) {
  const run = async (client: DbClient) => {
    if (input.idempotency_key) {
      const existing = await client.stockMovement.findFirst({
        where: { businessId: user.businessId, idempotencyKey: input.idempotency_key }
      });
      if (existing) return existing;
    }

    const product = await client.product.findFirst({
      where: { id: input.product_id, businessId: user.businessId },
      include: { variants: true }
    });
    if (!product) throw httpError(404, 'Product not found');

    let variantId = input.variant_id || null;
    if (!variantId) {
      const def = product.variants.find((v) => v.isDefault) || product.variants[0];
      if (!def) throw httpError(400, 'Product has no variants');
      variantId = def.id;
    } else {
      const ok = product.variants.some((v) => v.id === variantId);
      if (!ok) throw httpError(400, 'Invalid variant_id for product');
    }

    const warehouse = await client.warehouse.findFirst({
      where: { id: input.warehouse_id, businessId: user.businessId, isActive: true }
    });
    if (!warehouse) throw httpError(400, 'Invalid warehouse_id');

    let qtyIn = Math.max(0, Number(input.quantity_in) || 0);
    let qtyOut = Math.max(0, Number(input.quantity_out) || 0);

    if (input.transaction_uom_id && input.transaction_quantity != null) {
      const baseQty = await convertToBaseQty(
        client,
        product.id,
        input.transaction_uom_id,
        Number(input.transaction_quantity),
        product.baseUomId
      );
      if (qtyIn > 0 || (!qtyOut && input.movement_type?.includes('in'))) {
        qtyIn = baseQty;
        qtyOut = 0;
      } else {
        qtyOut = baseQty;
        qtyIn = 0;
      }
    }

    if (qtyIn === 0 && qtyOut === 0) {
      throw httpError(400, 'Movement requires quantity_in or quantity_out');
    }

    // Receipt — identity from lot_id or batch/expiry per product tracking flags
    if (qtyIn > 0) {
      let batch = (input.batch_number || '').trim();
      let expiry = normalizeExpiry(input.expiry_date);

      let lotId = input.lot_id || null;
      if (lotId) {
        const lot = await client.stockLot.findFirst({
          where: { id: lotId, businessId: user.businessId }
        });
        if (!lot) throw httpError(404, 'Stock lot not found');
        if (lot.productId !== product.id || lot.variantId !== variantId) {
          throw httpError(400, 'Stock lot does not match product/variant');
        }
        // Same-warehouse restock reuses the lot; cross-warehouse callers must pass batch/expiry instead
        if (lot.warehouseId !== input.warehouse_id) {
          throw httpError(
            400,
            'lot_id warehouse does not match movement warehouse — pass batch_number/expiry_date instead'
          );
        }
        batch = lot.batchNumber;
        expiry = lot.expiryDate;
      } else {
        if (product.trackExpiry && !expiry) {
          throw httpError(400, 'expiry_date is required for expiry-tracked products');
        }
        if (product.trackBatch && !batch) {
          throw httpError(400, 'batch_number is required for batch-tracked products');
        }
        if (!product.trackExpiry) expiry = null;
        if (!product.trackBatch && !batch) batch = 'BULK';

        const lot = await findOrCreateLot(client, {
          businessId: user.businessId,
          productId: product.id,
          variantId,
          warehouseId: input.warehouse_id,
          batchNumber: batch,
          expiryDate: expiry,
          manufacturingDate: input.manufacturing_date,
          unitCost: input.unit_cost
        });
        lotId = lot.id;
      }

      // transfer_in / sales_return restore existing serial rows elsewhere — do not mint new ones
      const mintSerials =
        product.trackSerial &&
        input.movement_type !== 'transfer_in' &&
        input.movement_type !== 'sales_return';
      if (mintSerials) {
        assertWholeSerialQty(qtyIn, 'Receipt quantity');
        const serials = normalizeSerialList(input.serial_numbers);
        if (serials.length !== Math.round(qtyIn)) {
          throw httpError(
            400,
            `serial_numbers must include exactly ${Math.round(qtyIn)} value(s) for serial-tracked products`
          );
        }
        await receiveSerials(client, {
          businessId: user.businessId,
          productId: product.id,
          variantId,
          warehouseId: input.warehouse_id,
          lotId: lotId!,
          serialNumbers: serials,
          unitCost: input.unit_cost
        });
      } else if (product.trackSerial && input.movement_type === 'sales_return') {
        assertWholeSerialQty(qtyIn, 'Return quantity');
      }

      return createSingleMovement(client, user, {
        ...input,
        product_id: product.id,
        variant_id: variantId,
        lot_id: lotId!,
        batch_number: batch || 'BULK',
        expiry_date: expiry,
        quantity_in: qtyIn,
        quantity_out: 0
      });
    }

    // Issue / out
    if (product.trackSerial && !input.lot_id && !input.reservation_id && !input.serial_numbers?.length) {
      throw httpError(
        400,
        'Serial-tracked products must be issued with serial_numbers (or a reserved lot_id)'
      );
    }

    if (input.lot_id) {
      const lot = await client.stockLot.findFirst({
        where: { id: input.lot_id, businessId: user.businessId }
      });
      if (!lot) throw httpError(404, 'Stock lot not found');
      if (
        product.trackExpiry &&
        lot.expiryDate &&
        lot.expiryDate < new Date().toISOString().slice(0, 10) &&
        !input.allow_expired
      ) {
        throw httpError(400, 'Cannot issue expired stock without authorised override');
      }
      if (product.trackSerial) {
        await issueSerials(client, {
          businessId: user.businessId,
          qty: qtyOut,
          reservationId: input.reservation_id,
          lotId: lot.id,
          serialNumbers: input.serial_numbers,
          referenceType: input.reference_type || input.movement_type || 'issue',
          referenceId: input.reference_id || input.idempotency_key || shortId('iss')
        });
      }
      return createSingleMovement(client, user, {
        ...input,
        product_id: product.id,
        variant_id: variantId,
        lot_id: lot.id,
        batch_number: lot.batchNumber,
        expiry_date: lot.expiryDate,
        quantity_in: 0,
        quantity_out: qtyOut
      });
    }

    if (product.trackSerial) {
      throw httpError(
        400,
        'Serial-tracked products cannot auto-allocate by FEFO — provide lot_id and serial_numbers'
      );
    }

    const allocations = await allocateFefo(
      client,
      variantId,
      input.warehouse_id,
      qtyOut,
      product.trackExpiry
    );

    let last = null;
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      const key =
        input.idempotency_key && allocations.length > 1
          ? `${input.idempotency_key}:${i}`
          : i === 0
            ? input.idempotency_key || null
            : null;
      last = await createSingleMovement(client, user, {
        ...input,
        product_id: product.id,
        variant_id: variantId,
        lot_id: a.lotId,
        batch_number: a.batchNumber,
        expiry_date: a.expiryDate,
        quantity_in: 0,
        quantity_out: a.qty,
        idempotency_key: key
      });
    }
    return last!;
  };

  if (tx) return run(tx);
  return prisma.$transaction((inner) => run(inner));
}

export async function receiveStock(user: AuthUser, body: Record<string, any>) {
  const movement = await createStockMovement(user, {
    product_id: body.product_id || body.productId,
    variant_id: body.variant_id || body.variantId,
    warehouse_id: body.warehouse_id || body.warehouseId,
    movement_type: body.movement_type || 'receive',
    quantity_in: body.quantity ?? body.quantity_in,
    unit_cost: body.unit_cost ?? body.unitCost,
    batch_number: body.batch_number || body.batchNumber,
    expiry_date: body.expiry_date || body.expiryDate,
    manufacturing_date: body.manufacturing_date || body.manufacturingDate,
    serial_numbers: body.serial_numbers || body.serialNumbers,
    reason: body.reason,
    reference_type: body.reference_type || body.referenceType || 'manual_receive',
    reference_id: body.reference_id || body.referenceId,
    idempotency_key: body.idempotency_key || body.idempotencyKey,
    transaction_quantity: body.transaction_quantity ?? body.transactionQuantity,
    transaction_uom_id: body.transaction_uom_id || body.transactionUomId
  });
  await writeAudit({
    user,
    action: 'receive',
    module: 'inventory',
    entityType: 'StockMovement',
    entityId: movement.id,
    summary: `Received stock for product ${body.product_id || body.productId}`
  });
  return serialize(movement);
}

export async function issueStock(user: AuthUser, body: Record<string, any>) {
  const movement = await createStockMovement(user, {
    product_id: body.product_id || body.productId,
    variant_id: body.variant_id || body.variantId,
    warehouse_id: body.warehouse_id || body.warehouseId,
    lot_id: body.lot_id || body.lotId,
    movement_type: body.movement_type || 'issue',
    quantity_out: body.quantity ?? body.quantity_out,
    reason: body.reason,
    allow_expired: Boolean(body.allow_expired || body.allowExpired),
    reference_type: body.reference_type || body.referenceType || 'manual_issue',
    reference_id: body.reference_id || body.referenceId,
    idempotency_key: body.idempotency_key || body.idempotencyKey,
    transaction_quantity: body.transaction_quantity ?? body.transactionQuantity,
    transaction_uom_id: body.transaction_uom_id || body.transactionUomId
  });
  await writeAudit({
    user,
    action: 'issue',
    module: 'inventory',
    entityType: 'StockMovement',
    entityId: movement.id,
    summary: `Issued stock for product ${body.product_id || body.productId}`
  });
  return serialize(movement);
}

export async function adjustStock(user: AuthUser, body: Record<string, any>) {
  const qty = Number(body.quantity);
  if (!qty || qty === 0) throw httpError(400, 'quantity must be non-zero');
  const movement = await createStockMovement(user, {
    product_id: body.product_id || body.productId,
    variant_id: body.variant_id || body.variantId,
    warehouse_id: body.warehouse_id || body.warehouseId,
    lot_id: body.lot_id || body.lotId,
    movement_type: qty > 0 ? 'adjust_in' : 'adjust_out',
    quantity_in: qty > 0 ? qty : 0,
    quantity_out: qty < 0 ? Math.abs(qty) : 0,
    unit_cost: body.unit_cost ?? body.unitCost,
    batch_number: body.batch_number || body.batchNumber,
    expiry_date: body.expiry_date || body.expiryDate,
    reason: body.reason || 'Stock adjustment',
    allow_expired: true,
    reference_type: 'adjustment',
    idempotency_key: body.idempotency_key || body.idempotencyKey
  });
  await writeAudit({
    user,
    action: 'adjust',
    module: 'inventory',
    entityType: 'StockMovement',
    entityId: movement.id,
    summary: `Adjusted stock by ${qty}`
  });
  return serialize(movement);
}

export async function inventoryBoard(
  user: AuthUser,
  warehouseId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, isActive: true, ...scope },
    select: { id: true }
  });
  const warehouseIds = warehouses.map((w) => w.id);
  if (warehouseId && !warehouseIds.includes(warehouseId)) {
    throw httpError(400, 'Warehouse is outside the active branch scope');
  }
  const scopedWarehouseFilter = warehouseId
    ? { warehouseId }
    : warehouseIds.length
      ? { warehouseId: { in: warehouseIds } }
      : { warehouseId: { in: [] as string[] } };

  const products = await prisma.product.findMany({
    where: { businessId: user.businessId, status: 'active' },
    include: {
      category: true,
      brand: true,
      baseUom: true,
      variants: {
        where: { isActive: true },
        include: {
          stockLots: {
            where: {
              quantityOnHand: { gt: 0 },
              ...scopedWarehouseFilter
            },
            include: { warehouse: true },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }]
          }
        }
      }
    },
    orderBy: { name: 'asc' }
  });

  const today = new Date().toISOString().slice(0, 10);
  const board = products.map((p) => {
    const lots = p.variants.flatMap((v) =>
      v.stockLots.map((l) => ({
        ...l,
        variant_id: v.id,
        variant_name: v.name,
        available: lotAvailable(l),
        in_transit: qtyNum(l.quantityInTransit),
        is_expired: p.trackExpiry && !!l.expiryDate && l.expiryDate < today
      }))
    );
    const onHand = lots.reduce((s, l) => s + qtyNum(l.quantityOnHand), 0);
    const available = lots.reduce((s, l) => s + l.available, 0);
    const inTransit = lots.reduce((s, l) => s + qtyNum(l.in_transit), 0);
    const nearest = lots.find((l) => l.expiryDate) || lots[0];
    return {
      ...p,
      on_hand: onHand,
      available,
      in_transit: inTransit,
      lots_count: lots.length,
      nearest_expiry: nearest?.expiryDate || null,
      nearest_batch: nearest?.batchNumber || null,
      has_expired_lots: lots.some((l) => l.is_expired),
      is_low_stock: available <= qtyNum(p.reorderLevel),
      lots
    };
  });
  return serialize(board);
}

/**
 * Warehouses the caller may read stock from for lot/serial pickers.
 * An explicit warehouse_id (e.g. transfer From) is allowed when the user can access
 * that warehouse — even if it is not the active branch (inter-branch transfer).
 */
async function stockPickerWarehouseIds(
  user: AuthUser,
  filters: { warehouse_id?: string; branchId?: string | null; allowConsolidated?: boolean }
): Promise<string[]> {
  if (filters.warehouse_id) {
    const { assertUserCanAccessWarehouse } = await import('./warehouse.service.js');
    await assertUserCanAccessWarehouse(user, filters.warehouse_id);
    return [filters.warehouse_id];
  }
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filters.branchId,
    allowConsolidated: filters.allowConsolidated
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, ...scope },
    select: { id: true }
  });
  return warehouses.map((w) => w.id);
}

export async function listAvailableSerials(
  user: AuthUser,
  filters: {
    product_id?: string;
    warehouse_id?: string;
    lot_id?: string;
    variant_id?: string;
  } & BranchListOpts = {}
) {
  const warehouseIds = await stockPickerWarehouseIds(user, filters);
  if (!warehouseIds.length) return serialize([]);
  const { listAvailableSerials: list } = await import('./stock-serial.service.js');
  const rows = await list(prisma, {
    businessId: user.businessId,
    productId: filters.product_id,
    warehouseId: filters.warehouse_id || undefined,
    lotId: filters.lot_id,
    variantId: filters.variant_id,
    take: 1000
  });
  const allowed = new Set(warehouseIds);
  return serialize(rows.filter((r) => allowed.has(r.warehouseId)));
}

export async function listLots(
  user: AuthUser,
  filters: {
    product_id?: string;
    warehouse_id?: string;
    include_empty?: boolean;
  } & BranchListOpts = {}
) {
  const warehouseIds = await stockPickerWarehouseIds(user, filters);
  const lots = await prisma.stockLot.findMany({
    where: {
      businessId: user.businessId,
      ...(filters.product_id ? { productId: filters.product_id } : {}),
      warehouseId: filters.warehouse_id
        ? filters.warehouse_id
        : warehouseIds.length
          ? { in: warehouseIds }
          : { in: [] as string[] },
      ...(!filters.include_empty ? { quantityOnHand: { gt: 0 } } : {})
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          trackBatch: true,
          trackExpiry: true,
          trackSerial: true
        }
      },
      variant: { select: { id: true, name: true, sku: true } },
      warehouse: { select: { id: true, name: true, code: true } }
    },
    orderBy: [{ expiryDate: 'asc' }, { productId: 'asc' }]
  });
  const today = new Date().toISOString().slice(0, 10);
  return serialize(
    lots.map((l) => ({
      ...l,
      available: lotAvailable(l),
      in_transit: qtyNum(l.quantityInTransit),
      is_expired: !!l.expiryDate && l.expiryDate < today,
      days_to_expiry: l.expiryDate
        ? Math.ceil((new Date(`${l.expiryDate}T00:00:00`).getTime() - Date.now()) / 86400000)
        : null
    }))
  );
}

export async function listMovements(
  user: AuthUser,
  filters: {
    product_id?: string;
    warehouse_id?: string;
    movement_type?: string;
    from?: string | Date;
    to?: string | Date;
  } & BranchListOpts = {}
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filters.branchId,
    allowConsolidated: filters.allowConsolidated
  });
  const fromDate = filters.from ? new Date(filters.from) : null;
  const toDate = filters.to ? new Date(filters.to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    // Inclusive end-of-day when only a date is supplied
    if (typeof filters.to === 'string' && filters.to.length <= 10) {
      toDate.setHours(23, 59, 59, 999);
    }
  }
  const movements = await prisma.stockMovement.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(filters.product_id ? { productId: filters.product_id } : {}),
      ...(filters.warehouse_id ? { warehouseId: filters.warehouse_id } : {}),
      ...(filters.movement_type ? { movementType: filters.movement_type } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { gte: fromDate } : {}),
              ...(toDate && !Number.isNaN(toDate.getTime()) ? { lte: toDate } : {})
            }
          }
        : {})
    },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      variant: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      lot: { select: { id: true, batchNumber: true, expiryDate: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  return serialize(movements);
}

export async function expiryReport(
  user: AuthUser,
  withinDays = 90,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, ...scope },
    select: { id: true }
  });
  const warehouseIds = warehouses.map((w) => w.id);
  const today = new Date();
  const horizon = new Date(today.getTime() + withinDays * 86400000).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const lots = await prisma.stockLot.findMany({
    where: {
      businessId: user.businessId,
      warehouseId: { in: warehouseIds },
      quantityOnHand: { gt: 0 },
      expiryDate: { not: null, lte: horizon }
    },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      variant: true,
      warehouse: true
    },
    orderBy: { expiryDate: 'asc' }
  });
  return serialize(
    lots.map((l) => ({
      ...l,
      is_expired: (l.expiryDate || '') < todayStr,
      is_near_expiry: (l.expiryDate || '') >= todayStr && (l.expiryDate || '') <= horizon
    }))
  );
}

export async function onHandQty(
  businessId: string,
  variantId: string,
  warehouseId?: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const lots = await client.stockLot.findMany({
    where: {
      businessId,
      variantId,
      status: 'available',
      ...(warehouseId ? { warehouseId } : {})
    },
    select: { quantityOnHand: true, quantityReserved: true, quantityInTransit: true }
  });
  return lots.reduce((s, l) => s + lotAvailable(l), 0);
}
