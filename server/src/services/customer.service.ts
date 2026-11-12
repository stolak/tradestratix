import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { userHasAnyPermission } from './permission.service.js';
import { partnerLineBalances } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type PurchaseFilter = { branchId?: string | null; from?: string | null; to?: string | null };

/** System walk-in / anonymous cash customer — not editable in the directory; sales require a sales rep. */
export function isWalkInCustomer(c: { customerType?: string | null; code?: string | null } | null | undefined) {
  if (!c) return false;
  return (
    String(c.customerType || '').toLowerCase() === 'walk_in' ||
    String(c.code || '').toUpperCase() === 'WALK-IN'
  );
}

const WALK_IN_EXCLUDE = {
  AND: [
    { customerType: { not: 'walk_in' } },
    { OR: [{ code: null }, { code: { not: 'WALK-IN' } }] }
  ]
};

function assertMutableCustomer(c: { customerType?: string | null; code?: string | null; name?: string | null }) {
  if (isWalkInCustomer(c)) {
    throw httpError(
      400,
      'Walk-in is a system customer — it cannot be created, edited or deleted. Use it only on sales attributed to a sales representative.'
    );
  }
}

/** `YYYY-MM-DD` bounds; `to` is inclusive of the whole day. */
function invoiceDateRange(from?: string | null, to?: string | null) {
  const range: { gte?: Date; lt?: Date } = {};
  if (from) {
    const d = new Date(`${from}T00:00:00`);
    if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid from date');
    range.gte = d;
  }
  if (to) {
    const d = new Date(`${to}T00:00:00`);
    if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid to date');
    d.setDate(d.getDate() + 1);
    range.lt = d;
  }
  if (range.gte && range.lt && range.gte >= range.lt) throw httpError(400, 'from must be on or before to');
  return range.gte || range.lt ? { invoiceDate: range } : {};
}

async function purchaseScope(user: AuthUser, filter: PurchaseFilter) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filter.branchId || null,
    allowConsolidated: !filter.branchId
  });
  return {
    businessId: user.businessId,
    status: 'posted',
    ...scope,
    ...invoiceDateRange(filter.from, filter.to)
  };
}

/**
 * Current customer balance from journal *lines* stamped with customer_id (AR control lines).
 * Stable if the default accounts_receivable mapping changes later.
 */
async function ledgerBalances(businessId: string, customerId?: string) {
  return partnerLineBalances(businessId, 'customer', customerId);
}

export async function customerBalances(
  user: AuthUser,
  filter: PurchaseFilter & { q?: string | null }
) {
  const where = await purchaseScope(user, filter);
  const [customers, balances, purchases] = await Promise.all([
    prisma.customer.findMany({
      where: {
        businessId: user.businessId,
        ...WALK_IN_EXCLUDE,
        ...(filter.q
          ? {
              OR: [
                { name: { contains: filter.q } },
                { code: { contains: filter.q } },
                { phone: { contains: filter.q } }
              ]
            }
          : {})
      },
      orderBy: { name: 'asc' }
    }),
    ledgerBalances(user.businessId),
    prisma.salesInvoice.groupBy({
      by: ['customerId'],
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
      _max: { invoiceDate: true }
    })
  ]);
  const purchaseMap = new Map(purchases.map((p) => [p.customerId, p]));
  const openOrders = await openOrderExposure(prisma, user.businessId, customers.map((c) => c.id));

  const rows = customers.map((c) => {
    const p = purchaseMap.get(c.id);
    const balance = balances.get(c.id) ?? 0;
    const open = openOrders.get(c.id) ?? 0;
    const limit = c.creditLimit == null ? null : Number(c.creditLimit);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      customer_type: c.customerType,
      status: c.status,
      phone: c.phone,
      credit_limit: limit,
      available_credit: limit == null ? null : roundMoney(limit - balance - open),
      open_order_value: open,
      balance,
      purchases_total: roundMoney(Number(p?._sum.totalAmount || 0)),
      purchases_count: p?._count._all ?? 0,
      last_purchase_at: p?._max.invoiceDate ?? null
    };
  });

  return serialize({
    filter: {
      branch_id: filter.branchId || null,
      from: filter.from || null,
      to: filter.to || null
    },
    totals: {
      balance: roundMoney(rows.reduce((s, r) => s + r.balance, 0)),
      purchases_total: roundMoney(rows.reduce((s, r) => s + r.purchases_total, 0)),
      purchases_count: rows.reduce((s, r) => s + r.purchases_count, 0)
    },
    customers: rows
  });
}

