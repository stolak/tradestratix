import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { allocateFefo, convertToBaseQty, createStockMovement } from './inventory.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import { consumeCreditAgainstInvoiceBalance } from './customer-payment.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  parseManualPlan,
  planAllocation,
  roundQty,
  stockByWarehouse,
  type PlanLineResult
} from './stock-allocation.service.js';
import { lockInvoices } from './customer-payment.service.js';

type Tx = Prisma.TransactionClient;
type Num = Prisma.Decimal | number;

const EPS = 1e-6;
const n = (v: unknown) => Number(v || 0);

export type InvoiceForFulfilment = {
  id: string;
  businessId: string;
  invoiceNumber: string;
  branchId: string | null;
  sellingBranchId: string | null;
  warehouseId: string;
  customerId: string;
  salesRepId: string | null;
  subtotal: Num;
  taxAmount: Num;
  totalAmount: Num;
  recognitionPolicy: string;
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    uomId: string | null;
    quantity: Num;
    baseQuantity: Num | null;
    lineTotal: Num;
    fulfilledQuantity: Num;
    cancelledQuantity: Num;
    recognisedAmount: Num;
    fulfilmentWarehouseId: string | null;
    allocationPlan: Prisma.JsonValue | null;
  }[];
};

/** Line UoM units per base unit. */
export function lineFactor(item: { quantity: Num; baseQuantity: Num | null }) {
  const base = n(item.baseQuantity);
  return base > 0 ? n(item.quantity) / base : 1;
}

/** Line value after the invoice-level customer discount and tax share. */
export function lineValue(invoice: InvoiceForFulfilment, item: { lineTotal: Num }) {
  const subtotal = n(invoice.subtotal);
  if (subtotal <= 0) return 0;
  return roundMoney((n(item.lineTotal) * n(invoice.totalAmount)) / subtotal);
}

export async function invoiceForFulfilment(tx: Tx, businessId: string, invoiceId: string) {
  return tx.salesInvoice.findFirst({
    where: { id: invoiceId, businessId },
    include: { items: { orderBy: { id: 'asc' } } }
  });
}

