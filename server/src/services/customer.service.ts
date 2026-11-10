import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listCustomers(businessId: string, q?: string) {
  const rows = await prisma.customer.findMany({
    where: {
      businessId,
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
      _count: { select: { invoices: true, payments: true, noteRows: true } }
    }
  });
  return serialize(rows);
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
  return serialize(row);
}

export async function createCustomer(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
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
        creditLimit:
          body.credit_limit != null || body.creditLimit != null
            ? Number(body.credit_limit ?? body.creditLimit)
            : null,
        customerType: body.customer_type || body.customerType || 'retail',
        notes: body.notes || null,
        status: body.status || 'active',
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
    return serialize(row);
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
    credit_limit: 'creditLimit',
    creditLimit: 'creditLimit',
    customer_type: 'customerType',
    customerType: 'customerType',
    notes: 'notes',
    status: 'status'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }

  try {
    const updated = await prisma.customer.update({ where: { id }, data: data as any });
    await writeAudit({
      user,
      action: 'update',
      module: 'customers',
      entityType: 'Customer',
      entityId: id,
      summary: `Updated customer ${updated.name}`
    });
    return serialize(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Customer code already exists');
    throw err;
  }
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