export async function customerInvoices(user: AuthUser, customerId: string, filter: PurchaseFilter) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) throw httpError(404, 'Customer not found');
  const where = await purchaseScope(user, filter);
  const [invoices, balances] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { ...where, customerId },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        salesRep: { include: { employee: { select: { fullName: true } } } },
        _count: { select: { items: true } }
      },
      orderBy: { invoiceDate: 'desc' }
    }),
    ledgerBalances(user.businessId, customerId)
  ]);
  return serialize({
    customer: {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      credit_limit: customer.creditLimit == null ? null : Number(customer.creditLimit),
      balance: balances.get(customerId) ?? 0
    },
    purchases_total: roundMoney(invoices.reduce((s, i) => s + Number(i.totalAmount), 0)),
    invoices: invoices.map((i) => {
      const payable = roundMoney(
        Number(i.totalAmount) - Number(i.cancelledAmount || 0) - Number(i.amountPaid)
      );
      return {
        id: i.id,
        invoice_number: i.invoiceNumber,
        invoice_date: i.invoiceDate,
        status: i.status,
        channel: i.channel,
        branch: i.branch,
        sales_rep_name: i.salesRep?.employee?.fullName ?? null,
        lines: i._count.items,
        total_amount: i.totalAmount,
        cancelled_amount: i.cancelledAmount,
        amount_paid: i.amountPaid,
        /** Recognised AR still open on this invoice. */
        balance: i.balance,
        /** Commercial amount still payable (includes unfulfilled / prepaid gap). */
        amount_due: Math.max(0, payable),
        deposit_held: i.depositHeld,
        payment_status: i.paymentStatus,
        fulfilment_status: i.fulfilmentStatus,
        recognised_amount: i.recognisedAmount
      };
    })
  });
}

const CUSTOMER_STATUSES = ['active', 'inactive'];

/** Sum of open balances on posted invoices, keyed by customer id. */
async function outstandingByCustomer(businessId: string, customerIds?: string[]) {
  const rows = await prisma.salesInvoice.groupBy({
    by: ['customerId'],
    where: {
      businessId,
      status: 'posted',
      balance: { gt: 0 },
      ...(customerIds ? { customerId: { in: customerIds } } : {})
    },
    _sum: { balance: true }
  });
  return new Map(rows.map((r) => [r.customerId, roundMoney(Number(r._sum.balance || 0))]));
}

export async function getCustomerOutstanding(businessId: string, customerId: string) {
  const map = await outstandingByCustomer(businessId, [customerId]);
  return map.get(customerId) ?? 0;
}

/**
 * Confirmed order value not yet handed over and not covered by a deposit. It counts against the credit
 * limit alongside the recognised receivable.
 */
export async function openOrderExposure(
  client: Prisma.TransactionClient | typeof prisma,
  businessId: string,
  customerIds: string[],
  excludeInvoiceId?: string
) {
  const rows = await client.salesInvoice.findMany({
    where: {
      businessId,
      customerId: { in: customerIds },
      status: 'posted',
      recognitionPolicy: 'at_fulfilment',
      fulfilmentStatus: { not: 'fulfilled' },
      ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {})
    },
    select: {
      customerId: true,
      totalAmount: true,
      cancelledAmount: true,
      recognisedAmount: true,
      depositHeld: true
    }
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const open = Math.max(
      0,
      Number(r.totalAmount) - Number(r.cancelledAmount) - Number(r.recognisedAmount) - Number(r.depositHeld)
    );
    map.set(r.customerId, roundMoney((map.get(r.customerId) || 0) + open));
  }
  return map;
}

export async function getCustomerExposure(
  client: Prisma.TransactionClient | typeof prisma,
  businessId: string,
  customerId: string,
  excludeInvoiceId?: string
) {
  const [ar, open] = await Promise.all([
    client.salesInvoice.aggregate({
      where: { businessId, customerId, status: 'posted', balance: { gt: 0 } },
      _sum: { balance: true }
    }),
    openOrderExposure(client, businessId, [customerId], excludeInvoiceId)
  ]);
  const receivable = roundMoney(Number(ar._sum.balance || 0));
  const openOrders = open.get(customerId) ?? 0;
  return { receivable, openOrders, total: roundMoney(receivable + openOrders) };
}

