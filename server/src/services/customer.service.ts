import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { userHasAnyPermission } from './permission.service.js';

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

function withCredit<T extends { id: string; creditLimit: unknown }>(row: T, outstanding: number) {
  const limit = row.creditLimit == null ? null : Number(row.creditLimit);
  return {
    ...row,
    outstandingBalance: outstanding,
    availableCredit: limit == null ? null : roundMoney(limit - outstanding)
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

export async function listCustomers(businessId: string, q?: string, status?: string) {
  const rows = await prisma.customer.findMany({
    where: {
      businessId,
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
  const outstanding = await outstandingByCustomer(businessId);
  return serialize(rows.map((r) => withCredit(r, outstanding.get(r.id) ?? 0)));
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
  return serialize(withCredit(row, await getCustomerOutstanding(businessId, id)));
}

export async function createCustomer(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
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
        code: body.code ? String(body.code).trim() : null,
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
        customerType: body.customer_type || body.customerType || 'retail',
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
    return serialize(withCredit(updated, await getCustomerOutstanding(user.businessId, id)));
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Customer code already exists');
    throw err;
  }
}

export async function setCustomerStatus(user: AuthUser, id: string, status: string) {
  if (!CUSTOMER_STATUSES.includes(status)) throw httpError(400, 'status must be active or inactive');
  const existing = await prisma.customer.findFirst({ where: { id, businessId: user.businessId } });
  if (!existing) throw httpError(404, 'Customer not found');
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
