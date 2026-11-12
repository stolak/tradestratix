/**
 * Multi-branch order fulfilment checks (service level, self-cleaning).
 * Uses the demo business: branches HQ + BR2 with warehouses MAIN / 66Y6U (HQ) and IKEJA (BR2).
 * Creates its own product, stock and customer, and removes them afterwards.
 *
 * Run: npm run test:fulfilment
 */
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/utils/prisma.js';
import type { AuthUser } from '../src/types/express/index.js';
import { createStockMovement } from '../src/services/inventory.service.js';
import * as sales from '../src/services/sales.service.js';
import * as orders from '../src/services/sales-order.service.js';
import * as fulfilment from '../src/services/fulfilment.service.js';
import * as wf from '../src/services/warehouse-fulfilment.service.js';
import * as logistics from '../src/services/logistics.service.js';
import { reissuePickupCode } from '../src/services/pickup-code.service.js';
import * as returns from '../src/services/sales-return.service.js';
import * as customerPayment from '../src/services/customer-payment.service.js';
import { getDefaultAccountMap } from '../src/services/accounting.service.js';
import { shortId } from '../src/utils/helpers.js';

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
async function expectError(fn: () => Promise<unknown>, status: number, msg: string) {
  try {
    await fn();
    assert(false, `${msg} (no error thrown)`);
  } catch (err: any) {
    assert(err?.status === status, `${msg} → ${err?.status} ${String(err?.message || '').slice(0, 90)}`);
  }
}
const num = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

const created = { invoices: [] as string[], productId: '', customerId: '' };

