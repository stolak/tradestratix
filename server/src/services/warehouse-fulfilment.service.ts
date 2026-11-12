import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createNotification } from './notification.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  activeReservations,
  authorisedWarehouseIds,
  fulfilInTx,
  invoiceForFulfilment,
  lineFactor,
  listPendingPickups,
  releaseReservations,
  reservationLeft,
  type FulfilMeta,
  type FulfilRequest
} from './fulfilment.service.js';
import { lockInvoices } from './customer-payment.service.js';
import { roundQty } from './stock-allocation.service.js';
import { verifyCollection } from './pickup-code.service.js';

type Tx = Prisma.TransactionClient;

const EPS = 1e-6;
const n = (v: unknown) => Number(v || 0);
const TX_OPTS = { timeout: 30000, maxWait: 10000 };

/** Fulfilment records still holding work (goods being picked, waiting on a shelf or on a vehicle). */
export const OPEN_TASK_STATUSES = ['picking', 'ready_for_collection', 'picked', 'dispatched'];
export const NOTIFICATIONS_SETTING = 'sales.fulfilment_notifications';

// ─── helpers ────────────────────────────────────────────────────────────────

async function assertWarehouseStaff(user: AuthUser, warehouseId: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId: user.businessId },
    include: { branch: { select: { id: true, name: true } } }
  });
  if (!warehouse) throw httpError(400, 'Invalid warehouse');
  await branchAccess.assertBranchMembership(user, warehouse.branchId);
  await branchAccess.assertBranchActive(user.businessId, warehouse.branchId);
  return warehouse;
}

/** Quantity (line UoM) per invoice line already claimed by open fulfilment records in a warehouse. */
export async function openTaskQuantities(
  client: Tx | typeof prisma,
  invoiceId: string,
  warehouseId: string,
  excludeId?: string
) {
  const tasks = await client.salesFulfilment.findMany({
    where: {
      invoiceId,
      warehouseId,
      status: { in: OPEN_TASK_STATUSES },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    include: { items: true }
  });
  const out = new Map<string, number>();
  for (const t of tasks) {
    for (const i of t.items) {
      const q = t.status === 'picking' ? n(i.plannedQuantity) : n(i.pickedQuantity) - n(i.quantity);
      out.set(i.invoiceItemId, roundQty((out.get(i.invoiceItemId) || 0) + Math.max(0, q)));
    }
  }
  return out;
}

/** Reserved, unclaimed quantity per line in a warehouse (line UoM). */
async function unclaimedReserved(tx: Tx, invoice: NonNullable<Awaited<ReturnType<typeof invoiceForFulfilment>>>, warehouseId: string) {
  const reservations = (await activeReservations(tx, invoice.items.map((i) => i.id))).filter(
    (r) => r.warehouseId === warehouseId
  );
  const claimed = await openTaskQuantities(tx, invoice.id, warehouseId);
  const out = new Map<string, { reserved: number; free: number }>();
  for (const item of invoice.items) {
    const reserved = roundQty(
      reservations.filter((r) => r.invoiceItemId === item.id).reduce((s, r) => s + reservationLeft(r), 0) *
        lineFactor(item)
    );
    if (reserved <= EPS) continue;
    out.set(item.id, { reserved, free: Math.max(0, roundQty(reserved - (claimed.get(item.id) || 0))) });
  }
  return out;
}

async function notificationsEnabled(businessId: string, event: string) {
  const row = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey: NOTIFICATIONS_SETTING } }
  });
  if (!row?.value) return true;
  const v = String(row.value).toLowerCase();
  if (['off', 'false', 'none'].includes(v)) return false;
  try {
    const parsed = JSON.parse(String(row.value));
    if (Array.isArray(parsed?.disabled)) return !parsed.disabled.includes(event);
  } catch {
    /* plain value */
  }
  return true;
}

/** Tell the people who own the order (who confirmed it, who created it). */
export async function notifyOrder(
  inv: { id: string; businessId: string; postedById: string | null; createdById: string | null },
  event: string,
  title: string,
  body: string
) {
  if (!(await notificationsEnabled(inv.businessId, event))) return;
  const users = [...new Set([inv.postedById, inv.createdById].filter((u): u is string => Boolean(u)))];
  for (const userId of users) {
    await createNotification({
      businessId: inv.businessId,
      userId,
      title,
      body,
      module: 'sales',
      entityType: 'SalesInvoice',
      entityId: inv.id
    }).catch(() => undefined);
  }
}

const taskInclude = {
  warehouse: { select: { id: true, name: true, code: true, branchId: true, branch: { select: { id: true, name: true, code: true } } } },
  branch: { select: { id: true, name: true, code: true } },
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      fulfilmentMode: true,
      fulfilmentStatus: true,
      paymentStatus: true,
      totalAmount: true,
      cancelledAmount: true,
      amountPaid: true,
      reservationExpiresAt: true,
      pickupCode: true,
      authorisedCollectors: true,
      deliveryAddress: true,
      deliveryContact: true,
      deliveryPhone: true,
      customer: { select: { id: true, name: true, code: true, phone: true } },
      sellingBranch: { select: { id: true, name: true, code: true } }
    }
  },
  items: {
    include: {
      invoiceItem: {
        select: {
          id: true,
          quantity: true,
          fulfilledQuantity: true,
          baseQuantity: true,
          product: { select: { id: true, name: true, sku: true, barcode: true } },
          variant: { select: { id: true, name: true, sku: true } },
          uom: { select: { id: true, code: true, name: true } }
        }
      }
    },
    orderBy: { id: 'asc' as const }
  },
  deliveryOrder: {
    select: {
      id: true,
      deliveryNumber: true,
      status: true,
      scheduledDate: true,
      dispatchedAt: true,
      deliveredAt: true,
      driverName: true,
      receivedBy: true,
      podReference: true,
      vehicle: { select: { id: true, name: true, plateNumber: true } }
    }
  },
  verifications: { orderBy: { createdAt: 'desc' as const }, take: 20 }
};

