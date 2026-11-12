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
import { createNotification } from './notification.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  activeReservations,
  fulfilmentStatusOf,
  invoiceForFulfilment,
  lineFactor,
  lineValue,
  releaseReservations,
  reservationLeft,
  reserveInvoiceStock
} from './fulfilment.service.js';
import { lockInvoices, paymentStatusFor } from './customer-payment.service.js';
import { planAllocation, roundQty } from './stock-allocation.service.js';
import { getInvoice, reservationDays } from './sales.service.js';
import { cancelTasksInTx, openTaskIds } from './warehouse-fulfilment.service.js';
import { convertToBaseQty } from './inventory.service.js';
import { getCustomerExposure } from './customer.service.js';
import { userHasAnyPermission } from './permission.service.js';

const EPS = 1e-6;
const n = (v: unknown) => Number(v || 0);

/** Order staff act from the selling or the revenue branch. */
async function assertOrderBranch(user: AuthUser, inv: { branchId: string | null; sellingBranchId: string | null }) {
  const branches = [inv.sellingBranchId, inv.branchId].filter((b): b is string => Boolean(b));
  if (!branches.length || branchAccess.canAccessAllBranches(user)) return;
  const authorised = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  if (!branches.some((b) => authorised.includes(b))) {
    throw httpError(403, 'You must belong to the selling or revenue branch of this order');
  }
}

/**
 * Suggested split of draft lines across warehouses with free stock per warehouse (read-only).
 * Immediate (counter) sales only consider warehouses of the selling branch.
 */
