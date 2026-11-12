import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError } from '../utils/helpers.js';
import { convertToBaseQty } from './inventory.service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

const EPS = 1e-6;
export const roundQty = (n: number) => Math.round(n * 10000) / 10000;

/** Warehouse categories whose stock is never offered to customers. */
const UNSELLABLE_CATEGORIES = new Set(['damaged', 'quarantine']);

export type WarehouseStock = {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  branchId: string;
  branchName: string;
  onHand: number;
  reserved: number;
  /** Unavailable: expired lots (expiry-tracked products) and non-available lot statuses */
  blocked: number;
  free: number;
};

/**
 * Free stock per variant and sellable warehouse:
 * on hand − reserved − (expired / blocked lots), never negative.
 */
export async function stockByWarehouse(
  client: DbClient,
  businessId: string,
  variantIds: string[]
): Promise<Map<string, WarehouseStock[]>> {
  const ids = [...new Set(variantIds.filter(Boolean))];
  const out = new Map<string, WarehouseStock[]>();
  if (!ids.length) return out;

  const [warehouses, lots, variants] = await Promise.all([
    client.warehouse.findMany({
      where: { businessId, isActive: true, branch: { isActive: true } },
      include: { branch: { select: { id: true, name: true } } }
    }),
    client.stockLot.findMany({
      where: { businessId, variantId: { in: ids }, quantityOnHand: { gt: 0 } },
      select: {
        variantId: true,
        warehouseId: true,
        status: true,
        expiryDate: true,
        quantityOnHand: true,
        quantityReserved: true
      }
    }),
    client.productVariant.findMany({
      where: { id: { in: ids } },
      select: { id: true, product: { select: { trackExpiry: true } } }
    })
  ]);
  const sellable = new Map(
    warehouses
      .filter((w) => !UNSELLABLE_CATEGORIES.has(String(w.category || '').toLowerCase()))
      .map((w) => [w.id, w])
  );
  const tracksExpiry = new Map(variants.map((v) => [v.id, Boolean(v.product.trackExpiry)]));
  const today = new Date().toISOString().slice(0, 10);

  const acc = new Map<string, WarehouseStock>();
  for (const lot of lots) {
    const wh = sellable.get(lot.warehouseId);
    if (!wh) continue;
    const key = `${lot.variantId}:${lot.warehouseId}`;
    let row = acc.get(key);
    if (!row) {
      row = {
        warehouseId: wh.id,
        warehouseName: wh.name,
        warehouseCode: wh.code,
        branchId: wh.branchId,
        branchName: wh.branch.name,
        onHand: 0,
        reserved: 0,
        blocked: 0,
        free: 0
      };
      acc.set(key, row);
    }
    const onHand = Number(lot.quantityOnHand);
    const reserved = Number(lot.quantityReserved);
    const inTransit = Number(lot.quantityInTransit || 0);
    const expired =
      tracksExpiry.get(lot.variantId) && lot.expiryDate != null && lot.expiryDate < today;
    row.onHand += onHand;
    row.reserved += reserved;
    if (lot.status !== 'available' || expired) {
      row.blocked += Math.max(0, onHand - reserved - inTransit);
    } else {
      row.free += Math.max(0, onHand - reserved - inTransit);
    }
  }
  for (const [key, row] of acc) {
    const variantId = key.split(':')[0];
    row.onHand = roundQty(row.onHand);
    row.reserved = roundQty(row.reserved);
    row.blocked = roundQty(row.blocked);
    row.free = roundQty(row.free);
    const list = out.get(variantId) || [];
    list.push(row);
    out.set(variantId, list);
  }
  return out;
}

export type PlanLineInput = {
  key: string;
  productId: string;
  variantId: string;
  uomId: string;
  baseUomId: string;
  productName: string;
  /** Quantity still to allocate, line UoM */
  quantity: number;
  preferredWarehouseId?: string | null;
  /** Manual split in the line UoM */
  manual?: { warehouseId: string; quantity: number }[] | null;
};

export type PlannedAllocation = {
  warehouseId: string;
  branchId: string;
  /** Base UoM */
  baseQuantity: number;
  /** Line UoM */
  quantity: number;
  method: 'auto' | 'manual';
};

export type PlanLineResult = {
  key: string;
  productId: string;
  variantId: string;
  requested: number;
  requestedBase: number;
  /** Line UoM per base unit */
  factor: number;
  allocations: PlannedAllocation[];
  allocated: number;
  shortage: number;
  stock: WarehouseStock[];
};

/**
 * Split each line across sellable warehouses.
 * Order of preference: manual split → line preferred warehouse → order default warehouse →
 * other warehouses in the preferred branch → remaining warehouses with the most free stock
 * (fewest locations). `restrictToBranchId` limits candidates (counter hand-over).
 */