/** Warehouse view of a fulfilment: picking list with lots; no prices or customer balances. */
export async function getTask(user: AuthUser, id: string) {
  const row = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId }, include: taskInclude });
  if (!row) throw httpError(404, 'Fulfilment not found');
  const allowed = await authorisedWarehouseIds(user);
  if (!allowed.has(row.warehouseId) && !branchAccess.canAccessAllBranches(user)) {
    throw httpError(403, 'You do not have access to that warehouse');
  }
  const reservations = await prisma.salesReservation.findMany({
    where: { invoiceItemId: { in: row.items.map((i) => i.invoiceItemId) }, warehouseId: row.warehouseId, status: 'active' },
    include: { lot: { select: { batchNumber: true, expiryDate: true } } },
    orderBy: { createdAt: 'asc' }
  });
  const { pickupCode, totalAmount, cancelledAmount, amountPaid, ...invoice } = row.invoice;
  return serialize({
    ...row,
    invoice: {
      ...invoice,
      hasPickupCode: Boolean(pickupCode),
      amountDue: roundMoney(n(totalAmount) - n(cancelledAmount) - n(amountPaid))
    },
    items: row.items.map((i) => {
      const factor = lineFactor(i.invoiceItem);
      return {
        ...i,
        lots: reservations
          .filter((r) => r.invoiceItemId === i.invoiceItemId)
          .map((r) => ({
            lotId: r.lotId,
            batchNumber: r.lot.batchNumber,
            expiryDate: r.lot.expiryDate,
            quantity: roundQty(reservationLeft(r) * factor)
          }))
      };
    })
  });
}

async function loadOpenTask(tx: Tx, user: AuthUser, id: string) {
  const task = await tx.salesFulfilment.findFirst({ where: { id, businessId: user.businessId }, include: { items: true } });
  if (!task) throw httpError(404, 'Fulfilment not found');
  return task;
}

// ─── picking ────────────────────────────────────────────────────────────────