export async function previewAllocation(user: AuthUser, body: Record<string, any>) {
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];
  if (!itemsInput.length) return serialize({ lines: [] });
  const immediate = !['pickup', 'delivery'].includes(String(body.fulfilment_mode || body.fulfilmentMode || 'immediate'));
  const sellingBranchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const products = await prisma.product.findMany({
    where: {
      businessId: user.businessId,
      id: { in: itemsInput.map((i) => i.product_id || i.productId).filter(Boolean) }
    },
    include: { variants: true }
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const inputs = itemsInput.map((item, idx) => {
    const product = byId.get(item.product_id || item.productId);
    if (!product) throw httpError(400, `items[${idx}] product not found`);
    const variantId =
      item.variant_id ||
      item.variantId ||
      (product.variants.find((v) => v.isDefault) || product.variants[0])?.id;
    if (!variantId) throw httpError(400, `${product.name} has no variants`);
    const manual = Array.isArray(item.allocations)
      ? item.allocations
          .map((a: any) => ({ warehouseId: String(a.warehouse_id || a.warehouseId || ''), quantity: Number(a.quantity) }))
          .filter((a: any) => a.warehouseId && a.quantity > 0)
      : null;
    return {
      key: String(item.key ?? idx),
      productId: product.id,
      variantId,
      uomId: item.uom_id || item.uomId || product.sellingUomId || product.baseUomId,
      baseUomId: product.baseUomId,
      productName: product.name,
      quantity: Number(item.quantity) || 0,
      preferredWarehouseId: item.warehouse_id || item.warehouseId || null,
      manual: manual?.length ? manual : null
    };
  });
  const plan = await planAllocation(
    prisma,
    user.businessId,
    inputs.filter((i) => i.quantity > 0),
    {
      defaultWarehouseId: body.warehouse_id || body.warehouseId || null,
      restrictToBranchId: immediate ? sellingBranchId : null
    }
  );
  return serialize({
    lines: plan.map((p) => ({
      key: p.key,
      requested: p.requested,
      allocated: p.allocated,
      shortage: p.shortage,
      allocations: p.allocations.map((a) => {
        const s = p.stock.find((r) => r.warehouseId === a.warehouseId);
        return {
          warehouseId: a.warehouseId,
          warehouseName: s?.warehouseName,
          warehouseCode: s?.warehouseCode,
          branchId: a.branchId,
          branchName: s?.branchName,
          quantity: a.quantity,
          method: a.method
        };
      }),
      stock: p.stock.map((s) => ({ ...s, free: roundQty(s.free * p.factor), onHand: roundQty(s.onHand * p.factor) }))
    }))
  });
}

type CancelLine = { invoiceItemId: string; quantity: number };

/**
 * Cancel an order, or the unfulfilled balance of some lines. Releases their reservations and credit
 * exposure; a deposit no longer covered by open order value first settles any recognised balance,
 * then becomes unapplied customer credit (refundable or usable on other invoices).
 */
export async function cancelOrder(user: AuthUser, id: string, body: Record<string, any>) {
  const reason = requireString(body.reason, 'reason');
  const linesInput: any[] = Array.isArray(body.lines) ? body.lines : [];

  const header = await prisma.salesInvoice.findFirst({ where: { id, businessId: user.businessId } });
  if (!header) throw httpError(404, 'Invoice not found');
  await assertOrderBranch(user, header);

  if (header.status === 'draft') {
    if (linesInput.length) throw httpError(400, 'Delete lines from a draft by editing it instead');
    await prisma.salesInvoice.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason }
    });
    await writeAudit({
      user,
      action: 'cancel',
      module: 'sales',
      entityType: 'SalesInvoice',
      entityId: id,
      summary: `Cancelled draft ${header.invoiceNumber}: ${reason}`
    });
    return getInvoice(user, id);
  }
  if (header.status !== 'posted') throw httpError(400, 'Only draft or confirmed orders can be cancelled');
  if (header.recognitionPolicy !== 'at_fulfilment') {
    throw httpError(
      400,
      'This invoice was booked under the old posting rules (revenue at posting). Reverse it with a credit note instead.'
    );
  }

  const cancelId = shortId('scx');

  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockInvoices(tx, [id]);
      const invoice = (await invoiceForFulfilment(tx, user.businessId, id))!;
      const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id } });
      const requests: CancelLine[] = linesInput.length
        ? linesInput.map((l, i) => {
            const invoiceItemId = l.invoice_item_id || l.invoiceItemId;
            const quantity = Number(l.quantity);
            if (!invoiceItemId || !(quantity > 0)) {
              throw httpError(400, `lines[${i}] requires invoice_item_id and a quantity > 0`);
            }
            return { invoiceItemId, quantity };
          })
        : invoice.items.map((it) => ({
            invoiceItemId: it.id,
            quantity: roundQty(n(it.quantity) - n(it.fulfilledQuantity) - n(it.cancelledQuantity))
          }));

      const affected = new Set(requests.filter((r) => r.quantity > EPS).map((r) => r.invoiceItemId));
      const openTasks = await openTaskIds(tx, id, undefined, [...affected]);
      if (openTasks.some((t) => t.status === 'dispatched')) {
        throw httpError(400, 'Goods on this order are out for delivery; confirm or return the delivery before cancelling');
      }
      await cancelTasksInTx(tx, user.id, openTasks.map((t) => t.id), `Order cancelled: ${reason}`);

      const reservations = await activeReservations(tx, invoice.items.map((i) => i.id));
      let cancelledLines = 0;
      for (const req of requests) {
        const line = invoice.items.find((i) => i.id === req.invoiceItemId);
        if (!line) throw httpError(400, `Line ${req.invoiceItemId} is not on this order`);
        const open = roundQty(n(line.quantity) - n(line.fulfilledQuantity) - n(line.cancelledQuantity));
        const qty = roundQty(req.quantity);
        if (qty <= EPS) continue;
        if (qty > open + EPS) {
          throw httpError(400, `Cannot cancel ${qty}; only ${open} not yet handed over on this line`);
        }
        const lineRes = reservations.filter((r) => r.invoiceItemId === line.id);
        const reservedLine = roundQty(lineRes.reduce((s, r) => s + reservationLeft(r), 0) * lineFactor(line));
        const unreserved = roundQty(open - reservedLine);
        // Backordered (unreserved) quantity is cancelled first; only the rest frees reserved stock.
        const fromReserved = Math.max(0, roundQty(qty - unreserved));
        if (fromReserved > EPS) {
          await releaseReservations(tx, user.id, lineRes, 'cancelled', roundQty(fromReserved / lineFactor(line)));
        }
        const cancelled = roundQty(n(line.cancelledQuantity) + qty);
        await tx.salesInvoiceItem.update({
          where: { id: line.id },
          data: { cancelledQuantity: toDec(cancelled) }
        });
        line.cancelledQuantity = toDec(cancelled);
        cancelledLines += 1;
      }
      if (!cancelledLines) throw httpError(400, 'Nothing left to cancel on this order');

      const cancelledAmount = roundMoney(
        invoice.items.reduce(
          (s, it) => s + (lineValue(invoice, it) * n(it.cancelledQuantity)) / n(it.quantity),
          0
        )
      );
      const openValue = Math.max(0, roundMoney(n(inv.totalAmount) - cancelledAmount - n(inv.recognisedAmount)));
      let depositHeld = n(inv.depositHeld);
      let balance = n(inv.balance);
      let amountPaid = n(inv.amountPaid);
      const excess = roundMoney(depositHeld - openValue);
      let appliedToBalance = 0;
      let released = 0;
      if (excess > 0.009) {
        // Prepaid already credits customer AR. Cancel only adjusts invoice memos; surplus stays on AR.
        appliedToBalance = roundMoney(Math.min(excess, balance));
        released = roundMoney(excess - appliedToBalance);
        depositHeld = roundMoney(depositHeld - excess);
        balance = roundMoney(balance - appliedToBalance);
        amountPaid = roundMoney(amountPaid - released);

        let toRelease = released;
        const allocs = await tx.customerPaymentAllocation.findMany({
          where: { invoiceId: id, depositAmount: { gt: 0 } },
          orderBy: { createdAt: 'desc' }
        });
        for (const a of allocs) {
          if (toRelease <= 0.009) break;
          const room = roundMoney(n(a.depositAmount) - n(a.releasedAmount));
          const take = roundMoney(Math.min(room, toRelease));
          if (take <= 0) continue;
          await tx.customerPaymentAllocation.update({
            where: { id: a.id },
            data: { releasedAmount: toDec(roundMoney(n(a.releasedAmount) + take)) }
          });
          await tx.customerPayment.update({
            where: { id: a.paymentId },
            data: { unappliedAmount: { increment: toDec(take) } }
          });
          toRelease = roundMoney(toRelease - take);
        }
      }

      const items = await tx.salesInvoiceItem.findMany({ where: { invoiceId: id } });
      const nothingHandedOver = items.every((i) => n(i.fulfilledQuantity) <= EPS);
      const allCancelled = items.every((i) => n(i.cancelledQuantity) >= n(i.quantity) - EPS);
      const fullCancel = nothingHandedOver && allCancelled;
      const status = fulfilmentStatusOf(items);
      await tx.salesInvoice.update({
        where: { id },
        data: {
          cancelledAmount: toDec(cancelledAmount),
          depositHeld: toDec(depositHeld),
          balance: toDec(balance),
          amountPaid: toDec(amountPaid),
          paymentStatus: fullCancel && amountPaid <= 0.009 ? 'void' : paymentStatusFor({ totalAmount: inv.totalAmount, cancelledAmount }, amountPaid),
          fulfilmentStatus: status,
          ...(fullCancel ? { status: 'cancelled' } : {}),
          ...(status === 'fulfilled' || fullCancel
            ? { reservationExpiresAt: null }
            : {}),
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancelReason: reason
        }
      });
      if (fullCancel) {
        await tx.salesCommission.updateMany({ where: { invoiceId: id, status: 'accrued' }, data: { status: 'void' } });
      }
      return { fullCancel, cancelledAmount, released, appliedToBalance };
    },
    { timeout: 30000, maxWait: 10000 }
  );

  await writeAudit({
    user,
    action: 'cancel',
    module: 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary:
      `${outcome.fullCancel ? 'Cancelled' : 'Closed short'} ${header.invoiceNumber}: ${reason}` +
      (outcome.released > 0 ? ` — ${outcome.released} moved to customer credit` : '')
  });
  return getInvoice(user, id);
}

