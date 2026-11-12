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
import { getDefaultAccountMap } from './accounting.service.js';
import { fulfilAllInTx, invoiceForFulfilment, reserveInvoiceStock } from './fulfilment.service.js';
import { applyPaymentInTx, autoAllocate } from './customer-payment.service.js';
import * as branchAccess from './branch-access.service.js';
import { assertSalesRepInBranch } from './sales-rep.service.js';
import { userHasAnyPermission } from './permission.service.js';
import { issuePickupCode } from './pickup-code.service.js';
import { getCustomerExposure, isWalkInCustomer } from './customer.service.js';
import {
  applyDiscount,
  getBranchDiscountMap,
  getBranchPriceMap
} from './branch-pricing.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const invoiceInclude = {
  customer: true,
  warehouse: true,
  salesRep: {
    include: {
      employee: { select: { id: true, fullName: true, code: true, phone: true, email: true } }
    }
  },
  items: {
    include: {
      product: true,
      variant: true,
      uom: true,
      fulfilmentWarehouse: {
        select: {
          id: true,
          name: true,
          code: true,
          branch: { select: { id: true, name: true, code: true } }
        }
      }
    },
    orderBy: { id: 'asc' as const }
  },
  branch: { select: { id: true, name: true, code: true } },
  sellingBranch: { select: { id: true, name: true, code: true } },
  commissions: true
};

/** Invoices are visible from the revenue branch and from the branch that made the sale. */
function withSellingBranch(scope: { branchId: string } | { branchId: { in: string[] } }) {
  return { OR: [scope, { sellingBranchId: scope.branchId }] };
}

function presentInvoiceSalesRep<T extends { salesRep?: any }>(row: T) {
  if (!row.salesRep) return row;
  return {
    ...row,
    salesRep: {
      ...row.salesRep,
      name: row.salesRep.employee?.fullName ?? null,
      phone: row.salesRep.employee?.phone ?? null,
      email: row.salesRep.employee?.email ?? null
    }
  };
}

async function nextInvoiceNumber(businessId: string, channel: string) {
  const prefix = channel === 'pos' ? 'POS' : 'INV';
  return nextDocNumber(prisma.salesInvoice, businessId, 'invoiceNumber', prefix, 5);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const RESERVATION_DAYS_SETTING = 'sales.reservation_days';
const DEFAULT_RESERVATION_DAYS = 14;

/** Days a confirmed pickup order holds its stock before the sweeper releases it (0 = never). */
export async function reservationDays(businessId: string) {
  const row = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey: RESERVATION_DAYS_SETTING } }
  });
  const days = row ? Number(row.value) : DEFAULT_RESERVATION_DAYS;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_RESERVATION_DAYS;
}

async function productAllowedUomIds(productId: string, baseUomId: string, sellingUomId?: string | null) {
  const conversions = await prisma.productUnitConversion.findMany({ where: { productId } });
  const ids = new Set<string>([baseUomId]);
  if (sellingUomId) ids.add(sellingUomId);
  for (const c of conversions) {
    ids.add(c.fromUomId);
    ids.add(c.toUomId);
  }
  return ids;
}

/**
 * Price attached to the selected UoM (selling-price row, then level/default fallbacks).
 * A branch override for the matched row wins over the global price.
 */