/** Open a picking list for everything reserved (and not already being handled) in one warehouse. */
export async function startPicking(user: AuthUser, body: Record<string, any>) {
  const invoiceId = requireString(body.invoice_id || body.invoiceId, 'invoice_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const warehouse = await assertWarehouseStaff(user, warehouseId);

  const taskId = await prisma.$transaction(async (tx) => {
    await lockInvoices(tx, [invoiceId]);
    const invoice = await invoiceForFulfilment(tx, user.businessId, invoiceId);
    if (!invoice) throw httpError(404, 'Invoice not found');
    if (invoice.status !== 'posted') throw httpError(400, 'Only confirmed orders can be picked');
    if (invoice.fulfilmentMode === 'immediate') throw httpError(400, 'Counter sales are handed over at the point of sale');
    const free = await unclaimedReserved(tx, invoice, warehouse.id);
    const lines = [...free.entries()].filter(([, v]) => v.free > EPS);
    if (!lines.length) throw httpError(400, 'Nothing reserved in this warehouse is waiting to be picked for this order');

    const id = shortId('ful');
    await tx.salesFulfilment.create({
      data: {
        id,
        businessId: user.businessId,
        fulfilmentNumber: await nextDocNumber(tx.salesFulfilment, user.businessId, 'fulfilmentNumber', 'FUL', 5),
        invoiceId,
        warehouseId: warehouse.id,
        branchId: warehouse.branchId,
        fulfilmentType: invoice.fulfilmentMode === 'delivery' ? 'delivery' : 'pickup',
        status: 'picking',
        pickerId: body.picker_id || body.pickerId || user.id,
        pickStartedAt: new Date(),
        fulfilledAt: null,
        notes: body.notes || null,
        items: {
          create: lines.map(([invoiceItemId, v]) => ({
            id: shortId('sfi'),
            invoiceItemId,
            plannedQuantity: toDec(v.free),
            quantity: toDec(0),
            baseQuantity: toDec(0)
          }))
        }
      }
    });
    return id;
  }, TX_OPTS);

  const task = await prisma.salesFulfilment.findUniqueOrThrow({ where: { id: taskId } });
  await writeAudit({
    user,
    action: 'pick_start',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: taskId,
    summary: `Started picking ${task.fulfilmentNumber} in ${warehouse.name}`
  });
  return getTask(user, taskId);
}

/**
 * Record what was actually picked. Quantity not found or found damaged is released from the
 * reservation as a discrepancy (the order keeps it open as a backorder for reallocation).
 * Pickup orders become ready for collection; delivery orders wait for dispatch.
 */
export async function confirmPicking(user: AuthUser, id: string, body: Record<string, any>) {
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];
  const head = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId } });
  if (!head) throw httpError(404, 'Fulfilment not found');
  const warehouse = await assertWarehouseStaff(user, head.warehouseId);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockInvoices(tx, [head.invoiceId]);
    const task = await loadOpenTask(tx, user, id);
    if (task.status !== 'picking') throw httpError(400, `${task.fulfilmentNumber} is not being picked (${task.status})`);
    const invoice = (await invoiceForFulfilment(tx, user.businessId, task.invoiceId))!;
    const reservations = (await activeReservations(tx, invoice.items.map((i) => i.id))).filter(
      (r) => r.warehouseId === task.warehouseId
    );
    const claimedElsewhere = await openTaskQuantities(tx, task.invoiceId, task.warehouseId, task.id);

    let totalPicked = 0;
    let totalShort = 0;
    const discrepancies: string[] = [];
    for (const item of task.items) {
      const line = invoice.items.find((i) => i.id === item.invoiceItemId)!;
      const input = itemsInput.find((x) => (x.invoice_item_id || x.invoiceItemId) === item.invoiceItemId);
      const lineRes = reservations.filter((r) => r.invoiceItemId === line.id);
      const factor = lineFactor(line);
      const reservedNow = roundQty(lineRes.reduce((s, r) => s + reservationLeft(r), 0) * factor);
      const planned = Math.min(n(item.plannedQuantity), Math.max(0, roundQty(reservedNow - (claimedElsewhere.get(line.id) || 0))));
      const picked = roundQty(input ? Number(input.picked_quantity ?? input.pickedQuantity ?? 0) : planned);
      const damaged = roundQty(input ? Number(input.damaged_quantity ?? input.damagedQuantity ?? 0) : 0);
      if (!Number.isFinite(picked) || picked < 0 || !Number.isFinite(damaged) || damaged < 0) {
        throw httpError(400, 'Picked and damaged quantities must be zero or more');
      }
      if (picked + damaged > planned + EPS) {
        throw httpError(400, `Picked + damaged (${roundQty(picked + damaged)}) exceeds the ${planned} to pick on a line`);
      }
      const short = Math.max(0, roundQty(planned - picked - damaged));
      const shortfall = roundQty(short + damaged);
      if (shortfall > EPS) {
        await releaseReservations(tx, user.id, lineRes, 'discrepancy', roundQty(shortfall / factor));
        discrepancies.push(`${short > EPS ? `${short} not found` : ''}${short > EPS && damaged > EPS ? ', ' : ''}${damaged > EPS ? `${damaged} damaged` : ''}`);
      }
      await tx.salesFulfilmentItem.update({
        where: { id: item.id },
        data: {
          plannedQuantity: toDec(planned),
          pickedQuantity: toDec(picked),
          shortQuantity: toDec(short),
          damagedQuantity: toDec(damaged),
          notes: input?.notes || item.notes || null
        }
      });
      totalPicked = roundQty(totalPicked + picked);
      totalShort = roundQty(totalShort + shortfall);
    }

    const isDelivery = task.fulfilmentType === 'delivery';
    const status = totalPicked <= EPS ? 'discrepancy' : isDelivery ? 'picked' : 'ready_for_collection';
    const discrepancyNotes = [body.discrepancy_notes || body.discrepancyNotes, discrepancies.length ? `Picking: ${discrepancies.join('; ')}` : null]
      .filter(Boolean)
      .join(' — ');
    await tx.salesFulfilment.update({
      where: { id },
      data: {
        status,
        pickedAt: new Date(),
        ...(status === 'ready_for_collection' ? { readyAt: new Date() } : {}),
        discrepancyNotes: discrepancyNotes || null,
        ...(body.notes ? { notes: body.notes } : {})
      }
    });

    let deliveryNumber: string | null = null;
    if (status === 'picked') {
      const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: task.invoiceId }, include: { customer: true } });
      deliveryNumber = await nextDocNumber(tx.deliveryOrder, user.businessId, 'deliveryNumber', 'DEL', 5);
      const picked = await tx.salesFulfilmentItem.findMany({ where: { fulfilmentId: id } });
      await tx.deliveryOrder.create({
        data: {
          id: shortId('del'),
          businessId: user.businessId,
          deliveryNumber,
          salesInvoiceId: task.invoiceId,
          customerId: inv.customerId,
          warehouseId: task.warehouseId,
          branchId: task.branchId,
          fulfilmentId: id,
          status: 'draft',
          addressLine1: inv.deliveryAddress || inv.customer.addressLine1,
          city: inv.deliveryAddress ? null : inv.customer.city,
          notes: [inv.deliveryContact, inv.deliveryPhone].filter(Boolean).join(' · ') || null,
          createdById: user.id,
          items: {
            create: picked
              .filter((p) => n(p.pickedQuantity) > EPS)
              .map((p) => {
                const line = invoice.items.find((i) => i.id === p.invoiceItemId)!;
                return {
                  id: shortId('dei'),
                  productId: line.productId,
                  variantId: line.variantId,
                  quantity: p.pickedQuantity
                };
              })
          }
        }
      });
    }
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: task.invoiceId } });
    return { task, status, totalPicked, totalShort, deliveryNumber, inv };
  }, TX_OPTS);

  await writeAudit({
    user,
    action: 'pick_confirm',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: id,
    summary:
      `Picked ${outcome.task.fulfilmentNumber} in ${warehouse.name}: ${outcome.totalPicked} picked` +
      (outcome.totalShort > EPS ? `, ${outcome.totalShort} discrepancy` : '') +
      (outcome.deliveryNumber ? ` → delivery ${outcome.deliveryNumber}` : '')
  });
  if (outcome.status === 'ready_for_collection') {
    await notifyOrder(outcome.inv, 'ready_for_collection', `Ready for collection — ${outcome.inv.invoiceNumber}`,
      `Goods are picked and waiting at ${warehouse.name} (${warehouse.branch.name}). The customer needs the pickup code to collect.`);
  }
  if (outcome.status === 'picked') {
    await notifyOrder(outcome.inv, 'awaiting_dispatch', `Picked for delivery — ${outcome.inv.invoiceNumber}`,
      `Delivery ${outcome.deliveryNumber} is ready to be dispatched from ${warehouse.name}.`);
  }
  if (outcome.totalShort > EPS) {
    await notifyOrder(outcome.inv, 'stock_shortage', `Picking shortage — ${outcome.inv.invoiceNumber}`,
      `${outcome.totalShort} could not be picked at ${warehouse.name} (missing or damaged). The quantity is now backordered: reallocate it or allocate backorders.`);
  }
  return getTask(user, id);
}