/**
 * Move open reservations of a line (or the whole order) away from a warehouse — e.g. stock found
 * damaged or the customer wants another location. Requires fulfilment.reallocate and a reason.
 */
export async function reallocateOrder(user: AuthUser, id: string, body: Record<string, any>) {
  const reason = requireString(body.reason, 'reason');
  const fromWarehouseId = requireString(body.from_warehouse_id || body.fromWarehouseId, 'from_warehouse_id');
  const toWarehouseId = body.to_warehouse_id || body.toWarehouseId || null;
  const itemId = body.invoice_item_id || body.invoiceItemId || null;
  const allowBackorder = body.allow_backorder === true || body.allowBackorder === true;

  const header = await prisma.salesInvoice.findFirst({ where: { id, businessId: user.businessId } });
  if (!header) throw httpError(404, 'Invoice not found');
  await assertOrderBranch(user, header);
  if (header.status !== 'posted' || header.fulfilmentMode === 'immediate') {
    throw httpError(400, 'Only confirmed pickup or delivery orders can be reallocated');
  }
  if (toWarehouseId && toWarehouseId === fromWarehouseId) {
    throw httpError(400, 'Choose a different destination warehouse');
  }

  await prisma.$transaction(
    async (tx) => {
      await lockInvoices(tx, [id]);
      const invoice = (await invoiceForFulfilment(tx, user.businessId, id))!;
      const tasks = await openTaskIds(tx, id, fromWarehouseId, itemId ? [itemId] : undefined);
      if (tasks.some((t) => t.status === 'dispatched')) {
        throw httpError(400, 'Goods from that warehouse are out for delivery and cannot be reallocated');
      }
      await cancelTasksInTx(tx, user.id, tasks.map((t) => t.id), `Reallocated: ${reason}`);
      const targets = invoice.items.filter((i) => !itemId || i.id === itemId);
      if (!targets.length) throw httpError(400, 'Line not found on this order');
      const reservations = (await activeReservations(tx, targets.map((t) => t.id))).filter(
        (r) => r.warehouseId === fromWarehouseId
      );
      if (!reservations.length) throw httpError(400, 'Nothing is reserved in that warehouse for this order');

      const moved = new Map<string, number>();
      for (const t of targets) {
        const mine = reservations.filter((r) => r.invoiceItemId === t.id);
        if (!mine.length) continue;
        const base = await releaseReservations(tx, user.id, mine, 'reallocated');
        moved.set(t.id, roundQty(base * lineFactor(t)));
      }
      await reserveInvoiceStock(tx, user, invoice, {
        onlyItemIds: [...moved.keys()],
        quantities: moved,
        excludeWarehouseIds: [fromWarehouseId],
        manual: toWarehouseId
          ? new Map([...moved.entries()].map(([k, q]) => [k, [{ warehouseId: toWarehouseId, quantity: q }]]))
          : undefined,
        allowBackorder,
        method: 'reallocation'
      });
    },
    { timeout: 30000, maxWait: 10000 }
  );

  await writeAudit({
    user,
    action: 'reallocate',
    module: 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary: `Reallocated ${header.invoiceNumber} away from warehouse ${fromWarehouseId}${toWarehouseId ? ` to ${toWarehouseId}` : ''}: ${reason}`
  });
  return getInvoice(user, id);
}