function listUnitPrice(
  product: any,
  bodyItem: any,
  uomId: string,
  index: number,
  branchPrices: Map<string, number>
) {
  const prices: any[] = product.sellingPrices || [];
  const priceOf = (row: any) =>
    branchPrices.has(row.id) ? branchPrices.get(row.id)! : Number(row.unitPrice);
  const sellingPriceId = bodyItem.selling_price_id || bodyItem.sellingPriceId;
  if (sellingPriceId) {
    const row = prices.find((p) => p.id === sellingPriceId && p.isActive);
    if (!row || row.uomId !== uomId) {
      throw httpError(400, `items[${index}].selling_price_id does not match the product and UoM`);
    }
    return priceOf(row);
  }
  const level = String(bodyItem.price_level || bodyItem.priceLevel || 'retail').toLowerCase();
  const match =
    prices.find((p) => p.uomId === uomId && p.priceLevel === level && p.isActive) ||
    prices.find((p) => p.uomId === uomId && p.isDefault && p.isActive) ||
    prices.find((p) => p.uomId === uomId && p.isActive);
  if (match) return priceOf(match);
  if (level === 'wholesale' && product.wholesalePrice != null) return Number(product.wholesalePrice);
  if (level === 'distributor' && product.distributorPrice != null) {
    return Number(product.distributorPrice);
  }
  return Number(product.defaultSellingPrice || product.retailPrice || 0);
}

async function buildInvoiceLines(user: AuthUser, itemsInput: any[], branchId: string) {
  if (!itemsInput.length) throw httpError(400, 'At least one line item is required');
  const canChangePrice = await userHasAnyPermission(user.id, ['sales.change_price']);
  const [branchPrices, branchDiscounts] = await Promise.all([
    getBranchPriceMap(user.businessId, branchId),
    getBranchDiscountMap(user.businessId, branchId)
  ]);
  const lines: {
    productId: string;
    variantId: string | null;
    uomId: string;
    quantity: number;
    unitPrice: number;
    grossUnitPrice: number | null;
    discountPercent: number | null;
    lineTotal: number;
    priceLevel: string | null;
  }[] = [];

  for (const [i, item] of itemsInput.entries()) {
    const productId = item.product_id || item.productId;
    if (!productId) throw httpError(400, `items[${i}].product_id is required`);
    const product = await prisma.product.findFirst({
      where: { id: productId, businessId: user.businessId },
      include: { variants: true, sellingPrices: true, conversions: true }
    });
    if (!product) throw httpError(400, `items[${i}] product not found`);

    let variantId = item.variant_id || item.variantId || null;
    if (!variantId) {
      const def = product.variants.find((v) => v.isDefault) || product.variants[0];
      variantId = def?.id || null;
    }

    const allowed = await productAllowedUomIds(
      product.id,
      product.baseUomId,
      product.sellingUomId
    );
    for (const sp of product.sellingPrices || []) {
      if (sp.isActive !== false && sp.uomId) allowed.add(sp.uomId);
    }
    const uomId =
      item.uom_id || item.uomId || product.sellingUomId || product.baseUomId;
    if (!uomId || !allowed.has(uomId)) {
      throw httpError(
        400,
        `items[${i}].uom_id must be a product selling-price, base, selling, or packaging UoM`
      );
    }

    const qty = Number(item.quantity);
    if (!qty || qty <= 0) throw httpError(400, `items[${i}].quantity must be > 0`);
    const grossPrice = listUnitPrice(product, item, uomId, i, branchPrices);
    const discount = branchDiscounts.get(productId) ?? null;
    const listPrice = applyDiscount(grossPrice, discount);
    const requested = item.unit_price ?? item.unitPrice;
    let unitPrice = listPrice;
    let manualPrice = false;
    if (requested != null && requested !== '') {
      const requestedPrice = Number(requested);
      if (!Number.isFinite(requestedPrice)) {
        throw httpError(400, `items[${i}].unit_price is invalid`);
      }
      if (Math.abs(requestedPrice - listPrice) > 0.0001) {
        if (!canChangePrice) {
          throw httpError(
            403,
            `items[${i}]: you do not have permission to change the selling price (sales.change_price)`
          );
        }
        unitPrice = requestedPrice;
        manualPrice = true;
      }
    }
    if (unitPrice < 0) throw httpError(400, `items[${i}].unit_price cannot be negative`);
    const discounted = Boolean(discount) && !manualPrice;

    lines.push({
      productId,
      variantId,
      uomId,
      quantity: qty,
      unitPrice,
      grossUnitPrice: discounted ? grossPrice : null,
      discountPercent: discounted ? discount : null,
      lineTotal: roundMoney(qty * unitPrice),
      priceLevel: item.price_level || item.priceLevel || 'retail'
    });
  }
  return lines;
}