// ─── collection ─────────────────────────────────────────────────────────────

type ReleaseBody = Record<string, any>;

function collectionMeta(body: ReleaseBody, verification: string): FulfilMeta {
  return {
    collectedBy: body.collected_by || body.collectedBy || body.collector_name || null,
    collectorPhone: body.collector_phone || body.collectorPhone || null,
    collectorRelation: body.collector_relation || body.collectorRelation || 'customer',
    idType: body.id_type || body.idType || null,
    idReference: body.id_reference || body.idReference || null,
    verificationMethod: verification,
    acknowledged: body.acknowledged === true || String(body.acknowledged) === 'true',
    signatureName: body.signature_name || body.signatureName || null,
    proofReference: body.proof_reference || body.proofReference || null,
    notes: body.notes || null
  };
}

async function assertCollector(invoiceId: string, meta: FulfilMeta) {
  if (!meta.collectedBy) throw httpError(400, 'collected_by is required');
  if (!meta.acknowledged) throw httpError(400, 'The collector must acknowledge receipt (acknowledged: true)');
  if (!['customer', 'authorised', 'other'].includes(String(meta.collectorRelation))) {
    throw httpError(400, 'collector_relation must be customer, authorised or other');
  }
  if (meta.collectorRelation === 'authorised') {
    const inv = await prisma.salesInvoice.findUnique({ where: { id: invoiceId }, select: { authorisedCollectors: true } });
    const list = Array.isArray(inv?.authorisedCollectors) ? (inv!.authorisedCollectors as any[]) : [];
    const name = String(meta.collectedBy).trim().toLowerCase();
    if (!list.some((c) => String(c?.name || '').trim().toLowerCase() === name)) {
      throw httpError(400, `${meta.collectedBy} is not an authorised collector on this order`);
    }
  }
}