function withCredit<T extends { id: string; creditLimit: unknown }>(
  row: T,
  outstanding: number,
  openOrders = 0
) {
  const limit = row.creditLimit == null ? null : Number(row.creditLimit);
  return {
    ...row,
    outstandingBalance: outstanding,
    openOrderValue: openOrders,
    availableCredit: limit == null ? null : roundMoney(limit - outstanding - openOrders)
  };
}

/** `''`/null clears the limit (unlimited credit). */
function parseCreditLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, 'credit_limit must be 0 or more (blank = unlimited)');
  return roundMoney(n);
}

function parseDiscount(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n >= 100) {
    throw httpError(400, 'discount_percent must be between 0 and 100');
  }
  return n === 0 ? null : Math.round(n * 10000) / 10000;
}

async function assertCanSetCredit(user: AuthUser) {
  if (!(await userHasAnyPermission(user.id, ['customers.credit']))) {
    throw httpError(403, 'You need the "customers.credit" privilege to set credit limits or discounts');
  }
}

export async function listCustomers(
  businessId: string,
  q?: string,
  status?: string,
  opts?: { includeWalkIn?: boolean }
) {
  const rows = await prisma.customer.findMany({
    where: {
      businessId,
      ...(opts?.includeWalkIn ? {} : WALK_IN_EXCLUDE),
      ...(status && CUSTOMER_STATUSES.includes(status) ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { phone: { contains: q } },
              { email: { contains: q } }
            ]
          }
        : {})
    },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { invoices: true, payments: true, noteRows: true, deliveries: true, journalEntries: true }
      }
    }
  });
  const [outstanding, open] = await Promise.all([
    outstandingByCustomer(businessId),
    openOrderExposure(prisma, businessId, rows.map((r) => r.id))
  ]);
  return serialize(
    rows.map((r) => withCredit(r, outstanding.get(r.id) ?? 0, open.get(r.id) ?? 0))
  );
}

export async function getCustomer(businessId: string, id: string) {
  const row = await prisma.customer.findFirst({
    where: { id, businessId },
    include: {
      noteRows: { orderBy: { createdAt: 'desc' }, take: 20 },
      invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
      payments: { orderBy: { createdAt: 'desc' }, take: 20 }
    }
  });
  if (!row) throw httpError(404, 'Customer not found');
  const exposure = await getCustomerExposure(prisma, businessId, id);
  return serialize(withCredit(row, exposure.receivable, exposure.openOrders));
}