export async function listInvoices(
  user: AuthUser,
  opts?: { status?: string; channel?: string } & BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.salesInvoice.findMany({
    where: {
      businessId: user.businessId,
      ...withSellingBranch(scope),
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.channel ? { channel: opts.channel } : {})
    },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows.map((r) => redactPickupCode(presentInvoiceSalesRep(r))));
}

/** Throws 403 unless the user can see the selling, revenue or any fulfilling branch of the invoice. */
/** The pickup code is for the customer; warehouse staff must hear it from the collector. */
function redactPickupCode<T extends { pickupCode?: string | null }>(row: T): T {
  return { ...row, pickupCode: null, hasPickupCode: Boolean(row.pickupCode) };
}

async function canSeePickupCode(user: AuthUser, inv: { branchId: string | null; sellingBranchId: string | null }) {
  if (branchAccess.canAccessAllBranches(user)) return true;
  const mine = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  return [inv.sellingBranchId, inv.branchId].some((b) => b && mine.includes(b));
}

export async function assertInvoiceVisible(
  user: AuthUser,
  branchIds: (string | null | undefined)[]
) {
  const related = branchIds.filter((b): b is string => Boolean(b));
  if (!related.length || branchAccess.canAccessAllBranches(user)) return;
  const authorised = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  if (!related.some((b) => authorised.includes(b))) {
    throw httpError(403, 'Branch access denied or revoked');
  }
}

export async function getInvoice(user: AuthUser, id: string) {
  const row = await prisma.salesInvoice.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      ...invoiceInclude,
      items: {
        ...invoiceInclude.items,
        include: {
          ...invoiceInclude.items.include,
          reservations: {
            include: {
              warehouse: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  branch: { select: { id: true, name: true, code: true } }
                }
              },
              lot: { select: { batchNumber: true, expiryDate: true } }
            },
            orderBy: { createdAt: 'asc' }
          }
        }
      },
      warehouse: { include: { branch: { select: { id: true, name: true, code: true } } } },
      allocations: { include: { payment: true } },
      fulfilments: {
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          items: {
            select: {
              invoiceItemId: true,
              plannedQuantity: true,
              pickedQuantity: true,
              shortQuantity: true,
              damagedQuantity: true,
              quantity: true,
              recognisedAmount: true
            }
          },
          deliveryOrder: { select: { id: true, deliveryNumber: true, status: true, receivedBy: true } }
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  });
  if (!row) throw httpError(404, 'Invoice not found');
  await assertInvoiceVisible(user, [
    row.branchId,
    row.sellingBranchId,
    row.warehouse.branchId,
    ...row.items.map((i) => i.fulfilmentWarehouse?.branch.id),
    ...row.items.flatMap((i) => i.reservations.map((r) => r.warehouse.branch.id))
  ]);
  const presented = presentInvoiceSalesRep(row);
  return serialize((await canSeePickupCode(user, row)) ? { ...presented, hasPickupCode: Boolean(row.pickupCode) } : redactPickupCode(presented));
}