function parseRequests(body: ReleaseBody): FulfilRequest[] | null {
  if (!Array.isArray(body.items)) return null;
  return body.items.map((i: any, idx: number) => {
    const invoiceItemId = i.invoice_item_id || i.invoiceItemId;
    if (!invoiceItemId) throw httpError(400, `items[${idx}].invoice_item_id is required`);
    const quantity = Number(i.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw httpError(400, `items[${idx}].quantity is invalid`);
    return { invoiceItemId, quantity };
  });
}

/**
 * Hand picked goods to the customer or an authorised collector after verifying the pickup code.
 * Posts stock issue, revenue and COGS. A partial collection splits the rest into a new record that
 * stays ready for collection.
 */
export async function releaseTask(user: AuthUser, id: string, body: ReleaseBody) {
  const head = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId } });
  if (!head) throw httpError(404, 'Fulfilment not found');
  if (head.status !== 'ready_for_collection') {
    throw httpError(400, `${head.fulfilmentNumber} is not ready for collection (${head.status})`);
  }
  const warehouse = await assertWarehouseStaff(user, head.warehouseId);
  const verification = await verifyCollection(user, head.invoiceId, {
    pickupCode: body.pickup_code ?? body.pickupCode,
    overrideReason: body.override_reason ?? body.overrideReason,
    collectorName: body.collected_by || body.collectedBy,
    fulfilmentId: id
  });
  const meta = collectionMeta(body, verification);
  await assertCollector(head.invoiceId, meta);
  const explicit = parseRequests(body);

  const result = await prisma.$transaction(async (tx) => {
    await lockInvoices(tx, [head.invoiceId]);
    const task = await loadOpenTask(tx, user, id);
    if (task.status !== 'ready_for_collection') throw httpError(409, `${task.fulfilmentNumber} changed; reload and retry`);
    const invoice = (await invoiceForFulfilment(tx, user.businessId, task.invoiceId))!;
    if (invoice.status !== 'posted') throw httpError(400, 'This order is no longer open');

    const requests: FulfilRequest[] = [];
    for (const item of task.items) {
      const want = explicit
        ? explicit.find((r) => r.invoiceItemId === item.invoiceItemId)?.quantity ?? 0
        : n(item.pickedQuantity);
      if (want > n(item.pickedQuantity) + EPS) {
        throw httpError(400, `Cannot hand over ${want}; only ${n(item.pickedQuantity)} was picked on a line`);
      }
      if (want > EPS) requests.push({ invoiceItemId: item.invoiceItemId, quantity: roundQty(want) });
    }
    if (explicit?.some((r) => !task.items.some((i) => i.invoiceItemId === r.invoiceItemId) && r.quantity > 0)) {
      throw httpError(400, 'A line in the request is not on this picking list');
    }
    if (!requests.length) throw httpError(400, 'Enter a quantity to hand over on at least one line');

    const posted = await fulfilInTx(tx, user, invoice, task.warehouseId, requests, {
      ...meta,
      existingFulfilmentId: id,
      finalStatus: 'released'
    });

    const remainder = task.items
      .map((i) => ({
        invoiceItemId: i.invoiceItemId,
        itemId: i.id,
        left: roundQty(n(i.pickedQuantity) - (requests.find((r) => r.invoiceItemId === i.invoiceItemId)?.quantity || 0))
      }))
      .filter((r) => r.left > EPS);
    let splitNumber: string | null = null;
    if (remainder.length) {
      for (const r of remainder) {
        const released = requests.find((q) => q.invoiceItemId === r.invoiceItemId)?.quantity || 0;
        await tx.salesFulfilmentItem.update({ where: { id: r.itemId }, data: { pickedQuantity: toDec(released) } });
      }
      splitNumber = await nextDocNumber(tx.salesFulfilment, user.businessId, 'fulfilmentNumber', 'FUL', 5);
      await tx.salesFulfilment.create({
        data: {
          id: shortId('ful'),
          businessId: user.businessId,
          fulfilmentNumber: splitNumber,
          invoiceId: task.invoiceId,
          warehouseId: task.warehouseId,
          branchId: task.branchId,
          fulfilmentType: task.fulfilmentType,
          status: 'ready_for_collection',
          splitFromId: task.id,
          pickerId: task.pickerId,
          pickStartedAt: task.pickStartedAt,
          pickedAt: task.pickedAt,
          readyAt: new Date(),
          fulfilledAt: null,
          notes: `Balance of ${task.fulfilmentNumber} after partial collection`,
          items: {
            create: remainder.map((r) => ({
              id: shortId('sfi'),
              invoiceItemId: r.invoiceItemId,
              plannedQuantity: toDec(r.left),
              pickedQuantity: toDec(r.left),
              quantity: toDec(0),
              baseQuantity: toDec(0)
            }))
          }
        }
      });
    }
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: task.invoiceId } });
    return { posted, splitNumber, inv };
  }, TX_OPTS);

  await writeAudit({
    user,
    action: 'release',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: id,
    summary:
      `Released ${result.posted.fulfilmentNumber} at ${warehouse.name} to ${meta.collectedBy} (${verification})` +
      (result.splitNumber ? `; balance kept as ${result.splitNumber}` : '')
  });
  const complete = result.inv.fulfilmentStatus === 'fulfilled';
  await notifyOrder(
    result.inv,
    complete ? 'collection_completed' : 'collection_partial',
    `${complete ? 'Collected' : 'Part collected'} — ${result.inv.invoiceNumber}`,
    `${meta.collectedBy} collected goods from ${warehouse.name}${complete ? '. The order is fully collected.' : '. Goods are still outstanding on this order.'}`
  );
  return getTask(user, id);
}

/**
 * Release reserved goods straight from the shelf without a separate picking step (small orders).
 * Same verification as a picked collection; quantities already on a picking list are excluded.
 */
export async function quickRelease(user: AuthUser, body: ReleaseBody) {
  const invoiceId = requireString(body.invoice_id || body.invoiceId, 'invoice_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const warehouse = await assertWarehouseStaff(user, warehouseId);
  const requests = parseRequests(body) || [];
  if (!requests.length) throw httpError(400, 'Select at least one line to release');

  const header = await prisma.salesInvoice.findFirst({ where: { id: invoiceId, businessId: user.businessId } });
  if (!header) throw httpError(404, 'Invoice not found');
  if (header.fulfilmentMode === 'delivery') {
    throw httpError(400, 'Delivery orders are picked and dispatched; use the delivery workflow');
  }
  const verification = await verifyCollection(user, invoiceId, {
    pickupCode: body.pickup_code ?? body.pickupCode,
    overrideReason: body.override_reason ?? body.overrideReason,
    collectorName: body.collected_by || body.collectedBy
  });
  const meta = collectionMeta(body, verification);
  await assertCollector(invoiceId, meta);

  const result = await prisma.$transaction(async (tx) => {
    await lockInvoices(tx, [invoiceId]);
    const invoice = await invoiceForFulfilment(tx, user.businessId, invoiceId);
    if (!invoice) throw httpError(404, 'Invoice not found');
    if (invoice.status !== 'posted') throw httpError(400, 'Only confirmed invoices can be fulfilled');
    if (invoice.fulfilmentStatus === 'fulfilled') throw httpError(400, 'This invoice has already been fully collected');
    const free = await unclaimedReserved(tx, invoice, warehouse.id);
    for (const r of requests) {
      const avail = free.get(r.invoiceItemId);
      if (r.quantity > EPS && avail && r.quantity > avail.free + EPS) {
        throw httpError(
          400,
          `Only ${avail.free} of the ${avail.reserved} reserved can be released directly; the rest is on a picking list`
        );
      }
    }
    return fulfilInTx(tx, user, invoice, warehouse.id, requests, { ...meta, finalStatus: 'released' });
  }, TX_OPTS);

  await writeAudit({
    user,
    action: 'fulfil',
    module: 'sales',
    entityType: 'SalesFulfilment',
    entityId: result.id,
    summary: `Released goods ${result.fulfilmentNumber} for ${header.invoiceNumber} to ${meta.collectedBy} (${verification})`
  });
  const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const complete = inv.fulfilmentStatus === 'fulfilled';
  await notifyOrder(
    inv,
    complete ? 'collection_completed' : 'collection_partial',
    `${complete ? 'Collected' : 'Part collected'} — ${inv.invoiceNumber}`,
    `${meta.collectedBy} collected goods from ${warehouse.name}.`
  );
  return getTask(user, result.id);
}

/** Abandon a picking list before hand-over; reserved stock stays reserved for the order. */
export async function cancelTask(user: AuthUser, id: string, body: Record<string, any>) {
  const reason = requireString(body.reason, 'reason');
  const head = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId } });
  if (!head) throw httpError(404, 'Fulfilment not found');
  await assertWarehouseStaff(user, head.warehouseId);
  await prisma.$transaction((tx) => cancelTasksInTx(tx, user.id, [id], reason), TX_OPTS);
  await writeAudit({
    user,
    action: 'pick_cancel',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: id,
    summary: `Cancelled ${head.fulfilmentNumber}: ${reason}`
  });
  return getTask(user, id);
}