/** Reserve whatever stock is now free for backordered (unreserved) quantities. */
export async function allocateBackorders(user: AuthUser, id: string) {
  const header = await prisma.salesInvoice.findFirst({ where: { id, businessId: user.businessId } });
  if (!header) throw httpError(404, 'Invoice not found');
  await assertOrderBranch(user, header);
  if (header.status !== 'posted' || header.fulfilmentMode === 'immediate') {
    throw httpError(400, 'Only confirmed pickup or delivery orders have backorders');
  }
  const days = header.fulfilmentMode === 'pickup' ? await reservationDays(user.businessId) : 0;
  const plan = await prisma.$transaction(
    async (tx) => {
      await lockInvoices(tx, [id]);
      const invoice = (await invoiceForFulfilment(tx, user.businessId, id))!;
      const result = await reserveInvoiceStock(tx, user, invoice, { allowBackorder: true, method: 'backorder' });
      if (result.some((r) => r.allocated > EPS) && days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        await tx.salesInvoice.update({ where: { id }, data: { reservationExpiresAt: d } });
      }
      return result;
    },
    { timeout: 30000, maxWait: 10000 }
  );
  const allocated = plan.reduce((s, p) => s + p.allocated, 0);
  if (allocated <= EPS) throw httpError(400, 'No free stock is available for the backordered quantities yet');
  await writeAudit({
    user,
    action: 'allocate',
    module: 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary: `Allocated backordered stock on ${header.invoiceNumber}`
  });
  return getInvoice(user, id);
}

