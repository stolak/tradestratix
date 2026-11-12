import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { partnerLineBalances } from './accounting.service.js';
import { userHasAnyPermission } from './permission.service.js';

export async function listSuppliers(
  user: AuthUser,
  q?: string,
  opts?: { withBalances?: boolean }
) {
  const rows = await prisma.supplier.findMany({
    where: {
      businessId: user.businessId,
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
      _count: { select: { purchaseOrders: true, bills: true, payments: true } }
    }
  });

  const wantBalances = !!opts?.withBalances;
  const canSeeBalances =
    wantBalances &&
    (user.role === 'business_owner' ||
      (await userHasAnyPermission(user.id, ['suppliers.balances'])));

  if (!canSeeBalances) return serialize(rows);

  const balances = await partnerLineBalances(user.businessId, 'supplier');
  return serialize(
    rows.map((s) => ({
      ...s,
      balance: roundMoney(balances.get(s.id) ?? 0)
    }))
  );
}

export async function getSupplier(businessId: string, id: string) {
  const row = await prisma.supplier.findFirst({
    where: { id, businessId },
    include: {
      bills: { orderBy: { billDate: 'desc' }, take: 20 },
      payments: { orderBy: { paymentDate: 'desc' }, take: 20 },
      purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 10 }
    }
  });
  if (!row) throw httpError(404, 'Supplier not found');
  return serialize(row);
}

export async function createSupplier(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = body.code ? String(body.code).trim() : null;
  try {
    const row = await prisma.supplier.create({
      data: {
        id: shortId('sup'),
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
        paymentTermsDays: Number(body.payment_terms_days ?? body.paymentTermsDays ?? 30),
        creditLimit:
          body.credit_limit != null || body.creditLimit != null
            ? Number(body.credit_limit ?? body.creditLimit)
            : null,
        notes: body.notes || null,
        status: body.status || 'active',
        createdById: user.id
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'suppliers',
      entityType: 'Supplier',
      entityId: row.id,
      summary: `Created supplier ${name}`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Supplier code already exists');
    throw err;
  }
}

export async function updateSupplier(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.supplier.findFirst({ where: { id, businessId: user.businessId } });
  if (!existing) throw httpError(404, 'Supplier not found');

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
    notes: 'notes',
    status: 'status'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }

  try {
    const updated = await prisma.supplier.update({ where: { id }, data: data as any });
    await writeAudit({
      user,
      action: 'update',
      module: 'suppliers',
      entityType: 'Supplier',
      entityId: id,
      summary: `Updated supplier ${updated.name}`
    });
    return serialize(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Supplier code already exists');
    throw err;
  }
}