export async function createInvoice(user: AuthUser, body: Record<string, any>) {
  const customerId = requireString(body.customer_id || body.customerId, 'customer_id');
  const warehouseId = requireString(body.warehouse_id || body.warehouseId, 'warehouse_id');
  const channel = String(body.channel || 'sales').toLowerCase() === 'pos' ? 'pos' : 'sales';
  const itemsInput: any[] = Array.isArray(body.items) ? body.items : [];

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId, status: 'active' }
  });
  if (!customer) throw httpError(400, 'Invalid customer_id');

  const sellingBranchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const revenueInput = body.revenue_branch_id || body.revenueBranchId || null;
  let branchId = sellingBranchId;
  if (revenueInput && revenueInput !== sellingBranchId) {
    if (!(await userHasAnyPermission(user.id, ['sales.revenue_branch']))) {
      throw httpError(
        403,
        'You do not have permission to book revenue to another branch (sales.revenue_branch)'
      );
    }
    branchId = (await branchAccess.assertBranchActive(user.businessId, revenueInput)).id;
  }

  const requestedMode = String(body.fulfilment_mode || body.fulfilmentMode || '').toLowerCase();
  const fulfilmentMode =
    channel !== 'pos' && (requestedMode === 'pickup' || requestedMode === 'delivery') ? requestedMode : 'immediate';
  const deliveryAddress =
    fulfilmentMode === 'delivery'
      ? String(body.delivery_address || body.deliveryAddress || '').trim() ||
        [customer.addressLine1, customer.city].filter(Boolean).join(', ')
      : '';
  if (fulfilmentMode === 'delivery' && !deliveryAddress) {
    throw httpError(400, 'delivery_address is required for delivery orders (the customer has no address on file)');
  }
  const collectorsInput: any[] = Array.isArray(body.authorised_collectors || body.authorisedCollectors)
    ? body.authorised_collectors || body.authorisedCollectors
    : [];
  const authorisedCollectors = collectorsInput
    .map((c) => ({ name: String(c?.name || '').trim(), phone: String(c?.phone || '').trim() || null }))
    .filter((c) => c.name)
    .slice(0, 10);

  const activeWarehouse = async (id: string, label: string) => {
    const wh = await prisma.warehouse.findFirst({
      where: { id, businessId: user.businessId, isActive: true },
      include: { branch: { select: { isActive: true, name: true } } }
    });
    if (!wh) throw httpError(400, `${label}: invalid warehouse`);
    if (!wh.branch.isActive) throw httpError(400, `${label}: branch ${wh.branch.name} is inactive`);
    if (fulfilmentMode === 'immediate' && wh.branchId !== sellingBranchId) {
      throw httpError(
        400,
        `${label}: goods handed over at the point of sale must come from a warehouse in this branch. Choose "Pickup later" or "Deliver" to fulfil from another branch.`
      );
    }
    return wh;
  };

  const warehouse = await activeWarehouse(warehouseId, 'warehouse_id');
  const lineWarehouseIds: (string | null)[] = [];
  const linePlans: ({ warehouse_id: string; quantity: number }[] | null)[] = [];
  for (const [i, item] of itemsInput.entries()) {
    const whId = item.warehouse_id || item.warehouseId || null;
    lineWarehouseIds.push(
      !whId || whId === warehouse.id ? null : (await activeWarehouse(whId, `items[${i}].warehouse_id`)).id
    );

    const rawPlan: any[] = Array.isArray(item.allocations) ? item.allocations : [];
    const plan: { warehouse_id: string; quantity: number }[] = [];
    for (const [j, a] of rawPlan.entries()) {
      const qty = Number(a.quantity);
      if (!Number.isFinite(qty) || qty < 0) {
        throw httpError(400, `items[${i}].allocations[${j}].quantity is invalid`);
      }
      if (!qty) continue;
      const allocWh = requireString(a.warehouse_id || a.warehouseId, `items[${i}].allocations[${j}].warehouse_id`);
      await activeWarehouse(allocWh, `items[${i}].allocations[${j}]`);
      const existing = plan.find((p) => p.warehouse_id === allocWh);
      if (existing) existing.quantity += qty;
      else plan.push({ warehouse_id: allocWh, quantity: qty });
    }
    const planned = plan.reduce((s, p) => s + p.quantity, 0);
    if (planned > Number(item.quantity) + 1e-6) {
      throw httpError(400, `items[${i}]: allocated quantity exceeds the ordered quantity`);
    }
    linePlans.push(plan.length ? plan : null);
  }

  const isWalkIn = isWalkInCustomer(customer);

  const myRep = await prisma.salesRep.findFirst({
    where: {
      businessId: user.businessId,
      status: 'active',
      employee: { userId: user.id }
    },
    select: { id: true }
  });

  let salesRepId: string | null = body.sales_rep_id || body.salesRepId || null;

  if (isWalkIn) {
    if (!myRep) {
      throw httpError(400, 'Only sales representatives can sell to walk-in customers');
    }
    if (salesRepId && salesRepId !== myRep.id) {
      throw httpError(
        400,
        'Walk-in sales must be attributed to the logged-in sales representative'
      );
    }
    salesRepId = myRep.id;
  }

  if (salesRepId) {
    await assertSalesRepInBranch(user.businessId, salesRepId, sellingBranchId);
  }

  const lines = await buildInvoiceLines(user, itemsInput, sellingBranchId);
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const customerDiscountPct = Number(customer.discountPercent || 0);
  const discountAmount =
    customerDiscountPct > 0 ? roundMoney((subtotal * customerDiscountPct) / 100) : 0;
  const taxAmount = roundMoney(Number(body.tax_amount ?? body.taxAmount ?? 0));
  const totalAmount = roundMoney(subtotal - discountAmount + taxAmount);
  const invoiceNumber =
    body.invoice_number || body.invoiceNumber || (await nextInvoiceNumber(user.businessId, channel));

  const created = await prisma.salesInvoice.create({
    data: {
      id: shortId('inv'),
      businessId: user.businessId,
      customerId,
      warehouseId: warehouse.id,
      branchId,
      sellingBranchId,
      salesRepId,
      invoiceNumber,
      channel,
      status: 'draft',
      fulfilmentMode,
      fulfilmentStatus: 'pending',
      recognitionPolicy: 'at_fulfilment',
      paymentStatus: 'open',
      deliveryAddress: deliveryAddress || null,
      deliveryContact:
        fulfilmentMode === 'delivery' ? body.delivery_contact || body.deliveryContact || customer.name : null,
      deliveryPhone:
        fulfilmentMode === 'delivery' ? body.delivery_phone || body.deliveryPhone || customer.phone || null : null,
      authorisedCollectors: authorisedCollectors.length ? authorisedCollectors : undefined,
      invoiceDate: body.invoice_date || body.invoiceDate
        ? new Date(body.invoice_date || body.invoiceDate)
        : new Date(),
      dueDate:
        body.due_date || body.dueDate
          ? new Date(body.due_date || body.dueDate)
          : customer.paymentTermsDays
            ? addDays(new Date(), customer.paymentTermsDays)
            : null,
      notes: body.notes || null,
      subtotal: toDec(subtotal),
      discountPercent: customerDiscountPct > 0 ? toDec(customerDiscountPct) : null,
      discountAmount: toDec(discountAmount),
      taxAmount: toDec(taxAmount),
      totalAmount: toDec(totalAmount),
      amountPaid: toDec(0),
      balance: toDec(0),
      createdById: user.id,
      items: {
        create: lines.map((l, idx) => ({
          id: shortId('sii'),
          fulfilmentWarehouseId: lineWarehouseIds[idx] ?? null,
          allocationPlan: linePlans[idx] ?? undefined,
          productId: l.productId,
          variantId: l.variantId,
          uomId: l.uomId,
          quantity: toDec(l.quantity),
          unitPrice: toDec(l.unitPrice),
          grossUnitPrice: l.grossUnitPrice != null ? toDec(l.grossUnitPrice) : null,
          discountPercent: l.discountPercent != null ? toDec(l.discountPercent) : null,
          lineTotal: toDec(l.lineTotal),
          priceLevel: l.priceLevel
        }))
      }
    },
    include: invoiceInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: channel === 'pos' ? 'pos' : 'sales',
    entityType: 'SalesInvoice',
    entityId: created.id,
    summary: `Created ${channel} invoice ${created.invoiceNumber}`
  });

  const autoPost = body.post === true || body.pay_now === true || body.payNow === true || channel === 'pos';
  if (autoPost) {
    return postInvoice(user, created.id, {
      pay_now: body.pay_now ?? body.payNow ?? channel === 'pos',
      payment_method: body.payment_method || body.paymentMethod || (channel === 'pos' ? 'cash' : undefined),
      account_id: body.account_id || body.accountId,
      amount_paid: body.amount_paid ?? body.amountPaid,
      allow_backorder: body.allow_backorder ?? body.allowBackorder,
      override_credit: body.override_credit ?? body.overrideCredit,
      override_reason: body.override_reason ?? body.overrideReason
    });
  }

  return serialize(presentInvoiceSalesRep(created));
}