export async function activeReservations(tx: Tx, itemIds: string[]) {
  if (!itemIds.length) return [];
  return tx.salesReservation.findMany({
    where: { invoiceItemId: { in: itemIds }, status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
}

export const reservationLeft = (r: { quantity: Num; fulfilledQuantity: Num; releasedQuantity: Num }) =>
  roundQty(n(r.quantity) - n(r.fulfilledQuantity) - n(r.releasedQuantity));

export type ReserveOptions = {
  restrictToBranchId?: string | null;
  allowBackorder?: boolean;
  excludeWarehouseIds?: string[];
  onlyItemIds?: string[];
  /** Per-line manual split overriding the saved plan (line UoM). */
  manual?: Map<string, { warehouseId: string; quantity: number }[]>;
  /** Cap per line (line UoM); default = everything not yet reserved, fulfilled or cancelled. */
  quantities?: Map<string, number>;
  method?: 'auto' | 'manual' | 'reallocation' | 'backorder';
  /** Apply the split saved on the draft (first confirmation only). */
  useSavedPlan?: boolean;
};

/**
 * Allocate and reserve stock lots for invoice lines (FEFO/FIFO within each warehouse).
 * The guarded UPDATE makes concurrent reservations of the same free quantity fail instead of overselling.
 */
export async function reserveInvoiceStock(
  tx: Tx,
  user: AuthUser,
  invoice: InvoiceForFulfilment,
  opts: ReserveOptions = {}
): Promise<PlanLineResult[]> {
  const items = invoice.items.filter((i) => !opts.onlyItemIds || opts.onlyItemIds.includes(i.id));
  if (!items.length) return [];
  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productId))] }, businessId: user.businessId },
    include: { variants: true }
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const active = await activeReservations(tx, items.map((i) => i.id));

  const inputs = [];
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) throw httpError(400, 'Product missing on invoice line');
    const variantId =
      item.variantId || (product.variants.find((v) => v.isDefault) || product.variants[0])?.id;
    if (!variantId) throw httpError(400, `Product ${product.name} has no variants`);

    if (item.baseQuantity == null) {
      const base = roundQty(
        await convertToBaseQty(tx, product.id, item.uomId || product.baseUomId, n(item.quantity), product.baseUomId)
      );
      await tx.salesInvoiceItem.update({ where: { id: item.id }, data: { baseQuantity: toDec(base) } });
      item.baseQuantity = base;
    }
    const factor = lineFactor(item);
    const reservedLine = roundQty(
      active.filter((r) => r.invoiceItemId === item.id).reduce((s, r) => s + reservationLeft(r), 0) * factor
    );
    const open = roundQty(n(item.quantity) - n(item.fulfilledQuantity) - n(item.cancelledQuantity) - reservedLine);
    const want = Math.min(open, opts.quantities?.get(item.id) ?? open);
    if (want <= EPS) continue;
    inputs.push({
      key: item.id,
      productId: product.id,
      variantId,
      uomId: item.uomId || product.baseUomId,
      baseUomId: product.baseUomId,
      productName: product.name,
      quantity: want,
      preferredWarehouseId: item.fulfilmentWarehouseId || null,
      manual: opts.manual
        ? opts.manual.get(item.id) ?? null
        : opts.useSavedPlan
          ? parseManualPlan(item.allocationPlan)
          : null
    });
  }
  if (!inputs.length) return [];

  const plan = await planAllocation(tx, user.businessId, inputs, {
    defaultWarehouseId: invoice.warehouseId,
    restrictToBranchId: opts.restrictToBranchId,
    excludeWarehouseIds: opts.excludeWarehouseIds
  });

  const short = plan.filter((p) => p.shortage > EPS);
  if (short.length && !opts.allowBackorder) {
    const names = new Map(inputs.map((i) => [i.key, i.productName]));
    throw httpError(
      400,
      `Insufficient sellable stock${opts.restrictToBranchId ? ' in this branch' : ''}: ` +
        short.map((s) => `${names.get(s.key)} short ${s.shortage}`).join('; ') +
        '. Allocate from another warehouse, reduce the quantity, or confirm with backorder.'
    );
  }

  for (const line of plan) {
    const product = productById.get(line.productId)!;
    for (const a of line.allocations) {
      const lots = await allocateFefo(tx, line.variantId, a.warehouseId, a.baseQuantity, product.trackExpiry);
      for (const lot of lots) {
        const affected = await tx.$executeRaw`
          UPDATE stock_lots
             SET quantity_reserved = quantity_reserved + ${lot.qty}
           WHERE id = ${lot.lotId}
             AND quantity_on_hand - quantity_reserved >= ${lot.qty - EPS}`;
        if (affected !== 1) {
          throw httpError(409, `Stock for ${product.name} changed while reserving; please retry`);
        }
        await tx.salesReservation.create({
          data: {
            id: shortId('srv'),
            businessId: user.businessId,
            invoiceItemId: line.key,
            lotId: lot.lotId,
            warehouseId: a.warehouseId,
            branchId: a.branchId || null,
            quantity: toDec(lot.qty),
            method: opts.method || a.method,
            createdById: user.id
          }
        });
      }
    }
  }
  return plan;
}

/** Return reserved-but-unpicked quantity to free stock. `quantity` is in base units per reservation. */
export async function releaseReservations(
  tx: Tx,
  userId: string | null,
  reservations: { id: string; lotId: string; quantity: Num; fulfilledQuantity: Num; releasedQuantity: Num }[],
  reason: string,
  limitBase?: number
) {
  let budget = limitBase ?? Infinity;
  let released = 0;
  for (const r of reservations) {
    if (budget <= EPS) break;
    const left = reservationLeft(r);
    const take = roundQty(Math.min(left, budget));
    if (take <= EPS) continue;
    const affected = await tx.$executeRaw`
      UPDATE stock_lots SET quantity_reserved = GREATEST(0, quantity_reserved - ${take}) WHERE id = ${r.lotId}`;
    if (affected !== 1) throw httpError(409, 'Reserved lot not found');
    const releasedQty = roundQty(n(r.releasedQuantity) + take);
    await tx.salesReservation.update({
      where: { id: r.id },
      data: {
        releasedQuantity: toDec(releasedQty),
        status: roundQty(n(r.fulfilledQuantity) + releasedQty) >= n(r.quantity) - EPS
          ? n(r.fulfilledQuantity) > EPS ? 'fulfilled' : 'released'
          : 'active',
        releasedById: userId,
        releasedAt: new Date(),
        releaseReason: reason
      }
    });
    budget = roundQty(budget - take);
    released = roundQty(released + take);
  }
  return released;
}