/** Cancel open (not dispatched) fulfilment records and their unsent delivery orders. */
export async function cancelTasksInTx(tx: Tx, userId: string | null, ids: string[], reason: string) {
  const tasks = await tx.salesFulfilment.findMany({ where: { id: { in: ids } }, include: { deliveryOrder: true } });
  for (const t of tasks) {
    if (t.status === 'dispatched') {
      throw httpError(400, `${t.fulfilmentNumber} is out for delivery; confirm or return the delivery first`);
    }
    if (!['picking', 'ready_for_collection', 'picked'].includes(t.status)) {
      throw httpError(400, `${t.fulfilmentNumber} is ${t.status} and cannot be cancelled`);
    }
    await tx.salesFulfilment.update({
      where: { id: t.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: userId, cancelReason: reason }
    });
    if (t.deliveryOrder && !['delivered', 'cancelled'].includes(t.deliveryOrder.status)) {
      await tx.deliveryOrder.update({
        where: { id: t.deliveryOrder.id },
        data: { status: 'cancelled', notes: `${t.deliveryOrder.notes ? `${t.deliveryOrder.notes}\n` : ''}Cancel: ${reason}` }
      });
    }
  }
}

/** Open (not dispatched) records for an order, optionally in one warehouse — used by cancel/reallocate/expiry. */
export async function openTaskIds(tx: Tx, invoiceId: string, warehouseId?: string, itemIds?: string[]) {
  const rows = await tx.salesFulfilment.findMany({
    where: {
      invoiceId,
      status: { in: OPEN_TASK_STATUSES },
      ...(warehouseId ? { warehouseId } : {}),
      ...(itemIds ? { items: { some: { invoiceItemId: { in: itemIds } } } } : {})
    },
    select: { id: true, status: true, fulfilmentNumber: true }
  });
  return rows;
}

// ─── delivery ───────────────────────────────────────────────────────────────

/** Load the goods on a vehicle. Stock stays reserved in the warehouse until delivery is confirmed. */
export async function dispatchTask(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const head = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId }, include: { deliveryOrder: true } });
  if (!head) throw httpError(404, 'Fulfilment not found');
  if (head.fulfilmentType !== 'delivery' || head.status !== 'picked') {
    throw httpError(400, `${head.fulfilmentNumber} is not waiting for dispatch (${head.status})`);
  }
  if (!head.deliveryOrder) throw httpError(400, 'No delivery order is linked to this fulfilment');
  const warehouse = await assertWarehouseStaff(user, head.warehouseId);
  const vehicleId = body.vehicle_id ?? body.vehicleId ?? head.deliveryOrder.vehicleId ?? null;
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, businessId: user.businessId } });
    if (!vehicle) throw httpError(400, 'Invalid vehicle_id');
  }
  const driverName = body.driver_name ?? body.driverName ?? head.deliveryOrder.driverName ?? null;
  if (!vehicleId && !driverName) throw httpError(400, 'Choose a vehicle or enter the driver / transporter');

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.salesFulfilment.findUniqueOrThrow({ where: { id } });
    if (fresh.status !== 'picked') throw httpError(409, 'This fulfilment changed; reload and retry');
    await tx.salesFulfilment.update({
      where: { id },
      data: { status: 'dispatched', dispatchedAt: new Date(), dispatchedById: user.id }
    });
    await tx.deliveryOrder.update({
      where: { id: head.deliveryOrder!.id },
      data: { status: 'dispatched', dispatchedAt: new Date(), vehicleId, driverName }
    });
  }, TX_OPTS);

  await writeAudit({
    user,
    action: 'dispatch',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: id,
    summary: `Dispatched ${head.fulfilmentNumber} (${head.deliveryOrder.deliveryNumber}) from ${warehouse.name}`
  });
  const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: head.invoiceId } });
  await notifyOrder(inv, 'dispatched', `Out for delivery — ${inv.invoiceNumber}`,
    `${head.deliveryOrder.deliveryNumber} left ${warehouse.name}${driverName ? ` with ${driverName}` : ''}.`);
  return getTask(user, id);
}