export async function planAllocation(
  client: DbClient,
  businessId: string,
  lines: PlanLineInput[],
  opts: {
    defaultWarehouseId?: string | null;
    restrictToBranchId?: string | null;
    excludeWarehouseIds?: string[];
  } = {}
): Promise<PlanLineResult[]> {
  const excluded = new Set(opts.excludeWarehouseIds || []);
  const stock = await stockByWarehouse(
    client,
    businessId,
    lines.map((l) => l.variantId)
  );
  const remainingFree = new Map<string, number>();
  for (const [variantId, rows] of stock) {
    for (const r of rows) remainingFree.set(`${variantId}:${r.warehouseId}`, r.free);
  }
  const whBranch = new Map<string, string>();
  for (const rows of stock.values()) for (const r of rows) whBranch.set(r.warehouseId, r.branchId);
  let defaultBranchId: string | null = null;
  if (opts.defaultWarehouseId) {
    const wh = await client.warehouse.findFirst({
      where: { id: opts.defaultWarehouseId, businessId },
      select: { branchId: true }
    });
    defaultBranchId = wh?.branchId || null;
  }

  const results: PlanLineResult[] = [];
  for (const line of lines) {
    const requestedBase = roundQty(
      await convertToBaseQty(client, line.productId, line.uomId, line.quantity, line.baseUomId)
    );
    const factor = requestedBase > 0 ? line.quantity / requestedBase : 1;
    const rows = (stock.get(line.variantId) || []).filter(
      (r) =>
        (!opts.restrictToBranchId || r.branchId === opts.restrictToBranchId) &&
        !excluded.has(r.warehouseId)
    );
    const freeOf = (whId: string) => remainingFree.get(`${line.variantId}:${whId}`) ?? 0;
    const allocations: PlannedAllocation[] = [];
    let need = requestedBase;

    const take = (whId: string, base: number, method: 'auto' | 'manual') => {
      const qty = roundQty(Math.min(base, need));
      if (qty <= EPS) return;
      remainingFree.set(`${line.variantId}:${whId}`, roundQty(freeOf(whId) - qty));
      const existing = allocations.find((a) => a.warehouseId === whId);
      if (existing) {
        existing.baseQuantity = roundQty(existing.baseQuantity + qty);
        existing.quantity = roundQty(existing.baseQuantity * factor);
      } else {
        allocations.push({
          warehouseId: whId,
          branchId: whBranch.get(whId) || '',
          baseQuantity: qty,
          quantity: roundQty(qty * factor),
          method
        });
      }
      need = roundQty(need - qty);
    };

    if (line.manual?.length) {
      for (const m of line.manual) {
        if (!(m.quantity > 0)) continue;
        if (!rows.some((r) => r.warehouseId === m.warehouseId)) {
          throw httpError(
            400,
            `${line.productName}: the chosen warehouse has no sellable stock${
              opts.restrictToBranchId ? ' in this branch' : ''
            }`
          );
        }
        const base = roundQty(m.quantity / factor);
        if (base > freeOf(m.warehouseId) + EPS) {
          throw httpError(
            400,
            `${line.productName}: only ${roundQty(freeOf(m.warehouseId) * factor)} free in the chosen warehouse`
          );
        }
        if (base > need + EPS) {
          throw httpError(400, `${line.productName}: manual allocation exceeds the ordered quantity`);
        }
        take(m.warehouseId, base, 'manual');
      }
    } else {
      const preferred = [line.preferredWarehouseId, opts.defaultWarehouseId].filter(
        (id): id is string => Boolean(id)
      );
      for (const whId of preferred) {
        if (need <= EPS) break;
        if (rows.some((r) => r.warehouseId === whId)) take(whId, freeOf(whId), 'auto');
      }
      const preferredBranch =
        (line.preferredWarehouseId && whBranch.get(line.preferredWarehouseId)) || defaultBranchId;
      const rest = rows
        .filter((r) => !preferred.includes(r.warehouseId))
        .sort((a, b) => {
          const aHome = a.branchId === preferredBranch ? 0 : 1;
          const bHome = b.branchId === preferredBranch ? 0 : 1;
          if (aHome !== bHome) return aHome - bHome;
          return freeOf(b.warehouseId) - freeOf(a.warehouseId);
        });
      for (const r of rest) {
        if (need <= EPS) break;
        take(r.warehouseId, freeOf(r.warehouseId), 'auto');
      }
    }

    const allocatedBase = roundQty(requestedBase - need);
    results.push({
      key: line.key,
      productId: line.productId,
      variantId: line.variantId,
      requested: line.quantity,
      requestedBase,
      factor,
      allocations,
      allocated: roundQty(allocatedBase * factor),
      shortage: roundQty(need * factor),
      stock: rows
    });
  }
  return results;
}

export function parseManualPlan(raw: unknown): { warehouseId: string; quantity: number }[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = raw
    .map((r: any) => ({
      warehouseId: String(r?.warehouse_id || r?.warehouseId || ''),
      quantity: Number(r?.quantity)
    }))
    .filter((r) => r.warehouseId && Number.isFinite(r.quantity) && r.quantity > 0);
  return out.length ? out : null;
}