export function fulfilmentStatusOf(items: { quantity: Num; fulfilledQuantity: Num; cancelledQuantity: Num }[]) {
  const allDone = items.every((i) => n(i.fulfilledQuantity) + n(i.cancelledQuantity) >= n(i.quantity) - EPS);
  const anyDone = items.some((i) => n(i.fulfilledQuantity) > EPS);
  return allDone ? 'fulfilled' : anyDone ? 'partial' : 'pending';
}

export type FulfilRequest = { invoiceItemId: string; quantity: number };
export type FulfilMeta = {
  collectedBy?: string | null;
  collectorPhone?: string | null;
  collectorRelation?: string | null;
  idType?: string | null;
  idReference?: string | null;
  verificationMethod?: string | null;
  acknowledged?: boolean;
  signatureName?: string | null;
  proofReference?: string | null;
  notes?: string | null;
  /** Post an existing warehouse fulfilment (picked task) instead of creating a new record. */
  existingFulfilmentId?: string | null;
  fulfilmentType?: 'pickup' | 'delivery';
  /** Final status of the record: released (handed over at the counter / warehouse) or delivered. */
  finalStatus?: 'released' | 'delivered';
};

/** Keep only the last 4 characters of an identity document number. */
export function maskIdReference(v: unknown) {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (!s) return null;
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
}

function headerMeta(meta: FulfilMeta) {
  return {
    collectedBy: meta.collectedBy || null,
    collectorPhone: meta.collectorPhone || null,
    collectorRelation: meta.collectorRelation || null,
    idType: meta.idType || null,
    idReference: maskIdReference(meta.idReference),
    verificationMethod: meta.verificationMethod || null,
    acknowledged: Boolean(meta.acknowledged),
    signatureName: meta.signatureName || null,
    proofReference: meta.proofReference || null
  };
}

/**
 * Hand over goods from one warehouse: issue the reserved lots, recognise revenue/AR for the handed-over
 * share (applying any customer deposit), and book COGS in the revenue branch — with linked inter-branch
 * clearing journals when the warehouse belongs to another branch.
 */