/**
 * Release reservations of pickup orders past their hold date. The order stays confirmed with the
 * quantities backordered; the person who confirmed it is notified.
 */
export async function expireReservations(opts: { businessId?: string; now?: Date } = {}) {
  const now = opts.now || new Date();
  const due = await prisma.salesInvoice.findMany({
    where: {
      ...(opts.businessId ? { businessId: opts.businessId } : {}),
      status: 'posted',
      fulfilmentMode: 'pickup',
      reservationExpiresAt: { lt: now },
      fulfilmentStatus: { not: 'fulfilled' }
    },
    select: { id: true, businessId: true, invoiceNumber: true, postedById: true, createdById: true },
    take: 200
  });
  let expired = 0;
  for (const inv of due) {
    const released = await prisma.$transaction(
      async (tx) => {
        await lockInvoices(tx, [inv.id]);
        const fresh = await tx.salesInvoice.findUnique({ where: { id: inv.id } });
        if (!fresh?.reservationExpiresAt || fresh.reservationExpiresAt >= now || fresh.status !== 'posted') return 0;
        const tasks = await openTaskIds(tx, inv.id);
        if (tasks.some((t) => t.status === 'dispatched')) return 0;
        await cancelTasksInTx(tx, null, tasks.map((t) => t.id), 'Reservation expired');
        const items = await tx.salesInvoiceItem.findMany({ where: { invoiceId: inv.id }, select: { id: true } });
        const reservations = await activeReservations(tx, items.map((i) => i.id));
        const base = await releaseReservations(tx, null, reservations, 'expired');
        await tx.salesInvoice.update({ where: { id: inv.id }, data: { reservationExpiresAt: null } });
        return base;
      },
      { timeout: 30000, maxWait: 10000 }
    );
    if (released > EPS) {
      expired += 1;
      const userId = inv.postedById || inv.createdById;
      await createNotification({
        businessId: inv.businessId,
        userId,
        title: `Reservation expired — ${inv.invoiceNumber}`,
        body: 'The goods held for this pickup order were released back to stock. Allocate again when the customer is ready to collect.',
        module: 'sales',
        entityType: 'SalesInvoice',
        entityId: inv.id
      }).catch(() => undefined);
    }
  }
  return { checked: due.length, expired };
}

export async function runExpiry(user: AuthUser) {
  const result = await expireReservations({ businessId: user.businessId });
  await writeAudit({
    user,
    action: 'expire',
    module: 'sales',
    entityType: 'SalesReservation',
    entityId: user.businessId,
    summary: `Reservation expiry run: ${result.expired} order(s) released`
  });
  return result;
}

