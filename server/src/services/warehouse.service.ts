import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listWarehouses(user: AuthUser, branchId?: string) {
  const rows = await prisma.warehouse.findMany({
    where: {
      businessId: user.businessId,
      ...(branchId ? { branchId } : {})
    },
    include: { branch: true },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createWarehouse(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = requireString(body.code, 'code').toUpperCase();
  const branchId = requireString(body.branch_id || body.branchId, 'branch_id');

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(400, 'Invalid branch_id');

  const planSub = await prisma.businessSubscription.findFirst({
    where: { businessId: user.businessId, status: { in: ['trial', 'active'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  if (planSub) {
    const count = await prisma.warehouse.count({ where: { businessId: user.businessId } });
    if (count >= planSub.plan.maxWarehouses) {
      throw httpError(
        403,
        `Warehouse limit reached (${planSub.plan.maxWarehouses}) for current plan`
      );
    }
  }

  try {
    const created = await prisma.warehouse.create({
      data: {
        id: shortId('wh'),
        businessId: user.businessId,
        branchId,
        name,
        code,
        category: body.category || 'main',
        managerUserId: body.manager_user_id || body.managerUserId || null,
        capacity: body.capacity ?? null,
        addressLine1: body.address_line1 || body.addressLine1 || null,
        createdById: user.id
      },
      include: { branch: true }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'warehouses',
      entityType: 'Warehouse',
      entityId: created.id,
      summary: `Created warehouse ${code}`
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Warehouse code already exists');
    throw err;
  }
}

export async function updateWarehouse(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.warehouse.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warehouse not found');

  const updated = await prisma.warehouse.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: String(body.name).trim() } : {}),
      ...(body.code != null ? { code: String(body.code).trim().toUpperCase() } : {}),
      ...(body.category != null ? { category: String(body.category) } : {}),
      ...(body.manager_user_id !== undefined || body.managerUserId !== undefined
        ? { managerUserId: body.manager_user_id || body.managerUserId || null }
        : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      ...(body.is_active !== undefined || body.isActive !== undefined
        ? { isActive: body.is_active ?? body.isActive }
        : {}),
      updatedById: user.id
    },
    include: { branch: true }
  });
  await writeAudit({
    user,
    action: 'update',
    module: 'warehouses',
    entityType: 'Warehouse',
    entityId: id,
    summary: `Updated warehouse ${updated.code}`
  });
  return serialize(updated);
}