/**
 * Proof of delivery: the receiver's name is required. Delivered quantities post stock issue,
 * revenue and COGS (transfer of control); anything not delivered comes back to the warehouse and
 * stays reserved for the order.
 */
export async function deliverTask(user: AuthUser, id: string, body: Record<string, any>) {
  const receivedBy = requireString(body.received_by || body.receivedBy, 'received_by');
  const head = await prisma.salesFulfilment.findFirst({ where: { id, businessId: user.businessId }, include: { deliveryOrder: true } });
  if (!head) throw httpError(404, 'Fulfilment not found');
  if (head.status !== 'dispatched') throw httpError(400, `${head.fulfilmentNumber} is not out for delivery (${head.status})`);
  const warehouse = await assertWarehouseStaff(user, head.warehouseId);
  const explicit = parseRequests(body);
  const podReference = body.proof_reference || body.proofReference || body.pod_reference || null;
  const podNotes = body.pod_notes || body.podNotes || body.notes || null;

  const result = await prisma.$transaction(async (tx) => {
    await lockInvoices(tx, [head.invoiceId]);
    const task = await loadOpenTask(tx, user, id);
    if (task.status !== 'dispatched') throw httpError(409, 'This fulfilment changed; reload and retry');
    const invoice = (await invoiceForFulfilment(tx, user.businessId, task.invoiceId))!;
    const requests: FulfilRequest[] = [];
    const returned: string[] = [];
    for (const item of task.items) {
      const want = explicit
        ? explicit.find((r) => r.invoiceItemId === item.invoiceItemId)?.quantity ?? 0
        : n(item.pickedQuantity);
      if (want > n(item.pickedQuantity) + EPS) {
        throw httpError(400, `Cannot deliver ${want}; only ${n(item.pickedQuantity)} was dispatched on a line`);
      }
      if (want > EPS) requests.push({ invoiceItemId: item.invoiceItemId, quantity: roundQty(want) });
      const back = roundQty(n(item.pickedQuantity) - want);
      if (back > EPS) returned.push(`${back} returned undelivered`);
    }
    const discrepancy = returned.length
      ? [task.discrepancyNotes, `Delivery: ${returned.join('; ')}`].filter(Boolean).join(' — ')
      : task.discrepancyNotes;

    if (!requests.length) {
      await tx.salesFulfilment.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: user.id, cancelReason: `Not delivered: ${podNotes || 'refused'}`, discrepancyNotes: discrepancy }
      });
      await tx.deliveryOrder.update({
        where: { id: head.deliveryOrder!.id },
        data: { status: 'cancelled', podNotes, receivedBy }
      });
      return { posted: null, returned: returned.length > 0 };
    }

    const posted = await fulfilInTx(tx, user, invoice, task.warehouseId, requests, {
      collectedBy: receivedBy,
      collectorRelation: body.collector_relation || 'customer',
      acknowledged: true,
      signatureName: body.signature_name || receivedBy,
      proofReference: podReference,
      verificationMethod: 'delivery',
      notes: podNotes,
      existingFulfilmentId: id,
      finalStatus: 'delivered'
    });
    for (const item of task.items) {
      const delivered = requests.find((r) => r.invoiceItemId === item.invoiceItemId)?.quantity || 0;
      if (delivered < n(item.pickedQuantity) - EPS) {
        await tx.salesFulfilmentItem.update({ where: { id: item.id }, data: { pickedQuantity: toDec(delivered) } });
      }
    }
    await tx.salesFulfilment.update({ where: { id }, data: { discrepancyNotes: discrepancy } });
    await tx.deliveryOrder.update({
      where: { id: head.deliveryOrder!.id },
      data: { status: 'delivered', deliveredAt: new Date(), receivedBy, podReference, podNotes, deliveredById: user.id }
    });
    return { posted, returned: returned.length > 0 };
  }, TX_OPTS);

  await writeAudit({
    user,
    action: 'deliver',
    module: 'fulfilment',
    entityType: 'SalesFulfilment',
    entityId: id,
    summary: result.posted
      ? `Delivered ${head.fulfilmentNumber} to ${receivedBy}${result.returned ? ' (part returned to warehouse)' : ''}`
      : `${head.fulfilmentNumber} not delivered; goods returned to ${warehouse.name}`
  });
  const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: head.invoiceId } });
  await notifyOrder(
    inv,
    'delivered',
    result.posted ? `Delivered — ${inv.invoiceNumber}` : `Delivery failed — ${inv.invoiceNumber}`,
    result.posted
      ? `${head.deliveryOrder?.deliveryNumber} received by ${receivedBy}.${result.returned ? ' Some goods came back and remain reserved.' : ''}`
      : `${head.deliveryOrder?.deliveryNumber} was not accepted; goods are back at ${warehouse.name} and still reserved.`
  );
  return getTask(user, id);
}

