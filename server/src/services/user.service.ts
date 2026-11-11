import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { httpError, omitPassword, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listUsers(user: AuthUser) {
  const rows = await prisma.user.findMany({
    where: { businessId: user.businessId },
    include: {
      userRoles: { include: { role: true } },
      userBranches: true,
      defaultBranch: true
    },
    orderBy: { fullName: 'asc' }
  });
  return serialize(rows.map((u) => omitPassword(u)));
}

export async function createUser(actor: AuthUser, body: Record<string, any>) {
  const username = requireString(body.username, 'username').toLowerCase();
  const fullName = requireString(body.full_name || body.fullName, 'full_name');
  const role = requireString(body.role, 'role');
  const password = requireString(body.password, 'password');

  const planSub = await prisma.businessSubscription.findFirst({
    where: { businessId: actor.businessId, status: { in: ['trial', 'active'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  if (planSub) {
    const count = await prisma.user.count({ where: { businessId: actor.businessId } });
    if (count >= planSub.plan.maxUsers) {
      throw httpError(403, `User limit reached (${planSub.plan.maxUsers}) for current plan`);
    }
  }

  const roleRow = await prisma.role.findFirst({
    where: {
      code: role,
      OR: [{ businessId: actor.businessId }, { businessId: null }]
    }
  });
  if (!roleRow) throw httpError(400, 'Invalid role');

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const created = await prisma.user.create({
      data: {
        id: shortId('usr'),
        businessId: actor.businessId,
        username,
        passwordHash,
        fullName,
        role,
        email: body.email || null,
        phone: body.phone || null,
        department: body.department || null,
        defaultBranchId: body.default_branch_id || body.defaultBranchId || null,
        createdById: actor.id,
        userRoles: { create: [{ roleId: roleRow.id }] },
        ...(Array.isArray(body.branch_ids || body.branchIds)
          ? {
              userBranches: {
                create: (body.branch_ids || body.branchIds).map((branchId: string) => ({
                  branchId,
                  businessId: actor.businessId,
                  status: 'active',
                  assignedById: actor.id
                }))
              }
            }
          : {})
      },
      include: { userRoles: { include: { role: true } }, userBranches: true }
    });
    await writeAudit({
      user: actor,
      action: 'create',
      module: 'users',
      entityType: 'User',
      entityId: created.id,
      summary: `Created user ${username}`
    });
    return serialize(omitPassword(created));
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Username already exists');
    throw err;
  }
}

export async function updateUser(actor: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.user.findFirst({
    where: { id, businessId: actor.businessId }
  });
  if (!existing) throw httpError(404, 'User not found');

  const data: Record<string, unknown> = { updatedById: actor.id };
  if (body.full_name != null || body.fullName != null) {
    data.fullName = String(body.full_name || body.fullName).trim();
  }
  if (body.email !== undefined) data.email = body.email || null;
  if (body.phone !== undefined) data.phone = body.phone || null;
  if (body.department !== undefined) data.department = body.department || null;
  if (body.status != null) data.status = body.status;
  if (body.default_branch_id !== undefined || body.defaultBranchId !== undefined) {
    data.defaultBranchId = body.default_branch_id || body.defaultBranchId || null;
  }
  if (body.password) {
    data.passwordHash = await bcrypt.hash(String(body.password), 10);
  }
  if (body.role) {
    const roleRow = await prisma.role.findFirst({
      where: {
        code: String(body.role),
        OR: [{ businessId: actor.businessId }, { businessId: null }]
      }
    });
    if (!roleRow) throw httpError(400, 'Invalid role');
    data.role = body.role;
    await prisma.userRole.deleteMany({ where: { userId: id } });
    await prisma.userRole.create({ data: { userId: id, roleId: roleRow.id } });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: data as any,
    include: { userRoles: { include: { role: true } }, userBranches: true }
  });
  await writeAudit({
    user: actor,
    action: 'update',
    module: 'users',
    entityType: 'User',
    entityId: id,
    summary: `Updated user ${updated.username}`
  });
  return serialize(omitPassword(updated));
}
