import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listSalesReps(businessId: string) {
  const rows = await prisma.salesRep.findMany({
    where: { businessId },
    include: {
      branch: true,
      _count: { select: { invoices: true, commissions: true } }
    },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createSalesRep(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  try {
    const row = await prisma.salesRep.create({
      data: {
        id: shortId('rep'),
        businessId: user.businessId,
        name,
        code: body.code ? String(body.code).trim() : null,
        phone: body.phone || null,
        email: body.email || null,
        userId: body.user_id || body.userId || null,
        branchId: body.branch_id || body.branchId || user.defaultBranchId || null,
        commissionPercent: Number(body.commission_percent ?? body.commissionPercent ?? 0),
        status: body.status || 'active',
        createdById: user.id
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: row.id,
      summary: `Created sales rep ${name}`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Sales rep code already exists');
    throw err;
  }
}

export async function updateSalesRep(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.salesRep.findFirst({ where: { id, businessId: user.businessId } });
  if (!existing) throw httpError(404, 'Sales rep not found');

  const data: Record<string, unknown> = {};
  const map: Record<string, string> = {
    name: 'name',
    code: 'code',
    phone: 'phone',
    email: 'email',
    user_id: 'userId',
    userId: 'userId',
    branch_id: 'branchId',
    branchId: 'branchId',
    commission_percent: 'commissionPercent',
    commissionPercent: 'commissionPercent',
    status: 'status'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }

  try {
    const updated = await prisma.salesRep.update({ where: { id }, data: data as any });
    await writeAudit({
      user,
      action: 'update',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: id,
      summary: `Updated sales rep ${updated.name}`
    });
    return serialize(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Sales rep code already exists');
    throw err;
  }
}

export async function listCommissions(businessId: string, salesRepId?: string) {
  const rows = await prisma.salesCommission.findMany({
    where: {
      businessId,
      ...(salesRepId ? { salesRepId } : {})
    },
    include: { salesRep: true, invoice: true },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}