/** Delivery order cancelled on the Distribution page while out: goods are back, ready to dispatch again. */
export async function returnDispatched(user: AuthUser, fulfilmentId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const t = await tx.salesFulfilment.findFirst({ where: { id: fulfilmentId, businessId: user.businessId } });
    if (!t) throw httpError(404, 'Fulfilment not found');
    if (t.status === 'dispatched' || t.status === 'picked') {
      await tx.salesFulfilment.update({
        where: { id: t.id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason }
      });
    }
  }, TX_OPTS);
}

// ─── dashboard ──────────────────────────────────────────────────────────────

/**
 * Warehouse fulfilment dashboard for the user's warehouses: work waiting to be picked, picking
 * lists by state, overdue collections and recent discrepancies. No prices beyond the amount due.
 */
export async function warehouseDashboard(
  user: AuthUser,
  opts: { warehouseId?: string; q?: string; status?: string; from?: string; to?: string } = {}
) {
  const pending: any = await listPendingPickups(user, { warehouseId: opts.warehouseId, q: opts.q });
  const allowed = await authorisedWarehouseIds(user);
  const whIds = opts.warehouseId ? [opts.warehouseId] : [...allowed];
  const q = (opts.q || '').trim();
  const since = new Date(Date.now() - 30 * 86400000);
  const from = opts.from ? new Date(opts.from) : null;
  const to = opts.to ? new Date(opts.to) : null;

  const tasks = await prisma.salesFulfilment.findMany({
    where: {
      businessId: user.businessId,
      warehouseId: { in: whIds },
      ...(opts.status ? { status: opts.status } : {}),
      OR: [{ status: { in: OPEN_TASK_STATUSES } }, { updatedAt: { gte: from || since } }],
      ...(to ? { createdAt: { lte: to } } : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { fulfilmentNumber: { contains: q } },
                  { invoice: { invoiceNumber: { contains: q } } },
                  { invoice: { customer: { name: { contains: q } } } },
                  { invoice: { customer: { phone: { contains: q } } } }
                ]
              }
            ]
          }
        : {})
    },
    include: {
      warehouse: { select: { id: true, name: true, code: true, branch: { select: { id: true, name: true } } } },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          fulfilmentMode: true,
          fulfilmentStatus: true,
          paymentStatus: true,
          reservationExpiresAt: true,
          deliveryAddress: true,
          customer: { select: { id: true, name: true, phone: true } }
        }
      },
      items: {
        include: {
          invoiceItem: {
            select: {
              product: { select: { name: true, sku: true } },
              variant: { select: { name: true } },
              uom: { select: { code: true } }
            }
          }
        }
      },
      deliveryOrder: { select: { id: true, deliveryNumber: true, status: true, driverName: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 300
  });

  // What is reserved but not yet on any picking list.
  const claims = new Map<string, Map<string, number>>();
  for (const t of tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status))) {
    const key = `${t.invoiceId}:${t.warehouseId}`;
    const m = claims.get(key) || new Map<string, number>();
    for (const i of t.items) {
      const qn = t.status === 'picking' ? n(i.plannedQuantity) : n(i.pickedQuantity) - n(i.quantity);
      m.set(i.invoiceItemId, roundQty((m.get(i.invoiceItemId) || 0) + Math.max(0, qn)));
    }
    claims.set(key, m);
  }
  const awaiting = (pending.rows as any[])
    .map((r) => {
      const m = claims.get(`${r.invoice_id}:${r.warehouse?.id}`);
      const lines = (r.lines as any[])
        .map((l) => ({ ...l, to_pick: Math.max(0, roundQty(Number(l.remaining) - (m?.get(l.invoice_item_id) || 0))) }))
        .filter((l) => l.to_pick > EPS);
      return { ...r, lines };
    })
    .filter((r) => r.lines.length);

  const now = Date.now();
  const soon = now + 86400000;
  const isOverdue = (exp: unknown) => exp != null && new Date(String(exp)).getTime() < soon;
  const withDiscrepancy = tasks.filter((t) => t.items.some((i) => n(i.shortQuantity) + n(i.damagedQuantity) > EPS) || t.status === 'discrepancy');
  const summary = {
    awaitingPicking: awaiting.length,
    picking: tasks.filter((t) => t.status === 'picking').length,
    readyForCollection: tasks.filter((t) => t.status === 'ready_for_collection').length,
    awaitingDispatch: tasks.filter((t) => t.status === 'picked').length,
    outForDelivery: tasks.filter((t) => t.status === 'dispatched').length,
    partiallyFulfilled: new Set(
      [...awaiting.filter((r) => r.fulfilment_status === 'partial').map((r) => r.invoice_id),
        ...tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status) && t.invoice.fulfilmentStatus === 'partial').map((t) => t.invoiceId)]
    ).size,
    overdueCollection:
      awaiting.filter((r) => isOverdue(r.reservation_expires_at)).length +
      tasks.filter((t) => t.status === 'ready_for_collection' && isOverdue(t.invoice.reservationExpiresAt)).length,
    discrepancies: withDiscrepancy.length
  };

  return serialize({
    warehouses: pending.warehouses,
    summary,
    awaiting,
    tasks: tasks.map((t) => ({
      ...t,
      overdue: t.status === 'ready_for_collection' && isOverdue(t.invoice.reservationExpiresAt),
      hasDiscrepancy: withDiscrepancy.includes(t)
    }))
  });
}