export async function fulfilInTx(
  tx: Tx,
  user: AuthUser,
  invoice: InvoiceForFulfilment,
  warehouseId: string,
  requests: FulfilRequest[],
  meta: FulfilMeta = {}
) {
  if (!requests.length) throw httpError(400, 'Select at least one line to release');
  const warehouse = await tx.warehouse.findFirst({
    where: { id: warehouseId, businessId: user.businessId },
    include: { branch: { select: { id: true, name: true } } }
  });
  if (!warehouse) throw httpError(400, 'Invalid warehouse_id');

  const finalStatus = meta.finalStatus || 'released';
  let fulfilmentId: string;
  let fulfilmentNumber: string;
  if (meta.existingFulfilmentId) {
    const existing = await tx.salesFulfilment.findFirst({
      where: { id: meta.existingFulfilmentId, businessId: user.businessId, invoiceId: invoice.id, warehouseId: warehouse.id }
    });
    if (!existing) throw httpError(404, 'Fulfilment not found for this order and warehouse');
    if (['released', 'delivered', 'cancelled', 'discrepancy'].includes(existing.status)) {
      throw httpError(400, `${existing.fulfilmentNumber} is already ${existing.status}`);
    }
    fulfilmentId = existing.id;
    fulfilmentNumber = existing.fulfilmentNumber;
    await tx.salesFulfilment.update({
      where: { id: fulfilmentId },
      data: {
        ...headerMeta(meta),
        status: finalStatus,
        notes: meta.notes ?? existing.notes,
        fulfilledById: user.id,
        fulfilledAt: new Date(),
        ...(finalStatus === 'delivered' ? { deliveredAt: new Date() } : {})
      }
    });
  } else {
    fulfilmentId = shortId('ful');
    fulfilmentNumber = await nextDocNumber(tx.salesFulfilment, user.businessId, 'fulfilmentNumber', 'FUL', 5);
    await tx.salesFulfilment.create({
      data: {
        id: fulfilmentId,
        businessId: user.businessId,
        fulfilmentNumber,
        invoiceId: invoice.id,
        warehouseId: warehouse.id,
        branchId: warehouse.branchId,
        fulfilmentType: meta.fulfilmentType || 'pickup',
        status: finalStatus,
        ...headerMeta(meta),
        notes: meta.notes || null,
        fulfilledById: user.id
      }
    });
  }

  const recognising = invoice.recognitionPolicy === 'at_fulfilment';
  const itemsById = new Map(invoice.items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  let totalCost = 0;
  let recognised = 0;
  let released = 0;

  for (const req of requests) {
    const line = itemsById.get(req.invoiceItemId);
    if (!line) throw httpError(400, `Line ${req.invoiceItemId} is not on invoice ${invoice.invoiceNumber}`);
    if (seen.has(line.id)) throw httpError(400, 'Each line may appear only once per release');
    seen.add(line.id);
    const qty = roundQty(Number(req.quantity));
    if (!(qty > 0)) continue;

    const reservations = await tx.salesReservation.findMany({
      where: { invoiceItemId: line.id, warehouseId: warehouse.id, status: 'active' },
      orderBy: { createdAt: 'asc' }
    });
    const factor = lineFactor(line);
    const reservedBase = roundQty(reservations.reduce((s, r) => s + reservationLeft(r), 0));
    const reservedLine = roundQty(reservedBase * factor);
    if (reservedBase <= EPS) {
      throw httpError(400, 'Nothing is reserved for this line in this warehouse');
    }
    if (qty > reservedLine + EPS) {
      throw httpError(400, `Cannot release ${qty}; only ${reservedLine} reserved in ${warehouse.name}`);
    }
    const baseQty = Math.abs(qty - reservedLine) < EPS ? reservedBase : roundQty(qty / factor);

    let need = baseQty;
    let lineCost = 0;
    let firstMovementId: string | null = null;
    for (const r of reservations) {
      if (need <= EPS) break;
      const take = roundQty(Math.min(reservationLeft(r), need));
      if (take <= EPS) continue;
      await tx.stockLot.update({
        where: { id: r.lotId },
        data: { quantityReserved: { decrement: toDec(take) } }
      });
      const movement = await createStockMovement(
        user,
        {
          product_id: line.productId,
          variant_id: line.variantId,
          warehouse_id: warehouse.id,
          lot_id: r.lotId,
          movement_type: 'sale',
          quantity_out: take,
          reference_type: 'sales_invoice',
          reference_id: invoice.id,
          idempotency_key: `ful:${fulfilmentId}:${r.id}`,
          reason: `${fulfilmentNumber} for ${invoice.invoiceNumber}`
        },
        tx
      );
      firstMovementId = firstMovementId || movement.id;
      lineCost = roundMoney(lineCost + n(movement.totalCost));
      const fulfilled = roundQty(n(r.fulfilledQuantity) + take);
      await tx.salesReservation.update({
        where: { id: r.id },
        data: {
          fulfilledQuantity: toDec(fulfilled),
          status: fulfilled + n(r.releasedQuantity) >= n(r.quantity) - EPS ? 'fulfilled' : 'active'
        }
      });
      need = roundQty(need - take);
    }

    const done = roundQty(n(line.fulfilledQuantity) + qty);
    let lineRecognised = 0;
    if (recognising) {
      const ordered = n(line.quantity);
      const value = lineValue(invoice, line);
      const closes = done + n(line.cancelledQuantity) >= ordered - EPS;
      const target = closes
        ? roundMoney((value * (ordered - n(line.cancelledQuantity))) / ordered)
        : roundMoney((value * done) / ordered);
      lineRecognised = roundMoney(Math.max(0, target - n(line.recognisedAmount)));
    }

    const itemData = {
      quantity: toDec(qty),
      baseQuantity: toDec(baseQty),
      cost: toDec(lineCost),
      recognisedAmount: toDec(lineRecognised)
    };
    const taskItem = meta.existingFulfilmentId
      ? await tx.salesFulfilmentItem.findFirst({ where: { fulfilmentId, invoiceItemId: line.id } })
      : null;
    if (taskItem) {
      await tx.salesFulfilmentItem.update({ where: { id: taskItem.id }, data: itemData });
    } else {
      await tx.salesFulfilmentItem.create({
        data: {
          id: shortId('sfi'),
          fulfilmentId,
          invoiceItemId: line.id,
          plannedQuantity: toDec(qty),
          pickedQuantity: toDec(qty),
          ...itemData
        }
      });
    }
    const current = await tx.salesInvoiceItem.findUniqueOrThrow({ where: { id: line.id } });
    await tx.salesInvoiceItem.update({
      where: { id: line.id },
      data: {
        fulfilledQuantity: toDec(done),
        recognisedAmount: toDec(roundMoney(n(current.recognisedAmount) + lineRecognised)),
        cogsAmount: toDec(roundMoney(n(current.cogsAmount) + lineCost)),
        stockMovementId: current.stockMovementId || firstMovementId
      }
    });
    line.fulfilledQuantity = done;
    line.recognisedAmount = roundMoney(n(line.recognisedAmount) + lineRecognised);
    totalCost = roundMoney(totalCost + lineCost);
    recognised = roundMoney(recognised + lineRecognised);
    released += 1;
  }

  if (!released) throw httpError(400, 'Enter a quantity to release on at least one line');

  const accountMap = await getDefaultAccountMap(user.businessId);
  const revenueBranchId = invoice.branchId || warehouse.branchId;
  const common = {
    customer_id: invoice.customerId,
    sales_representative_id: invoice.salesRepId || undefined,
    source_type: 'sales_fulfilment',
    source_id: fulfilmentId,
    post: true
  };

  let revenueJournalId: string | null = null;
  let depositApplied = 0;
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  if (recognised > 0) {
    for (const key of ['accounts_receivable', 'sales_revenue']) {
      if (!accountMap[key]) throw httpError(400, `Default account "${key}" is not configured`);
    }
    const total = n(invoice.totalAmount);
    const tax = accountMap.tax_payable && total > 0 ? roundMoney((recognised * n(invoice.taxAmount)) / total) : 0;
    // Prepaid receipts already Cr customer AR. Recognition still Dr AR / Cr revenue; the two net.
    // depositHeld only adjusts the invoice.balance memo (recognised − prepaid applied).
    depositApplied = roundMoney(Math.min(n(inv.depositHeld), recognised));
    const lines: any[] = [
      {
        account_id: accountMap.accounts_receivable,
        debit: recognised,
        description: `AR ${invoice.invoiceNumber} — ${fulfilmentNumber}`
      },
      {
        account_id: accountMap.sales_revenue,
        credit: roundMoney(recognised - tax),
        description: `Revenue ${invoice.invoiceNumber} (${fulfilmentNumber})`
      }
    ];
    if (tax > 0) {
      lines.push({
        account_id: accountMap.tax_payable,
        credit: tax,
        description: `Tax ${invoice.invoiceNumber}`
      });
    }
    const j: any = await createJournal(
      user,
      {
        ...common,
        memo: `Sale recognised ${invoice.invoiceNumber} (${fulfilmentNumber})`,
        idempotency_key: `sales_revenue:${fulfilmentId}`,
        branch_id: revenueBranchId,
        lines
      },
      tx,
      { trustedBranch: true }
    );
    revenueJournalId = j.id;

    if (invoice.salesRepId) {
      const commission = await tx.salesCommission.findUnique({
        where: { invoiceId_salesRepId: { invoiceId: invoice.id, salesRepId: invoice.salesRepId } }
      });
      if (commission && commission.status === 'accrued') {
        const pct = n(commission.commissionPercent);
        await tx.salesCommission.update({
          where: { id: commission.id },
          data: {
            baseAmount: toDec(roundMoney(n(commission.baseAmount) + recognised)),
            commissionAmount: toDec(roundMoney(n(commission.commissionAmount) + (recognised * pct) / 100))
          }
        });
      }
    }
  }

  let cogsJournalId: string | null = null;
  let inventoryJournalId: string | null = null;
  if (totalCost > 0) {
    for (const key of ['cogs', 'inventory']) {
      if (!accountMap[key]) throw httpError(400, `Default account "${key}" is not configured`);
    }
    if (revenueBranchId === warehouse.branchId) {
      const j: any = await createJournal(
        user,
        {
          ...common,
          memo: `COGS ${invoice.invoiceNumber} (${fulfilmentNumber})`,
          idempotency_key: `sales_cogs:${fulfilmentId}`,
          branch_id: revenueBranchId,
          lines: [
            { account_id: accountMap.cogs, debit: totalCost, description: `COGS ${invoice.invoiceNumber}` },
            { account_id: accountMap.inventory, credit: totalCost, description: `Inventory relief ${fulfilmentNumber}` }
          ]
        },
        tx,
        { trustedBranch: true }
      );
      cogsJournalId = j.id;
    } else {
      if (!accountMap.inter_branch_clearing) {
        throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
      }
      const invJ: any = await createJournal(
        user,
        {
          ...common,
          memo: `Inventory released for ${invoice.invoiceNumber} (${fulfilmentNumber})`,
          idempotency_key: `sales_fulfil_inv:${fulfilmentId}`,
          branch_id: warehouse.branchId,
          lines: [
            { account_id: accountMap.inter_branch_clearing, debit: totalCost, description: `Due from revenue branch — ${invoice.invoiceNumber}` },
            { account_id: accountMap.inventory, credit: totalCost, description: `Inventory relief ${fulfilmentNumber}` }
          ]
        },
        tx,
        { trustedBranch: true }
      );
      const cogsJ: any = await createJournal(
        user,
        {
          ...common,
          memo: `COGS ${invoice.invoiceNumber} (${fulfilmentNumber} from ${warehouse.branch.name})`,
          idempotency_key: `sales_cogs:${fulfilmentId}`,
          branch_id: revenueBranchId,
          lines: [
            { account_id: accountMap.cogs, debit: totalCost, description: `COGS ${invoice.invoiceNumber}` },
            { account_id: accountMap.inter_branch_clearing, credit: totalCost, description: `Due to ${warehouse.branch.name} — ${fulfilmentNumber}` }
          ]
        },
        tx,
        { trustedBranch: true }
      );
      inventoryJournalId = invJ.id;
      cogsJournalId = cogsJ.id;
    }
  }

  await tx.salesFulfilment.update({
    where: { id: fulfilmentId },
    data: {
      totalCost: toDec(totalCost),
      recognisedAmount: toDec(recognised),
      depositApplied: toDec(depositApplied),
      revenueJournalEntryId: revenueJournalId,
      cogsJournalEntryId: cogsJournalId,
      inventoryJournalEntryId: inventoryJournalId
    }
  });

  const all = await tx.salesInvoiceItem.findMany({ where: { invoiceId: invoice.id } });
  await tx.salesInvoice.update({
    where: { id: invoice.id },
    data: {
      fulfilmentStatus: fulfilmentStatusOf(all),
      cogsJournalEntryId: inv.cogsJournalEntryId || cogsJournalId,
      ...(recognised > 0
        ? {
            recognisedAmount: toDec(roundMoney(n(inv.recognisedAmount) + recognised)),
            depositHeld: toDec(roundMoney(n(inv.depositHeld) - depositApplied)),
            balance: toDec(roundMoney(n(inv.balance) + recognised - depositApplied)),
            journalEntryId: inv.journalEntryId || revenueJournalId
          }
        : {})
    }
  });

  // Free advances already Cr AR — absorb them into any remaining invoice balance (no GL).
  if (recognised > 0) {
    await consumeCreditAgainstInvoiceBalance(tx, user.businessId, invoice.customerId, invoice.id);
  }

  return { id: fulfilmentId, fulfilmentNumber, totalCost, recognised };
}

/** Release everything still reserved on the invoice, warehouse by warehouse (counter hand-over). */
export async function fulfilAllInTx(tx: Tx, user: AuthUser, invoice: InvoiceForFulfilment, meta: FulfilMeta) {
  const reservations = await activeReservations(tx, invoice.items.map((i) => i.id));
  const byWarehouse = new Map<string, Map<string, number>>();
  for (const r of reservations) {
    const item = invoice.items.find((i) => i.id === r.invoiceItemId)!;
    const lines = byWarehouse.get(r.warehouseId) || new Map<string, number>();
    lines.set(item.id, roundQty((lines.get(item.id) || 0) + reservationLeft(r) * lineFactor(item)));
    byWarehouse.set(r.warehouseId, lines);
  }
  const out = [];
  for (const [wh, lines] of byWarehouse) {
    const reqs = [...lines.entries()].map(([invoiceItemId, quantity]) => ({ invoiceItemId, quantity }));
    out.push(await fulfilInTx(tx, user, invoice, wh, reqs, meta));
  }
  return out;
}

/**
 * Branches and sellable warehouses a sale can be fulfilled from, plus free stock (base UoM,
 * net of reservations and expired/blocked lots) per product and warehouse.
 */
export async function fulfilmentOptions(user: AuthUser, productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, 200);
  const [branches, warehouses, products] = await Promise.all([
    prisma.branch.findMany({
      where: { businessId: user.businessId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' }
    }),
    prisma.warehouse.findMany({
      where: { businessId: user.businessId, isActive: true, branch: { isActive: true } },
      select: {
        id: true,
        name: true,
        code: true,
        category: true,
        branch: { select: { id: true, name: true, code: true } }
      },
      orderBy: { name: 'asc' }
    }),
    ids.length
      ? prisma.product.findMany({
          where: { businessId: user.businessId, id: { in: ids } },
          select: { id: true, variants: { select: { id: true } } }
        })
      : Promise.resolve([])
  ]);
  const variantOwner = new Map<string, string>();
  for (const p of products) for (const v of p.variants) variantOwner.set(v.id, p.id);
  const stock = await stockByWarehouse(prisma, user.businessId, [...variantOwner.keys()]);
  const availability: Record<string, Record<string, number>> = {};
  for (const [variantId, rows] of stock) {
    const productId = variantOwner.get(variantId)!;
    const byWh = (availability[productId] ||= {});
    for (const r of rows) byWh[r.warehouseId] = roundQty((byWh[r.warehouseId] || 0) + r.free);
  }
  return serialize({
    branches,
    warehouses: warehouses.filter(
      (w) => !['damaged', 'quarantine'].includes(String(w.category || '').toLowerCase())
    ),
    availability
  });
}

export async function authorisedWarehouseIds(user: AuthUser) {
  const branchIds = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  const rows = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, branchId: { in: branchIds } },
    select: { id: true }
  });
  return new Set(rows.map((w) => w.id));
}