type AmendChange = {
  field: string;
  invoice_item_id?: string;
  from: unknown;
  to: unknown;
};

/**
 * Controlled amendment of a confirmed (at_fulfilment) order.
 * - Quantity down → cancels the unfulfilled difference (preserves original ordered qty).
 * - Quantity up → raises line/order totals, credit-checks, reserves the extra.
 * - Warehouse / allocations → reallocate path.
 * - Notes / delivery fields → header updates only.
 * Already handed-over quantities cannot be changed (use a return).
 */
export async function amendOrder(user: AuthUser, id: string, body: Record<string, any>) {
  const reason = requireString(body.reason, 'reason');
  const linesInput: any[] = Array.isArray(body.lines) ? body.lines : [];
  const allowBackorder = body.allow_backorder === true || body.allowBackorder === true;
  const wantsOverride = body.override_credit === true || body.overrideCredit === true;
  const overrideReason = String(body.override_reason || body.overrideReason || '').trim();

  const header = await prisma.salesInvoice.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true, customer: true }
  });
  if (!header) throw httpError(404, 'Invoice not found');
  await assertOrderBranch(user, header);
  if (header.status !== 'posted') throw httpError(400, 'Only confirmed orders can be amended');
  if (header.recognitionPolicy !== 'at_fulfilment') {
    throw httpError(400, 'Legacy on_posting invoices cannot be amended; use a credit note / return');
  }
  if (header.fulfilmentMode === 'immediate' && header.fulfilmentStatus === 'fulfilled') {
    throw httpError(400, 'Fully handed-over counter sales cannot be amended; use a return');
  }

  const changes: AmendChange[] = [];
  const decreases: { invoice_item_id: string; quantity: number }[] = [];
  const increases: {
    invoiceItemId: string;
    newQty: number;
    addQty: number;
    warehouseId?: string | null;
    allocations?: { warehouse_id: string; quantity: number }[] | null;
  }[] = [];

  for (const [i, raw] of linesInput.entries()) {
    const invoiceItemId = raw.invoice_item_id || raw.invoiceItemId;
    if (!invoiceItemId) throw httpError(400, `lines[${i}].invoice_item_id is required`);
    const line = header.items.find((it) => it.id === invoiceItemId);
    if (!line) throw httpError(400, `Line ${invoiceItemId} is not on this order`);

    const hasQty = raw.quantity != null || raw.new_quantity != null || raw.newQuantity != null;
    if (hasQty) {
      const newQty = roundQty(Number(raw.quantity ?? raw.new_quantity ?? raw.newQuantity));
      const minQty = roundQty(n(line.fulfilledQuantity));
      if (newQty + EPS < minQty) {
        throw httpError(
          400,
          `Cannot reduce below ${minQty} already handed over on this line — return goods instead`
        );
      }
      const effectiveOrdered = roundQty(n(line.quantity) - n(line.cancelledQuantity));
      if (newQty + EPS < effectiveOrdered) {
        const cut = roundQty(effectiveOrdered - newQty);
        decreases.push({ invoice_item_id: line.id, quantity: cut });
        changes.push({
          field: 'quantity',
          invoice_item_id: line.id,
          from: effectiveOrdered,
          to: newQty
        });
      } else if (newQty > effectiveOrdered + EPS) {
        const addQty = roundQty(newQty - effectiveOrdered);
        increases.push({
          invoiceItemId: line.id,
          newQty,
          addQty,
          warehouseId: raw.warehouse_id || raw.warehouseId || null,
          allocations: Array.isArray(raw.allocations) ? raw.allocations : null
        });
        changes.push({
          field: 'quantity',
          invoice_item_id: line.id,
          from: effectiveOrdered,
          to: newQty
        });
      }
    }

    const toWh = raw.to_warehouse_id || raw.toWarehouseId || raw.warehouse_id || raw.warehouseId;
    const fromWh = raw.from_warehouse_id || raw.fromWarehouseId;
    if (toWh && fromWh && String(toWh) !== String(fromWh)) {
      await reallocateOrder(user, id, {
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        invoice_item_id: line.id,
        reason: `Amendment: ${reason}`,
        allow_backorder: allowBackorder
      });
      changes.push({
        field: 'warehouse',
        invoice_item_id: line.id,
        from: fromWh,
        to: toWh
      });
    }
  }

  if (decreases.length) {
    await cancelOrder(user, id, {
      reason: `Amendment: ${reason}`,
      lines: decreases
    });
  }

  if (increases.length) {
    await prisma.$transaction(
      async (tx) => {
        await lockInvoices(tx, [id]);
        let invoice = (await invoiceForFulfilment(tx, user.businessId, id))!;
        const inv = await tx.salesInvoice.findUniqueOrThrow({
          where: { id },
          include: { customer: true }
        });

        let subtotal = n(inv.subtotal);
        for (const inc of increases) {
          const line = invoice.items.find((i) => i.id === inc.invoiceItemId)!;
          const oldQty = n(line.quantity);
          const unit = n(line.unitPrice);
          const newLineTotal = roundMoney(unit * inc.newQty);
          const oldLineTotal = n(line.lineTotal);
          subtotal = roundMoney(subtotal - oldLineTotal + newLineTotal);
          const product = await tx.product.findFirst({
            where: { id: line.productId },
            select: { baseUomId: true }
          });
          const baseQuantity = roundQty(
            await convertToBaseQty(tx, line.productId, line.uomId, inc.newQty, product?.baseUomId)
          );
          const plan =
            inc.allocations?.map((a) => ({
              warehouse_id: a.warehouse_id || (a as any).warehouseId,
              quantity: Number(a.quantity)
            })) || null;
          await tx.salesInvoiceItem.update({
            where: { id: line.id },
            data: {
              quantity: toDec(inc.newQty),
              lineTotal: toDec(newLineTotal),
              baseQuantity: toDec(baseQuantity),
              ...(inc.warehouseId ? { fulfilmentWarehouseId: inc.warehouseId } : {}),
              ...(plan ? { allocationPlan: plan } : {})
            }
          });
          line.quantity = toDec(inc.newQty) as any;
          line.lineTotal = toDec(newLineTotal) as any;
          line.baseQuantity = toDec(baseQuantity) as any;
        }

        const discountPct = n(inv.discountPercent);
        const discountAmount =
          discountPct > 0 ? roundMoney((subtotal * discountPct) / 100) : n(inv.discountAmount);
        const taxAmount =
          n(inv.subtotal) > 0
            ? roundMoney((n(inv.taxAmount) * subtotal) / n(inv.subtotal))
            : n(inv.taxAmount);
        const totalAmount = roundMoney(subtotal - discountAmount + taxAmount);

        // Credit check on the incremental open-order value
        const extraCredit = roundMoney(totalAmount - n(inv.totalAmount));
        if (extraCredit > 0.009 && inv.customer.creditLimit != null) {
          const limit = Number(inv.customer.creditLimit);
          const exposure = await getCustomerExposure(tx, user.businessId, inv.customerId, inv.id);
          const openThis = Math.max(
            0,
            roundMoney(totalAmount - n(inv.cancelledAmount) - n(inv.recognisedAmount) - n(inv.depositHeld))
          );
          if (roundMoney(exposure.receivable + openThis) > limit + 0.009) {
            if (!wantsOverride) {
              throw httpError(
                400,
                `Credit limit exceeded after amendment for ${inv.customer.name}. Collect a deposit or ask a manager to override.`
              );
            }
            if (!(await userHasAnyPermission(user.id, ['sales.override_credit_limit']))) {
              throw httpError(403, 'You do not have permission to override credit limits');
            }
            if (!overrideReason) throw httpError(400, 'override_reason is required to override the credit limit');
            await tx.salesInvoice.update({
              where: { id },
              data: {
                creditOverrideById: user.id,
                creditOverrideReason: overrideReason
              }
            });
          }
        }

        await tx.salesInvoice.update({
          where: { id },
          data: {
            subtotal: toDec(subtotal),
            discountAmount: toDec(discountAmount),
            taxAmount: toDec(taxAmount),
            totalAmount: toDec(totalAmount),
            paymentStatus: paymentStatusFor(
              { totalAmount, cancelledAmount: inv.cancelledAmount },
              n(inv.amountPaid)
            )
          }
        });

        invoice = (await invoiceForFulfilment(tx, user.businessId, id))!;
        // Cancel open pick tasks for increased lines so they can be re-picked with the new qty
        const openTasks = await openTaskIds(
          tx,
          id,
          undefined,
          increases.map((i) => i.invoiceItemId)
        );
        if (openTasks.some((t) => t.status === 'dispatched')) {
          throw httpError(400, 'Cannot increase quantity while goods are out for delivery');
        }
        await cancelTasksInTx(tx, user.id, openTasks.map((t) => t.id), `Amended: ${reason}`);

        const quantities = new Map(increases.map((i) => [i.invoiceItemId, i.addQty]));
        const manual = new Map<string, { warehouseId: string; quantity: number }[]>();
        for (const inc of increases) {
          if (inc.allocations?.length) {
            manual.set(
              inc.invoiceItemId,
              inc.allocations.map((a) => ({
                warehouseId: a.warehouse_id || (a as any).warehouseId,
                quantity: Number(a.quantity)
              }))
            );
          }
        }
        await reserveInvoiceStock(tx, user, invoice, {
          allowBackorder: allowBackorder || invoice.fulfilmentMode !== 'immediate',
          restrictToBranchId:
            invoice.fulfilmentMode === 'immediate' ? invoice.sellingBranchId || invoice.branchId : null,
          onlyItemIds: increases.map((i) => i.invoiceItemId),
          quantities,
          ...(manual.size ? { manual, method: 'manual' as const } : {})
        });
      },
      { timeout: 30000, maxWait: 10000 }
    );
  }

  const headerUpdates: Record<string, unknown> = {};
  if (body.notes != null && String(body.notes) !== String(header.notes || '')) {
    changes.push({ field: 'notes', from: header.notes, to: body.notes });
    headerUpdates.notes = String(body.notes);
  }
  for (const [key, col] of [
    ['delivery_address', 'deliveryAddress'],
    ['delivery_contact', 'deliveryContact'],
    ['delivery_phone', 'deliveryPhone']
  ] as const) {
    if (body[key] != null || body[col] != null) {
      const next = String(body[key] ?? body[col] ?? '');
      const prev = String((header as any)[col] || '');
      if (next !== prev) {
        changes.push({ field: key, from: prev || null, to: next || null });
        headerUpdates[col] = next || null;
      }
    }
  }
  if (Object.keys(headerUpdates).length) {
    await prisma.salesInvoice.update({ where: { id }, data: headerUpdates });
  }

  if (!changes.length) throw httpError(400, 'No changes to apply');

  const amendmentNumber = await nextDocNumber(
    prisma.salesOrderAmendment,
    user.businessId,
    'amendmentNumber',
    'AMD',
    5
  );
  await prisma.salesOrderAmendment.create({
    data: {
      id: shortId('amd'),
      businessId: user.businessId,
      invoiceId: id,
      amendmentNumber,
      reason,
      changes,
      createdById: user.id
    }
  });

  await writeAudit({
    user,
    action: 'amend',
    module: 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary: `Amended ${header.invoiceNumber} (${amendmentNumber}): ${reason}`,
    metadata: { changes }
  });

  return getInvoice(user, id);
}