async function main() {
  const owner = await prisma.user.findFirst({ where: { role: 'business_owner', status: 'active' } });
  if (!owner) throw new Error('No business owner user — run the seed first');
  const businessId = owner.businessId!;
  const branches = await prisma.branch.findMany({ where: { businessId, isActive: true } });
  const warehouses = await prisma.warehouse.findMany({ where: { businessId, isActive: true } });
  const wh = (code: string) => warehouses.find((w) => w.code === code)!;
  const MAIN = wh('MAIN');
  const IKEJA = wh('IKEJA');
  const ALT = warehouses.find((w) => w.branchId === MAIN.branchId && w.id !== MAIN.id);
  if (!MAIN || !IKEJA || !ALT) throw new Error('Expected warehouses MAIN, IKEJA and a second HQ warehouse');
  const HQ = branches.find((b) => b.id === MAIN.branchId)!;
  const BR2 = branches.find((b) => b.id === IKEJA.branchId)!;

  const asUser = (u: { id: string; username: string; fullName?: string | null; role: string }, branchId: string): AuthUser => ({
    id: u.id,
    businessId,
    username: u.username,
    fullName: u.fullName || u.username,
    role: u.role,
    activeBranchId: branchId
  });
  const ownerAt = (branchId: string) => asUser(owner, branchId);
  const hqOfficer = await prisma.user.findFirst({
    where: {
      businessId,
      role: 'inventory_officer',
      status: 'active',
      userBranches: { every: { branchId: HQ.id } },
      AND: [{ userBranches: { some: { branchId: HQ.id } } }]
    }
  });

  const base = await prisma.product.findFirst({ where: { businessId }, select: { baseUomId: true } });
  const productId = shortId('prd');
  created.productId = productId;
  await prisma.product.create({
    data: {
      id: productId,
      businessId,
      name: `Fulfilment Test Widget ${productId}`,
      sku: `FUL-${productId}`,
      baseUomId: base!.baseUomId,
      defaultSellingPrice: 100,
      variants: { create: { id: shortId('var'), businessId, name: 'Default', isDefault: true } }
    }
  });
  const receive = (warehouseId: string, qty: number) =>
    createStockMovement(ownerAt(HQ.id), {
      product_id: productId,
      warehouse_id: warehouseId,
      movement_type: 'opening',
      quantity_in: qty,
      unit_cost: 40,
      reference_type: 'test',
      reason: 'fulfilment test stock'
    });
  await receive(MAIN.id, 10);
  await receive(IKEJA.id, 5);
  await receive(ALT.id, 3);

  const customerId = shortId('cus');
  created.customerId = customerId;
  await prisma.customer.create({
    data: { id: customerId, businessId, code: `FUL-${customerId}`, name: 'Fulfilment Test Customer', status: 'active' }
  });

  const freeIn = async (warehouseId: string) => {
    const opts: any = await fulfilment.fulfilmentOptions(ownerAt(HQ.id), [productId]);
    return Number(opts.availability[productId]?.[warehouseId] || 0);
  };
  const order = async (user: AuthUser, body: Record<string, any>) => {
    const inv: any = await sales.createInvoice(user, {
      customer_id: customerId,
      branch_id: user.activeBranchId,
      ...body,
      items: body.items.map((i: any) => ({ product_id: productId, ...i }))
    });
    created.invoices.push(inv.id);
    return inv;
  };
  const reload = (id: string) => prisma.salesInvoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const journalsFor = (sourceIds: string[]) =>
    prisma.journalEntry.findMany({ where: { businessId, sourceId: { in: sourceIds } }, include: { lines: true } });
  const accounts = await getDefaultAccountMap(businessId);

  // 1. Same-branch pickup: confirm reserves only; hand-over recognises revenue + COGS.
  console.log('\n1. Same-branch pickup (revenue at hand-over)');
  const br2 = ownerAt(BR2.id);
  const inv1 = await order(br2, { warehouse_id: IKEJA.id, fulfilment_mode: 'pickup', items: [{ quantity: 3 }] });
  await sales.postInvoice(br2, inv1.id);
  let r1 = await reload(inv1.id);
  assert(r1.status === 'posted' && num(r1.recognisedAmount) === 0 && num(r1.balance) === 0, 'confirmed with no revenue and no receivable');
  assert(!r1.journalEntryId, 'no revenue journal at confirmation');
  assert((await freeIn(IKEJA.id)) === 2, 'IKEJA free stock drops from 5 to 2 (reserved)');
  assert(/^\d{6}$/.test(String(r1.pickupCode)), 'pickup order receives a 6-digit pickup code');
  const listed: any = await sales.getInvoice(br2, inv1.id);
  assert(listed.pickup_code === r1.pickupCode, 'selling branch sees the pickup code');
  const release1 = {
    invoice_id: inv1.id,
    warehouse_id: IKEJA.id,
    items: [{ invoice_item_id: r1.items[0].id, quantity: 3 }],
    collected_by: 'Test Collector',
    acknowledged: true
  };
  await expectError(() => wf.quickRelease(br2, { ...release1, pickup_code: '000000' === r1.pickupCode ? '111111' : '000000' }), 400, 'wrong pickup code refused');
  await expectError(() => wf.quickRelease(br2, { ...release1, pickup_code: r1.pickupCode, acknowledged: false }), 400, 'release without acknowledgement refused');
  const ful1: any = await wf.quickRelease(br2, { ...release1, pickup_code: r1.pickupCode });
  const checks1 = await prisma.pickupVerification.findMany({ where: { invoiceId: inv1.id }, orderBy: { createdAt: 'asc' } });
  assert(checks1.some((c) => c.result === 'failed') && checks1.some((c) => c.result === 'success'), 'failed and successful code checks are recorded');
  r1 = await reload(inv1.id);
  assert(num(r1.recognisedAmount) === 300 && num(r1.balance) === 300, 'hand-over recognises 300 and raises AR 300');
  assert(r1.fulfilmentStatus === 'fulfilled', 'order fully fulfilled');
  const j1 = await journalsFor([ful1.id]);
  assert(j1.length === 2 && j1.every((j) => j.branchId === BR2.id), 'revenue + COGS journals booked in the selling branch');

  // 2. Cross-branch pickup with a deposit; partial collection at HQ.
  console.log('\n2. Cross-branch pickup with deposit');
  const inv2 = await order(br2, {
    warehouse_id: MAIN.id,
    fulfilment_mode: 'pickup',
    items: [{ quantity: 4 }],
    pay_now: true,
    amount_paid: 400,
    payment_method: 'cash'
  });
  let r2 = await reload(inv2.id);
  assert(num(r2.depositHeld) === 400 && num(r2.balance) === 0 && num(r2.recognisedAmount) === 0, 'payment before hand-over held as a 400 deposit');
  const depJ = await prisma.journalEntry.findFirst({
    where: { businessId, sourceType: 'customer_payment', customerId },
    include: { lines: true },
    orderBy: { createdAt: 'desc' }
  });
  assert(depJ?.lines.some((l) => l.accountId === accounts.customer_deposits && num(l.credit) === 400), 'deposit credited to Customer Deposits');
  if (hqOfficer) {
    await expectError(
      () =>
        wf.quickRelease(asUser(hqOfficer, HQ.id), {
          invoice_id: inv1.id,
          warehouse_id: IKEJA.id,
          items: [{ invoice_item_id: r1.items[0].id, quantity: 1 }],
          collected_by: 'x',
          acknowledged: true
        }),
      403,
      'HQ-only officer cannot release from IKEJA'
    );
    await expectError(
      () =>
        wf.quickRelease(asUser(hqOfficer, HQ.id), {
          invoice_id: inv2.id,
          warehouse_id: MAIN.id,
          items: [{ invoice_item_id: r2.items[0].id, quantity: 1 }],
          collected_by: 'x',
          acknowledged: true,
          override_reason: 'Customer lost code'
        }),
      403,
      'officer without override permission cannot skip the pickup code'
    );
  }
  const releaser = hqOfficer ? asUser(hqOfficer, HQ.id) : ownerAt(HQ.id);
  const ful2: any = await wf.quickRelease(releaser, {
    invoice_id: inv2.id,
    warehouse_id: MAIN.id,
    items: [{ invoice_item_id: r2.items[0].id, quantity: 2 }],
    pickup_code: r2.pickupCode,
    collected_by: 'Driver for customer',
    collector_relation: 'other',
    id_type: 'national_id',
    id_reference: 'A1234567',
    acknowledged: true
  });
  const f2 = await prisma.salesFulfilment.findUniqueOrThrow({ where: { id: ful2.id } });
  assert(f2.idReference === '••••4567' && f2.verificationMethod === 'code', 'only the last 4 ID characters are stored; verified by code');
  r2 = await reload(inv2.id);
  assert(num(r2.recognisedAmount) === 200 && num(r2.depositHeld) === 200 && num(r2.balance) === 0, 'collecting 2 recognises 200 settled from the deposit');
  assert(r2.fulfilmentStatus === 'partial', 'order partially fulfilled');
  const j2 = await journalsFor([ful2.id]);
  const invJ = j2.find((j) => j.branchId === HQ.id);
  const revJ = j2.filter((j) => j.branchId === BR2.id);
  assert(invJ?.lines.some((l) => l.accountId === accounts.inter_branch_clearing && num(l.debit) === 80), 'HQ: Dr inter-branch clearing 80 / Cr inventory');
  assert(revJ.length === 2, 'BR2: revenue (with deposit application) and COGS journals');

  // 3. Split allocation across warehouses.
  console.log('\n3. Split-line allocation');
  const inv3 = await order(ownerAt(HQ.id), { warehouse_id: MAIN.id, fulfilment_mode: 'pickup', items: [{ quantity: 9 }] });
  await sales.postInvoice(ownerAt(HQ.id), inv3.id, { allow_backorder: false });
  const res3 = await prisma.salesReservation.findMany({ where: { invoiceItem: { invoiceId: inv3.id }, status: 'active' } });
  const byWh3 = new Map<string, number>();
  for (const r of res3) byWh3.set(r.warehouseId, (byWh3.get(r.warehouseId) || 0) + Number(r.quantity));
  assert(byWh3.size >= 2 && [...byWh3.values()].reduce((a, b) => a + b, 0) === 9, `9 split across ${byWh3.size} warehouses (MAIN first: ${byWh3.get(MAIN.id) || 0})`);
  assert(byWh3.get(MAIN.id) === 6 && byWh3.get(ALT.id) === 3, 'preferred MAIN free stock used first (6), remainder from the same branch (66Y6U 3) before IKEJA');

  // 4. Shortage and backorder.
  console.log('\n4. Shortage / backorder');
  const inv4 = await order(ownerAt(HQ.id), { warehouse_id: MAIN.id, fulfilment_mode: 'pickup', items: [{ quantity: 10 }] });
  await expectError(() => sales.postInvoice(ownerAt(HQ.id), inv4.id), 400, 'confirming beyond free stock is refused');
  await sales.postInvoice(ownerAt(HQ.id), inv4.id, { allow_backorder: true });
  let res4 = await prisma.salesReservation.findMany({ where: { invoiceItem: { invoiceId: inv4.id }, status: 'active' } });
  const reserved4 = res4.reduce((s, r) => s + Number(r.quantity), 0);
  assert(reserved4 === 2, `backorder confirmed reserving all free stock, IKEJA's 2 (${reserved4} of 10)`);
  await receive(MAIN.id, 8);
  await orders.allocateBackorders(ownerAt(HQ.id), inv4.id);
  res4 = await prisma.salesReservation.findMany({ where: { invoiceItem: { invoiceId: inv4.id }, status: 'active' } });
  assert(res4.reduce((s, r) => s + Number(r.quantity), 0) === 10, 'backorder allocated after new stock arrived (10 reserved)');

  // 6. Partial cancellation releases stock and returns excess deposit to customer credit.
  console.log('\n6. Cancel the uncollected balance (close short)');
  const freeMainBefore = await freeIn(MAIN.id);
  await orders.cancelOrder(br2, inv2.id, { reason: 'Customer no longer needs the rest' });
  r2 = await reload(inv2.id);
  assert(r2.status === 'posted' && r2.fulfilmentStatus === 'fulfilled', 'order closed short (posted, fulfilled)');
  assert(num(r2.cancelledAmount) === 200 && num(r2.depositHeld) === 0 && num(r2.amountPaid) === 200, 'cancelled 200; excess deposit removed from the order');
  assert((await freeIn(MAIN.id)) === freeMainBefore + 2, 'reserved 2 returned to MAIN free stock');
  const pay2 = await prisma.customerPayment.findFirst({ where: { allocations: { some: { invoiceId: inv2.id } } } });
  assert(num(pay2?.unappliedAmount) === 200, 'payment shows 200 unapplied customer credit');

  // 7. Full cancellation.
  console.log('\n7. Full cancellation');
  await orders.cancelOrder(ownerAt(HQ.id), inv4.id, { reason: 'Order withdrawn' });
  const r4 = await reload(inv4.id);
  assert(r4.status === 'cancelled' && r4.paymentStatus === 'void', 'order cancelled');
  assert(
    (await prisma.salesReservation.count({ where: { invoiceItem: { invoiceId: inv4.id }, status: 'active' } })) === 0,
    'all reservations released'
  );

  // 9. Reallocation to another warehouse.
  console.log('\n9. Reallocation');
  await orders.reallocateOrder(ownerAt(HQ.id), inv3.id, {
    from_warehouse_id: ALT.id,
    to_warehouse_id: MAIN.id,
    reason: 'Consolidate pickup at MAIN'
  });
  const res9 = await prisma.salesReservation.findMany({ where: { invoiceItem: { invoiceId: inv3.id } } });
  assert(res9.filter((r) => r.status === 'active' && r.warehouseId === MAIN.id).reduce((s, r) => s + Number(r.quantity), 0) === 9, 'all 9 now reserved at MAIN');
  assert(res9.some((r) => r.status === 'released' && r.releaseReason === 'reallocated' && r.method === 'auto'), 'old reservation kept as released/reallocated');
  assert(res9.some((r) => r.status === 'active' && r.method === 'reallocation'), 'new reservation tagged as reallocation');
  await expectError(
    () => orders.reallocateOrder(ownerAt(HQ.id), inv3.id, { from_warehouse_id: MAIN.id, reason: '' }),
    400,
    'reallocation requires a reason'
  );

  // 11. Credit limit counts open orders.
  console.log('\n11. Credit exposure');
  await prisma.customer.update({ where: { id: customerId }, data: { creditLimit: 1500 } });
  const exposure = await (await import('../src/services/customer.service.js')).getCustomerExposure(prisma, businessId, customerId);
  assert(exposure.receivable === 300 && exposure.openOrders === 900, `exposure = AR 300 + open orders 900 (${exposure.receivable} + ${exposure.openOrders})`);
  const inv11 = await order(ownerAt(HQ.id), { warehouse_id: MAIN.id, fulfilment_mode: 'pickup', items: [{ quantity: 4 }] });
  await expectError(() => sales.postInvoice(ownerAt(HQ.id), inv11.id), 400, 'order of 400 refused (1200 + 400 > 1500)');
  await expectError(
    () => sales.postInvoice(ownerAt(HQ.id), inv11.id, { override_credit: true }),
    400,
    'override without a reason is refused'
  );
  await sales.postInvoice(ownerAt(HQ.id), inv11.id, { override_credit: true, override_reason: 'Director approved' });
  const r11 = await reload(inv11.id);
  assert(r11.creditOverrideById === owner.id && r11.creditOverrideReason === 'Director approved', 'override recorded with user and reason');
  await prisma.customer.update({ where: { id: customerId }, data: { creditLimit: null } });

  // 13. Concurrent confirmations cannot oversell.
  console.log('\n13. Concurrent reservations');
  const freeAlt = await freeIn(ALT.id);
  const hq = ownerAt(HQ.id);
  const a = await order(hq, { warehouse_id: ALT.id, fulfilment_mode: 'pickup', items: [{ quantity: freeAlt, allocations: [{ warehouse_id: ALT.id, quantity: freeAlt }] }] });
  const b = await order(hq, { warehouse_id: ALT.id, fulfilment_mode: 'pickup', items: [{ quantity: freeAlt, allocations: [{ warehouse_id: ALT.id, quantity: freeAlt }] }] });
  const results = await Promise.allSettled([sales.postInvoice(hq, a.id), sales.postInvoice(hq, b.id)]);
  assert(results.filter((r) => r.status === 'fulfilled').length === 1, `exactly one of two competing orders for ${freeAlt} units in 66Y6U confirmed`);
  assert((await freeIn(ALT.id)) === 0, '66Y6U free stock is 0, never negative');
  const lots = await prisma.stockLot.findMany({ where: { productId } });
  assert(lots.every((l) => Number(l.quantityReserved) <= Number(l.quantityOnHand) + 1e-6), 'no lot reserved beyond on-hand');

  // Expiry sweeper.
  console.log('\nReservation expiry');
  const winner = results[0].status === 'fulfilled' ? a : b;
  await prisma.salesInvoice.update({ where: { id: winner.id }, data: { reservationExpiresAt: new Date(Date.now() - 60_000) } });
  const sweep = await orders.expireReservations({ businessId });
  assert(sweep.expired >= 1, 'expired order released by the sweeper');
  assert((await freeIn(ALT.id)) === freeAlt, '66Y6U stock free again');
  const wInv = await reload(winner.id);
  assert(wInv.status === 'posted' && !wInv.reservationExpiresAt, 'order stays confirmed (backordered) after expiry');

  // Payment received in HQ for a BR2 invoice.
  console.log('\nCross-branch customer payment');
  const pay: any = await sales.recordCustomerPayment(ownerAt(HQ.id), {
    customer_id: customerId,
    amount: 300,
    method: 'cash',
    allocations: [{ invoice_id: inv1.id, amount: 300 }],
    idempotency_key: `test-pay-${inv1.id}`
  });
  r1 = await reload(inv1.id);
  assert(num(r1.balance) === 0 && r1.paymentStatus === 'paid', 'BR2 invoice settled by HQ receipt');
  const payJ = await journalsFor([pay.id]);
  assert(payJ.length === 2 && payJ.some((j) => j.branchId === HQ.id) && payJ.some((j) => j.branchId === BR2.id), 'linked HQ (cash/clearing) and BR2 (clearing/AR) journals');
  const replay: any = await sales.recordCustomerPayment(ownerAt(HQ.id), {
    customer_id: customerId,
    amount: 300,
    method: 'cash',
    allocations: [{ invoice_id: inv1.id, amount: 300 }],
    idempotency_key: `test-pay-${inv1.id}`
  });
  assert(replay.id === pay.id, 'replaying the same idempotency key returns the original payment');

  // Warehouse picking → ready → partial collection (split) → code lock-out / reissue.
  console.log('\nPicking and collection');
  await receive(MAIN.id, 20);
  const invP = await order(hq, { warehouse_id: MAIN.id, fulfilment_mode: 'pickup', items: [{ quantity: 6, allocations: [{ warehouse_id: MAIN.id, quantity: 6 }] }] });
  await sales.postInvoice(hq, invP.id);
  let rP = await reload(invP.id);
  const lineP = rP.items[0].id;
  const task: any = await wf.startPicking(hq, { invoice_id: invP.id, warehouse_id: MAIN.id });
  assert(task.status === 'picking' && num(task.items[0].planned_quantity) === 6, 'picking list opened for 6');
  assert(task.invoice.pickup_code === undefined && task.invoice.has_pickup_code === true, 'warehouse view hides the pickup code');
  await expectError(() => wf.startPicking(hq, { invoice_id: invP.id, warehouse_id: MAIN.id }), 400, 'second picking list for the same goods refused');
  await expectError(
    () => wf.quickRelease(hq, { invoice_id: invP.id, warehouse_id: MAIN.id, items: [{ invoice_item_id: lineP, quantity: 1 }], pickup_code: rP.pickupCode, collected_by: 'x', acknowledged: true }),
    400,
    'goods on a picking list cannot be released directly'
  );
  const picked: any = await wf.confirmPicking(hq, task.id, { items: [{ invoice_item_id: lineP, picked_quantity: 4, damaged_quantity: 1 }] });
  assert(picked.status === 'ready_for_collection', 'picked goods ready for collection');
  assert(num(picked.items[0].short_quantity) === 1 && num(picked.items[0].damaged_quantity) === 1, 'discrepancy recorded: 1 missing, 1 damaged');
  const resP = await prisma.salesReservation.findMany({ where: { invoiceItemId: lineP } });
  assert(resP.reduce((s, r) => s + Number(r.quantity) - Number(r.releasedQuantity) - Number(r.fulfilledQuantity), 0) === 4, '2 released from the reservation as a discrepancy, 4 still reserved');
  assert(resP.some((r) => r.releaseReason === 'discrepancy'), 'release reason "discrepancy"');
  rP = await reload(invP.id);
  assert(num(rP.recognisedAmount) === 0, 'picking alone recognises nothing');
  const rel: any = await wf.releaseTask(hq, task.id, {
    items: [{ invoice_item_id: lineP, quantity: 3 }],
    pickup_code: rP.pickupCode,
    collected_by: 'Fulfilment Test Customer',
    acknowledged: true,
    signature_name: 'FTC'
  });
  assert(rel.status === 'released' && num(rel.items[0].quantity) === 3, 'partial collection of 3 released');
  rP = await reload(invP.id);
  assert(num(rP.recognisedAmount) === 300 && rP.fulfilmentStatus === 'partial', 'revenue 300 recognised at hand-over; order partial');
  const split = await prisma.salesFulfilment.findFirstOrThrow({ where: { splitFromId: task.id }, include: { items: true } });
  assert(split.status === 'ready_for_collection' && num(split.items[0].pickedQuantity) === 1, 'remaining 1 kept ready on a split record');
  for (let i = 0; i < 5; i += 1) {
    await wf.releaseTask(hq, split.id, { pickup_code: 'bad', collected_by: 'x', acknowledged: true }).catch(() => undefined);
  }
  await expectError(() => wf.releaseTask(hq, split.id, { pickup_code: rP.pickupCode, collected_by: 'x', acknowledged: true }), 423, 'code locked after 5 wrong entries');
  const reissued: any = await reissuePickupCode(hq, invP.id, { reason: 'Locked at counter' });
  await wf.releaseTask(hq, split.id, { pickup_code: reissued.pickup_code, collected_by: 'Fulfilment Test Customer', acknowledged: true });
  rP = await reload(invP.id);
  assert(num(rP.recognisedAmount) === 400 && num(rP.items[0].fulfilledQuantity) === 4, 'reissued code releases the balance (4 of 6 collected)');
  await orders.cancelOrder(hq, invP.id, { reason: 'Damaged/missing units not replaced' });
  rP = await reload(invP.id);
  assert(rP.fulfilmentStatus === 'fulfilled' && num(rP.cancelledAmount) === 200, 'discrepancy quantity closed short (200 cancelled)');

  // Delivery: pick → dispatch → proof of delivery posts the sale.
  console.log('\nDelivery with proof of delivery');
  const invD = await order(hq, {
    warehouse_id: MAIN.id,
    fulfilment_mode: 'delivery',
    delivery_address: '12 Test Street, Lagos',
    items: [{ quantity: 3, allocations: [{ warehouse_id: MAIN.id, quantity: 3 }] }]
  });
  await sales.postInvoice(hq, invD.id);
  let rD = await reload(invD.id);
  assert(rD.fulfilmentMode === 'delivery' && !rD.pickupCode && !rD.reservationExpiresAt, 'delivery order: no pickup code, no hold expiry');
  const lineD = rD.items[0].id;
  const tD: any = await wf.startPicking(hq, { invoice_id: invD.id, warehouse_id: MAIN.id });
  const pD: any = await wf.confirmPicking(hq, tD.id, {});
  assert(pD.status === 'picked' && pD.delivery_order?.status === 'draft', 'picked for delivery; linked delivery order created');
  const doId = pD.delivery_order.id;
  await expectError(() => logistics.markDelivered(hq, doId, { received_by: 'Gate' }), 400, 'cannot deliver before dispatch');
  await expectError(() => wf.dispatchTask(hq, tD.id, {}), 400, 'dispatch needs a vehicle or driver');
  await logistics.dispatchDelivery(hq, doId, { driver_name: 'Test Driver' });
  const dD = await prisma.salesFulfilment.findUniqueOrThrow({ where: { id: tD.id } });
  assert(dD.status === 'dispatched', 'dispatch from the Distribution page moves the fulfilment to dispatched');
  rD = await reload(invD.id);
  assert(num(rD.recognisedAmount) === 0, 'nothing recognised while in transit');
  await expectError(() => orders.cancelOrder(hq, invD.id, { reason: 'x' }), 400, 'cannot cancel while out for delivery');
  await expectError(() => logistics.markDelivered(hq, doId, {}), 400, 'proof of delivery requires the receiver');
  await logistics.markDelivered(hq, doId, { received_by: 'Gate Keeper', pod_reference: 'POD-TEST-1', items: [{ invoice_item_id: lineD, quantity: 2 }] });
  rD = await reload(invD.id);
  const delivered = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: doId } });
  assert(num(rD.recognisedAmount) === 200 && rD.fulfilmentStatus === 'partial', 'delivered 2 of 3: 200 recognised, order partial');
  assert(delivered.status === 'delivered' && delivered.receivedBy === 'Gate Keeper' && delivered.podReference === 'POD-TEST-1', 'delivery order holds the proof of delivery');
  const resD = await prisma.salesReservation.findMany({ where: { invoiceItemId: lineD, status: 'active' } });
  assert(resD.reduce((s, r) => s + Number(r.quantity) - Number(r.fulfilledQuantity) - Number(r.releasedQuantity), 0) === 1, 'undelivered unit back in the warehouse, still reserved');
  await orders.cancelOrder(hq, invD.id, { reason: 'Customer refused the last unit' });

  // Returns: same-branch credit note, cross-branch restock, apply credit, over-return refused.
  console.log('\nSales returns');
  await receive(MAIN.id, 20);
  const invR: any = await sales.createInvoice(hq, {
    customer_id: customerId,
    branch_id: HQ.id,
    warehouse_id: MAIN.id,
    fulfilment_mode: 'immediate',
    items: [{ product_id: productId, quantity: 5 }],
    pay_now: true,
    amount_paid: 500,
    payment_method: 'cash'
  });
  created.invoices.push(invR.id);
  const lineR = invR.items[0].id;
  const freeAfterSale = await freeIn(MAIN.id);
  await expectError(
    () =>
      returns.createReturn(hq, {
        invoice_id: invR.id,
        warehouse_id: MAIN.id,
        reason: 'Too many',
        items: [{ invoice_item_id: lineR, quantity: 6 }]
      }),
    400,
    'cannot return more than handed over'
  );
  const draftR: any = await returns.createReturn(hq, {
    invoice_id: invR.id,
    warehouse_id: MAIN.id,
    reason: 'Customer changed mind',
    settlement: 'credit_note',
    condition: 'saleable',
    items: [{ invoice_item_id: lineR, quantity: 2 }]
  });
  assert(draftR.status === 'draft' && draftR.return_number, 'draft return created');
  const postedR: any = await returns.postReturn(hq, draftR.id, { reason: 'Customer changed mind' });
  assert(postedR.status === 'posted', 'return posted');
  const rR = await reload(invR.id);
  assert(num(rR.recognisedAmount) === 300, 'recognised reduced by returned value (500 → 300)');
  assert(num(rR.items[0].returnedQuantity) === 2, 'line returned quantity = 2');
  assert(num(postedR.credit_issued) === 200, 'paid invoice return issues 200 customer credit');
  assert((await freeIn(MAIN.id)) === freeAfterSale + 2, '2 units restocked to MAIN');

  // Cross-branch return: sell at HQ, return into IKEJA (BR2)
  const invX: any = await sales.createInvoice(hq, {
    customer_id: customerId,
    branch_id: HQ.id,
    warehouse_id: MAIN.id,
    fulfilment_mode: 'immediate',
    items: [{ product_id: productId, quantity: 3 }],
    pay_now: true,
    amount_paid: 300,
    payment_method: 'cash'
  });
  created.invoices.push(invX.id);
  const freeIkejaBefore = await freeIn(IKEJA.id);
  const draftX: any = await returns.createReturn(ownerAt(BR2.id), {
    invoice_id: invX.id,
    warehouse_id: IKEJA.id,
    reason: 'Returned at Ikeja',
    settlement: 'credit_note',
    items: [{ invoice_item_id: invX.items[0].id, quantity: 1 }]
  });
  const postedX: any = await returns.postReturn(ownerAt(BR2.id), draftX.id, { reason: 'Returned at Ikeja' });
  assert(postedX.branch_id === BR2.id && postedX.revenue_branch_id === HQ.id, 'return received at BR2, revenue reversed at HQ');
  assert((await freeIn(IKEJA.id)) === freeIkejaBefore + 1, 'stock restored at IKEJA, not MAIN');
  const rX = await reload(invX.id);
  assert(num(rX.recognisedAmount) === 200, 'cross-branch return reduced recognised to 200');

  // Apply unapplied credit to a new open invoice
  const invPayDraft: any = await sales.createInvoice(hq, {
    customer_id: customerId,
    branch_id: HQ.id,
    warehouse_id: MAIN.id,
    fulfilment_mode: 'immediate',
    items: [{ product_id: productId, quantity: 2 }]
  });
  created.invoices.push(invPayDraft.id);
  const invPay: any = await sales.postInvoice(hq, invPayDraft.id);
  const openBal = num((await reload(invPay.id)).balance);
  assert(openBal === 200, 'new invoice has AR 200');
  const credit = await customerPayment.customerUnappliedCredit(businessId, customerId);
  assert(credit.total >= 200, `customer has unapplied credit (>=200, got ${credit.total})`);
  const applyAmt = Math.min(200, credit.total);
  await customerPayment.applyUnappliedCredit(hq, {
    customerId,
    allocations: [{ invoiceId: invPay.id, amount: applyAmt }],
    idempotencyKey: `test-apply-${invPay.id}`
  });
  const rPay = await reload(invPay.id);
  assert(num(rPay.balance) === openBal - applyAmt, 'credit applied to invoice balance');
  const applyReplay = await customerPayment.applyUnappliedCredit(hq, {
    customerId,
    allocations: [{ invoiceId: invPay.id, amount: applyAmt }],
    idempotencyKey: `test-apply-${invPay.id}`
  });
  assert(applyReplay.replayed === true, 'apply credit is idempotent');

  // POS regression: counter sale is recognised, paid and handed over at once.
  console.log('\nPOS regression');
  const walkRep = await prisma.salesRep.findFirst({ where: { businessId, status: 'active', employee: { userId: owner.id } } });
  const pos: any = await sales.createInvoice(hq, {
    customer_id: customerId,
    branch_id: HQ.id,
    warehouse_id: MAIN.id,
    channel: 'pos',
    items: [{ product_id: productId, quantity: 1 }],
    ...(walkRep ? {} : {})
  });
  created.invoices.push(pos.id);
  const rp = await reload(pos.id);
  assert(rp.fulfilmentStatus === 'fulfilled' && rp.paymentStatus === 'paid' && num(rp.recognisedAmount) === 100 && num(rp.balance) === 0, 'POS: fulfilled, recognised 100, paid, no balance');

  // Clearing nets to zero across all test journals.
  console.log('\nInter-branch clearing');
  const all = await prisma.journalLine.findMany({
    where: { accountId: accounts.inter_branch_clearing, journalEntry: { businessId, customerId } }
  });
  const net = all.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  assert(Math.abs(net) < 0.01, `clearing nets to zero across branches (net ${net.toFixed(2)})`);
}