export type ConfirmOptions = {
  pay_now?: boolean;
  payment_method?: string;
  account_id?: string;
  /** Amount collected now (defaults to the full order value when pay_now) */
  amount_paid?: number | string;
  allow_backorder?: boolean;
  override_credit?: boolean;
  override_reason?: string;
};

/**
 * Confirm a draft order: reserve stock (split across warehouses as planned) and credit.
 * No revenue is booked here — revenue, receivable and COGS post per hand-over. A counter sale
 * ("immediate") hands everything over in the same transaction. Money collected before hand-over
 * is held as a customer deposit.
 */
export async function postInvoice(user: AuthUser, id: string, opts: ConfirmOptions = {}) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id, businessId: user.businessId },
    include: { items: true, customer: true, salesRep: true, warehouse: true }
  });
  if (!invoice) throw httpError(404, 'Invoice not found');
  if (invoice.status !== 'draft') throw httpError(400, 'Only draft invoices can be confirmed');
  if (!invoice.items.length) throw httpError(400, 'Invoice has no lines');

  const sellingBranchId = invoice.sellingBranchId || invoice.branchId;
  if (!sellingBranchId) throw httpError(400, 'Invoice has no selling branch');
  await branchAccess.assertBranchMembership(user, sellingBranchId);

  if (invoice.customer.status !== 'active') {
    throw httpError(400, `Customer ${invoice.customer.name} is disabled; enable it before confirming`);
  }

  const accountMap = await getDefaultAccountMap(user.businessId);
  for (const key of ['sales_revenue', 'cogs', 'inventory', 'accounts_receivable', 'cash', 'bank']) {
    if (!accountMap[key]) throw httpError(400, `Default account "${key}" is not configured`);
  }

  const immediate = invoice.fulfilmentMode === 'immediate';
  const totalAmount = Number(invoice.totalAmount);
  const payNow = Boolean(opts.pay_now) || invoice.channel === 'pos';
  const method = String(opts.payment_method || (payNow ? 'cash' : '')).toLowerCase();
  const settleAccountId = payNow
    ? opts.account_id || (method === 'bank' || method === 'transfer' ? accountMap.bank : accountMap.cash)
    : null;
  let payAmount = 0;
  if (payNow) {
    payAmount =
      opts.amount_paid != null && opts.amount_paid !== ''
        ? roundMoney(Number(opts.amount_paid))
        : totalAmount;
    if (!Number.isFinite(payAmount) || payAmount < 0) throw httpError(400, 'amount_paid is invalid');
    if (payAmount > totalAmount + 0.01) throw httpError(400, 'amount_paid exceeds the order total');
    if (invoice.channel === 'pos' && Math.abs(payAmount - totalAmount) > 0.01) {
      throw httpError(400, 'POS sales must be paid in full');
    }
  }
  if (!immediate && payAmount > 0 && !accountMap.customer_deposits) {
    throw httpError(400, 'Default account "customer_deposits" is not configured');
  }

  const wantsOverride = opts.override_credit === true || String(opts.override_credit) === 'true';
  const overrideReason = String(opts.override_reason || '').trim();
  if (wantsOverride) {
    if (!(await userHasAnyPermission(user.id, ['sales.override_credit_limit']))) {
      throw httpError(403, 'You do not have permission to override credit limits (sales.override_credit_limit)');
    }
    if (!overrideReason) throw httpError(400, 'override_reason is required to override the credit limit');
  }
  const allowBackorder =
    !immediate && (opts.allow_backorder === true || String(opts.allow_backorder) === 'true');
  const days = invoice.fulfilmentMode === 'pickup' ? await reservationDays(user.businessId) : 0;

  let overridden = false;
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${invoice.customerId} FOR UPDATE`;

      const credit = roundMoney(totalAmount - payAmount);
      if (credit > 0.01 && invoice.customer.creditLimit != null) {
        const limit = Number(invoice.customer.creditLimit);
        const exposure = await getCustomerExposure(tx, user.businessId, invoice.customerId, invoice.id);
        if (roundMoney(exposure.total + credit) > limit) {
          if (!wantsOverride) {
            const available = Math.max(0, roundMoney(limit - exposure.total));
            throw httpError(
              400,
              `Credit limit exceeded for ${invoice.customer.name}: limit ${limit.toLocaleString()}, ` +
                `receivable ${exposure.receivable.toLocaleString()}, open orders ${exposure.openOrders.toLocaleString()}, ` +
                `available ${available.toLocaleString()}, this order on credit ${credit.toLocaleString()}. ` +
                'Collect a payment or deposit, reduce the order, or ask a manager to override.'
            );
          }
          overridden = true;
        }
      }

      const fulfilmentInvoice = (await invoiceForFulfilment(tx, user.businessId, invoice.id))!;
      await reserveInvoiceStock(tx, user, fulfilmentInvoice, {
        restrictToBranchId: immediate ? sellingBranchId : null,
        allowBackorder,
        useSavedPlan: true
      });

      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'posted',
          recognitionPolicy: 'at_fulfilment',
          fulfilmentStatus: 'pending',
          paymentStatus: 'open',
          amountPaid: toDec(0),
          balance: toDec(0),
          reservationExpiresAt: days > 0 ? addDays(new Date(), days) : null,
          creditOverrideById: overridden ? user.id : null,
          creditOverrideReason: overridden ? overrideReason : null,
          postedAt: new Date(),
          postedById: user.id
        }
      });
      if (invoice.fulfilmentMode === 'pickup') {
        await issuePickupCode(tx, user.businessId, invoice.id);
      }

      if (invoice.salesRepId && invoice.salesRep) {
        const pct = Number(invoice.salesRep.commissionPercent || 0);
        if (pct > 0) {
          await tx.salesCommission.create({
            data: {
              id: shortId('scm'),
              businessId: user.businessId,
              branchId: invoice.branchId,
              salesRepId: invoice.salesRepId,
              invoiceId: invoice.id,
              baseAmount: toDec(0),
              commissionPercent: toDec(pct),
              commissionAmount: toDec(0),
              status: 'accrued'
            }
          });
        }
      }

      const collect = async () => {
        if (!(payAmount > 0)) return;
        await applyPaymentInTx(tx, user, {
          customerId: invoice.customerId,
          customerName: invoice.customer.name,
          receivingBranchId: sellingBranchId,
          amount: payAmount,
          method: method || 'cash',
          accountId: settleAccountId!,
          allocations: [{ invoiceId: invoice.id, amount: payAmount }],
          reference: invoice.invoiceNumber,
          notes: immediate
            ? `Settlement at sale ${invoice.invoiceNumber}`
            : `Deposit on order ${invoice.invoiceNumber}`
        });
      };

      if (immediate) {
        const reloaded = (await invoiceForFulfilment(tx, user.businessId, invoice.id))!;
        await fulfilAllInTx(tx, user, reloaded, {
          collectedBy: invoice.customer.name,
          notes: `Handed over at sale ${invoice.invoiceNumber}`
        });
        await collect();
      } else {
        await collect();
      }

      return tx.salesInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: invoiceInclude
      });
    },
    { timeout: 30000, maxWait: 10000 }
  );

  await writeAudit({
    user,
    action: 'post',
    module: invoice.channel === 'pos' ? 'pos' : 'sales',
    entityType: 'SalesInvoice',
    entityId: id,
    summary:
      `Confirmed ${invoice.invoiceNumber}` +
      (immediate
        ? ' (handed over)'
        : invoice.fulfilmentMode === 'delivery'
          ? ' (awaiting delivery)'
          : ' (awaiting pickup)') +
      (payAmount > 0 ? ` — collected ${payAmount}` : '') +
      (overridden ? ` — credit limit overridden: ${overrideReason}` : '')
  });

  return serialize(presentInvoiceSalesRep(result));
}

export async function listCustomerPayments(
  user: AuthUser,
  customerId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.customerPayment.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(customerId ? { customerId } : {})
    },
    include: {
      customer: true,
      account: true,
      allocations: { include: { invoice: true } }
    },
    orderBy: { paymentDate: 'desc' }
  });
  return serialize(rows);
}

/**
 * Receive a customer payment in the user's branch. It may settle invoices of any branch (linked
 * through inter-branch clearing); an amount allocated beyond the recognised receivable of an
 * open order is held as a deposit.
 */
export async function recordCustomerPayment(user: AuthUser, body: Record<string, any>) {
  const customerId = requireString(body.customer_id || body.customerId, 'customer_id');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be greater than 0');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) throw httpError(400, 'Invalid customer_id');

  const accountMap = await getDefaultAccountMap(user.businessId);
  const method = String(body.method || 'cash').toLowerCase();
  const payAccountId =
    body.account_id ||
    body.accountId ||
    (method === 'bank' || method === 'transfer' ? accountMap.bank : accountMap.cash);
  if (!payAccountId) throw httpError(400, 'Payment GL account (cash/bank) is not configured');

  const allowUnallocated = body.allow_unallocated === true || body.allowUnallocated === true;
  const allocationsInput: any[] = Array.isArray(body.allocations) ? body.allocations : [];
  let allocations: { invoiceId: string; amount: number }[] = [];
  if (allocationsInput.length) {
    for (const [i, a] of allocationsInput.entries()) {
      const invoiceId = a.invoice_id || a.invoiceId;
      const allocAmt = roundMoney(Number(a.amount));
      if (!invoiceId || !allocAmt || allocAmt <= 0) {
        throw httpError(400, `allocations[${i}] requires invoice_id and amount`);
      }
      allocations.push({ invoiceId, amount: allocAmt });
    }
  } else {
    allocations = await autoAllocate(user.businessId, customerId, amount);
    if (!allocations.length && !allowUnallocated) {
      throw httpError(400, 'No open customer invoices to allocate this payment against');
    }
  }

  const { payment, replayed } = await prisma.$transaction(
    (tx) =>
      applyPaymentInTx(tx, user, {
        customerId,
        customerName: customer.name,
        receivingBranchId: branchId,
        amount,
        method,
        accountId: payAccountId,
        allocations,
        allowUnallocated,
        reference: body.reference || null,
        notes: body.notes || null,
        paymentDate:
          body.payment_date || body.paymentDate
            ? new Date(body.payment_date || body.paymentDate)
            : undefined,
        idempotencyKey: body.idempotency_key || body.idempotencyKey || null
      }),
    { timeout: 30000, maxWait: 10000 }
  );

  if (!replayed) {
    await writeAudit({
      user,
      action: 'post',
      module: 'sales',
      entityType: 'CustomerPayment',
      entityId: payment.id,
      summary: `Recorded customer payment ${payment.paymentNumber} (${amount})`
    });
  }

  return serialize(payment);
}