/**
 * Pickup queue: reserved, uncollected quantities in warehouses of the user's branches, grouped by
 * invoice and warehouse. Shows only what the warehouse needs — no prices or customer balances beyond
 * payment status.
 */
export async function listPendingPickups(user: AuthUser, opts: { warehouseId?: string; q?: string } = {}) {
  const allowed = await authorisedWarehouseIds(user);
  if (opts.warehouseId && !allowed.has(opts.warehouseId)) {
    throw httpError(403, 'You do not have access to that warehouse');
  }
  const q = (opts.q || '').trim();
  const reservations = await prisma.salesReservation.findMany({
    where: {
      businessId: user.businessId,
      status: 'active',
      warehouseId: opts.warehouseId ? opts.warehouseId : { in: [...allowed] },
      invoiceItem: {
        invoice: {
          status: 'posted',
          ...(q
            ? {
                OR: [
                  { invoiceNumber: { contains: q } },
                  { customer: { name: { contains: q } } },
                  { customer: { phone: { contains: q } } }
                ]
              }
            : {})
        }
      }
    },
    include: {
      lot: { select: { batchNumber: true, expiryDate: true } },
      invoiceItem: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, name: true } },
          uom: { select: { id: true, code: true, name: true } },
          invoice: {
            include: {
              customer: { select: { id: true, name: true, code: true, phone: true } },
              branch: { select: { id: true, name: true, code: true } },
              sellingBranch: { select: { id: true, name: true, code: true } }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' },
    take: 2000
  });

  const warehouses = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, id: { in: [...allowed] } },
    include: { branch: { select: { id: true, name: true, code: true } } }
  });
  const whById = new Map(warehouses.map((w) => [w.id, w]));

  const groups = new Map<string, any>();
  for (const r of reservations) {
    const item = r.invoiceItem;
    const inv = item.invoice;
    const key = `${inv.id}:${r.warehouseId}`;
    let g = groups.get(key);
    if (!g) {
      const wh = whById.get(r.warehouseId);
      g = {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        paymentStatus: inv.paymentStatus,
        balance: inv.balance,
        amountDue: roundMoney(n(inv.totalAmount) - n(inv.cancelledAmount) - n(inv.amountPaid)),
        fulfilmentStatus: inv.fulfilmentStatus,
        fulfilmentMode: inv.fulfilmentMode,
        hasPickupCode: Boolean(inv.pickupCode),
        authorisedCollectors: Array.isArray(inv.authorisedCollectors) ? inv.authorisedCollectors : [],
        reservationExpiresAt: inv.reservationExpiresAt,
        customer: inv.customer,
        sellingBranch: inv.sellingBranch || inv.branch,
        revenueBranch: inv.branch,
        warehouse: wh ? { id: wh.id, name: wh.name, code: wh.code, branch: wh.branch } : { id: r.warehouseId },
        lines: new Map<string, any>()
      };
      groups.set(key, g);
    }
    const factor = lineFactor(item);
    let line = g.lines.get(item.id);
    if (!line) {
      line = {
        invoiceItemId: item.id,
        product: item.product,
        variant: item.variant,
        uom: item.uom,
        quantity: n(item.quantity),
        fulfilledQuantity: n(item.fulfilledQuantity),
        remaining: 0,
        lots: [] as { batchNumber: string; expiryDate: string | null; quantity: number }[]
      };
      g.lines.set(item.id, line);
    }
    const left = reservationLeft(r);
    line.remaining = roundQty(line.remaining + left * factor);
    line.lots.push({ batchNumber: r.lot.batchNumber, expiryDate: r.lot.expiryDate, quantity: roundQty(left * factor) });
  }

  const rows = [...groups.values()]
    .map((g) => ({ ...g, lines: [...g.lines.values()].filter((l: any) => l.remaining > EPS) }))
    .filter((g) => g.lines.length);
  return serialize({
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code, branch: w.branch })),
    rows
  });
}

/** Recent hand-overs (released or delivered) from warehouses in the user's branches. */
export async function listFulfilments(user: AuthUser, opts: { warehouseId?: string } = {}) {
  const allowed = await authorisedWarehouseIds(user);
  if (opts.warehouseId && !allowed.has(opts.warehouseId)) {
    throw httpError(403, 'You do not have access to that warehouse');
  }
  const rows = await prisma.salesFulfilment.findMany({
    where: {
      businessId: user.businessId,
      warehouseId: opts.warehouseId ? opts.warehouseId : { in: [...allowed] },
      status: { in: ['released', 'delivered'] }
    },
    include: {
      warehouse: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      invoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
      items: { select: { id: true, quantity: true } }
    },
    orderBy: { fulfilledAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}