export async function createCustomer(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = body.code ? String(body.code).trim() : null;
  const customerType = String(body.customer_type || body.customerType || 'retail');
  assertMutableCustomer({ customerType, code, name });
  if (String(code || '').toUpperCase() === 'WALK-IN') {
    throw httpError(400, 'WALK-IN is a reserved system customer code');
  }
  const rawLimit = body.credit_limit ?? body.creditLimit;
  const rawDiscount = body.discount_percent ?? body.discountPercent;
  const creditLimit = parseCreditLimit(rawLimit);
  const discountPercent = parseDiscount(rawDiscount);
  if (creditLimit != null || discountPercent != null) await assertCanSetCredit(user);

  try {
    const row = await prisma.customer.create({
      data: {
        id: shortId('cus'),
        businessId: user.businessId,
        name,
        code,
        contactPerson: body.contact_person || body.contactPerson || null,
        email: body.email || null,
        phone: body.phone || null,
        addressLine1: body.address_line1 || body.addressLine1 || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || 'NG',
        taxId: body.tax_id || body.taxId || null,
        paymentTermsDays: Number(body.payment_terms_days ?? body.paymentTermsDays ?? 0),
        creditLimit,
        discountPercent,
        customerType,
        notes: body.notes || null,
        status: 'active',
        createdById: user.id
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'customers',
      entityType: 'Customer',
      entityId: row.id,
      summary: `Created customer ${name}`
    });
    return serialize(withCredit(row, 0));
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Customer code already exists');
    throw err;
  }
}

export async function updateCustomer(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.customer.findFirst({ where: { id, businessId: user.businessId } });
  if (!existing) throw httpError(404, 'Customer not found');
  assertMutableCustomer(existing);
  if (
    body.customer_type === 'walk_in' ||
    body.customerType === 'walk_in' ||
    String(body.code || '').toUpperCase() === 'WALK-IN'
  ) {
    throw httpError(400, 'Cannot convert a customer to the system Walk-in account');
  }

  const data: Record<string, unknown> = { updatedById: user.id };
  const map: Record<string, string> = {
    name: 'name',
    code: 'code',
    contact_person: 'contactPerson',
    contactPerson: 'contactPerson',
    email: 'email',
    phone: 'phone',
    address_line1: 'addressLine1',
    addressLine1: 'addressLine1',
    city: 'city',
    state: 'state',
    country: 'country',
    tax_id: 'taxId',
    taxId: 'taxId',
    payment_terms_days: 'paymentTermsDays',
    paymentTermsDays: 'paymentTermsDays',
    customer_type: 'customerType',
    customerType: 'customerType',
    notes: 'notes'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }
  if (data.paymentTermsDays !== undefined) data.paymentTermsDays = Number(data.paymentTermsDays) || 0;
  if (data.code !== undefined) data.code = data.code ? String(data.code).trim() : null;

  const rawLimit = body.credit_limit !== undefined ? body.credit_limit : body.creditLimit;
  const rawDiscount = body.discount_percent !== undefined ? body.discount_percent : body.discountPercent;
  const changes: string[] = [];
  if (rawLimit !== undefined) {
    const next = parseCreditLimit(rawLimit);
    const prev = existing.creditLimit == null ? null : Number(existing.creditLimit);
    if (next !== prev) {
      data.creditLimit = next;
      changes.push(`credit limit ${prev ?? 'unlimited'} → ${next ?? 'unlimited'}`);
    }
  }
  if (rawDiscount !== undefined) {
    const next = parseDiscount(rawDiscount);
    const prev = existing.discountPercent == null ? null : Number(existing.discountPercent);
    if (next !== prev) {
      data.discountPercent = next;
      changes.push(`discount ${prev ?? 0}% → ${next ?? 0}%`);
    }
  }
  if (changes.length) await assertCanSetCredit(user);

  try {
    const updated = await prisma.customer.update({ where: { id }, data: data as any });
    await writeAudit({
      user,
      action: 'update',
      module: 'customers',
      entityType: 'Customer',
      entityId: id,
      summary: `Updated customer ${updated.name}${changes.length ? ` (${changes.join('; ')})` : ''}`
    });
    const exposure = await getCustomerExposure(prisma, user.businessId, id);
    return serialize(withCredit(updated, exposure.receivable, exposure.openOrders));
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Customer code already exists');
    throw err;
  }
}

export async function setCustomerStatus(user: AuthUser, id: string, status: string) {
  if (!CUSTOMER_STATUSES.includes(status)) throw httpError(400, 'status must be active or inactive');
  const existing = await prisma.customer.findFirst({ where: { id, businessId: user.businessId } });
  if (!existing) throw httpError(404, 'Customer not found');
  assertMutableCustomer(existing);
  if (existing.status === status) return serialize(existing);

  const updated = await prisma.customer.update({
    where: { id },
    data: { status, updatedById: user.id }
  });
  await writeAudit({
    user,
    action: status === 'active' ? 'activate' : 'deactivate',
    module: 'customers',
    entityType: 'Customer',
    entityId: id,
    summary: `${status === 'active' ? 'Enabled' : 'Disabled'} customer ${existing.name}`
  });
  return serialize(updated);
}

export async function deleteCustomer(user: AuthUser, id: string) {
  const existing = await prisma.customer.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      _count: { select: { invoices: true, payments: true, deliveries: true, journalEntries: true } }
    }
  });
  if (!existing) throw httpError(404, 'Customer not found');
  assertMutableCustomer(existing);
  const c = existing._count;
  const used = c.invoices + c.payments + c.deliveries + c.journalEntries;
  if (used > 0) {
    throw httpError(
      409,
      'This customer has transactions (invoices, payments, deliveries or journals) and cannot be deleted. Disable it instead.'
    );
  }

  await prisma.customer.delete({ where: { id } });
  await writeAudit({
    user,
    action: 'delete',
    module: 'customers',
    entityType: 'Customer',
    entityId: id,
    summary: `Deleted customer ${existing.name}${existing.code ? ` (${existing.code})` : ''}`
  });
  return { ok: true };
}

export async function addCustomerNote(user: AuthUser, customerId: string, body: Record<string, any>) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) throw httpError(404, 'Customer not found');
  const noteBody = requireString(body.body || body.note, 'body');
  const row = await prisma.customerNote.create({
    data: {
      id: shortId('cnote'),
      businessId: user.businessId,
      customerId,
      body: noteBody,
      createdById: user.id
    }
  });
  return serialize(row);
}
