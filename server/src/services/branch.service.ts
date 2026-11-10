import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

function scopedBranchFilter(user: AuthUser) {
  const base: Record<string, unknown> = { businessId: user.businessId };
  if (
    user.role !== 'business_owner' &&
    user.role !== 'managing_director' &&
    user.role !== 'general_manager' &&
    user.branchIds &&
    user.branchIds.length > 0
  ) {
    base.id = { in: user.branchIds };
  }
  return base;
}

export async function listBranches(user: AuthUser) {
  const rows = await prisma.branch.findMany({
    where: scopedBranchFilter(user) as any,
    include: { warehouses: true },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createBranch(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = requireString(body.code, 'code').toUpperCase();

  const planSub = await prisma.businessSubscription.findFirst({
    where: { businessId: user.businessId, status: { in: ['trial', 'active'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  if (planSub) {
    const count = await prisma.branch.count({ where: { businessId: user.businessId } });
    if (count >= planSub.plan.maxBranches) {
      throw httpError(403, `Branch limit reached (${planSub.plan.maxBranches}) for current plan`);
    }
  }

  try {
    const created = await prisma.branch.create({
      data: {
        id: shortId('br'),
        businessId: user.businessId,
        name,
        code,
        email: body.email || null,
        phone: body.phone || null,
        addressLine1: body.address_line1 || body.addressLine1 || null,
        city: body.city || null,
        state: body.state || null,
        country: body.country || null,
        managerUserId: body.manager_user_id || body.managerUserId || null,
        operatingHours: body.operating_hours || body.operatingHours || null,
        salesTarget: body.sales_target ?? body.salesTarget ?? null,
        createdById: user.id
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'branches',
      entityType: 'Branch',
      entityId: created.id,
      summary: `Created branch ${code}`
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Branch code already exists');
    throw err;
  }
}

export async function updateBranch(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.branch.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Branch not found');

  const updated = await prisma.branch.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: String(body.name).trim() } : {}),
      ...(body.code != null ? { code: String(body.code).trim().toUpperCase() } : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.address_line1 !== undefined || body.addressLine1 !== undefined
        ? { addressLine1: body.address_line1 || body.addressLine1 || null }
        : {}),
      ...(body.city !== undefined ? { city: body.city || null } : {}),
      ...(body.state !== undefined ? { state: body.state || null } : {}),
      ...(body.country !== undefined ? { country: body.country || null } : {}),
      ...(body.manager_user_id !== undefined || body.managerUserId !== undefined
        ? { managerUserId: body.manager_user_id || body.managerUserId || null }
        : {}),
      ...(body.is_active !== undefined || body.isActive !== undefined
        ? { isActive: body.is_active ?? body.isActive }
        : {}),
      ...(body.sales_target !== undefined || body.salesTarget !== undefined
        ? { salesTarget: body.sales_target ?? body.salesTarget }
        : {}),
      updatedById: user.id
    }
  });
  await writeAudit({
    user,
    action: 'update',
    module: 'branches',
    entityType: 'Branch',
    entityId: id,
    summary: `Updated branch ${updated.code}`
  });
  return serialize(updated);
}

export async function getBranch(user: AuthUser, id: string) {
  const row = await prisma.branch.findFirst({
    where: { id, businessId: user.businessId },
    include: { warehouses: true }
  });
  if (!row) throw httpError(404, 'Branch not found');
  return serialize(row);
}