async function cleanup() {
  const ids = created.invoices;
  if (created.customerId) {
    const payments = await prisma.customerPayment.findMany({ where: { customerId: created.customerId }, select: { id: true } });
    await prisma.customerPaymentAllocation.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await prisma.customerPayment.deleteMany({ where: { customerId: created.customerId } });
    await prisma.journalEntry.deleteMany({ where: { customerId: created.customerId } });
  }
  if (ids.length) {
    await prisma.salesReturnItem.deleteMany({ where: { returnRow: { invoiceId: { in: ids } } } });
    await prisma.salesReturn.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.salesCommission.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.appNotification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.deliveryOrder.deleteMany({ where: { salesInvoiceId: { in: ids } } });
    await prisma.salesInvoice.deleteMany({ where: { id: { in: ids } } });
  }
  if (created.productId) {
    await prisma.stockMovement.deleteMany({ where: { productId: created.productId } });
    await prisma.stockLot.deleteMany({ where: { productId: created.productId } });
    await prisma.product.delete({ where: { id: created.productId } }).catch(() => undefined);
  }
  if (created.customerId) await prisma.customer.delete({ where: { id: created.customerId } }).catch(() => undefined);
}

main()
  .catch((err) => {
    failed += 1;
    console.error('\nTest run aborted:', err?.status || '', err?.message || err);
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error('Cleanup failed:', err));
    console.log(`\n${passed} passed, ${failed} failed`);
    await prisma.$disconnect();
    process.exitCode = failed ? 1 : 0;
  });
