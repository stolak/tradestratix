import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { httpError, omitPassword, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

function asIdList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw httpError(400, 'Expected an array of ids');
  return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
}

async function assertBranchesInBusiness(businessId: string, branchIds: string[]) {
  if (!branchIds.length) return;
  const rows = await prisma.branch.findMany({
    where: { businessId, id: { in: branchIds } },
    select: { id: true }
  });
  if (rows.length !== branchIds.length) {
    throw httpError(400, 'One or more branch_ids are invalid for this business');
  }
}

async function assertWarehousesForBranches(
  businessId: string,
  warehouseIds: string[],
  branchIds: string[]
) {
  if (!warehouseIds.length) return;
  if (!branchIds.length) {
    throw httpError(400, 'Assign at least one branch before assigning warehouses');
  }
  const rows = await prisma.warehouse.findMany({
    where: {
      businessId,
      id: { in: warehouseIds },
      branchId: { in: branchIds }
    },
    select: { id: true }
  });
  if (rows.length !== warehouseIds.length) {
    throw httpError(
      400,
      'Warehouses must belong to branches the user is assigned to'
    );
  }
}

async function syncUserBranches(
  actor: AuthUser,
  userId: string,
  branchIds: string[]
) {
  await assertBranchesInBusiness(actor.businessId, branchIds);

  const existing = await prisma.userBranch.findMany({
    where: { userId, businessId: actor.businessId }
  });
  const existingByBranch = new Map(existing.map((row) => [row.branchId, row]));
  const selected = new Set(branchIds);

  for (const branchId of branchIds) {
    const row = existingByBranch.get(branchId);
    if (row) {
      if (row.status !== 'active') {
        await prisma.userBranch.update({
          where: { userId_branchId: { userId, branchId } },
          data: { status: 'active', assignedById: actor.id, assignedAt: new Date() }
        });
      }
    } else {
      await prisma.userBranch.create({
        data: {
          userId,
          businessId: actor.businessId,
          branchId,
          status: 'active',
          assignedById: actor.id
        }
      });
    }
  }

  for (const row of existing) {
    if (!selected.has(row.branchId) && row.status === 'active') {
      await prisma.userBranch.update({
        where: { userId_branchId: { userId, branchId: row.branchId } },
        data: { status: 'revoked' }
      });
    }
  }
}

async function syncUserWarehouses(
  actor: AuthUser,
  userId: string,
  warehouseIds: string[],
  branchIds: string[]
) {
  await assertWarehousesForBranches(actor.businessId, warehouseIds, branchIds);

  const existing = await prisma.userWarehouse.findMany({
    where: { userId, businessId: actor.businessId },
    include: { warehouse: { select: { branchId: true } } }
  });
  const existingByWh = new Map(existing.map((row) => [row.warehouseId, row]));
  const selected = new Set(warehouseIds);
  const allowedBranches = new Set(branchIds);

  for (const warehouseId of warehouseIds) {
    const row = existingByWh.get(warehouseId);
    if (row) {
      if (row.status !== 'active') {
        await prisma.userWarehouse.update({
          where: { userId_warehouseId: { userId, warehouseId } },
          data: { status: 'active', assignedById: actor.id, assignedAt: new Date() }
        });
      }
    } else {
      await prisma.userWarehouse.create({
        data: {
          userId,
          businessId: actor.businessId,
          warehouseId,
          status: 'active',
          assignedById: actor.id
        }
      });
    }
  }

  for (const row of existing) {
    const stillAllowed =
      selected.has(row.warehouseId) && allowedBranches.has(row.warehouse.branchId);
    if (row.status === 'active' && !stillAllowed) {
      await prisma.userWarehouse.update({
        where: { userId_warehouseId: { userId, warehouseId: row.warehouseId } },
        data: { status: 'revoked' }
      });
    }
  }
}

async function loadUser(businessId: string, id: string) {
  const row = await prisma.user.findFirst({
    where: { id, businessId },
    include: {
      userRoles: { include: { role: true } },
      userBranches: {
        where: { status: 'active' },
        include: { branch: { select: { id: true, code: true, name: true, isActive: true } } }
      },
      userWarehouses: {
        where: { status: 'active' },
        include: {
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              branchId: true,
              isActive: true
            }
          }
        }
      },
      defaultBranch: { select: { id: true, code: true, name: true } }
    }
  });
  if (!row) throw httpError(404, 'User not found');
  return row;
}

export async function listUsers(user: AuthUser) {
  const rows = await prisma.user.findMany({
    where: { businessId: user.businessId },
    include: {
      userRoles: { include: { role: true } },
      userBranches: {
        where: { status: 'active' },
        include: { branch: { select: { id: true, code: true, name: true, isActive: true } } }
      },
      userWarehouses: {
        where: { status: 'active' },
        include: {
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              branchId: true,
              isActive: true
            }
          }
        }
      },
      defaultBranch: { select: { id: true, code: true, name: true } }
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
  const branchIds = asIdList(body.branch_ids ?? body.branchIds) || [];
  const warehouseIds = asIdList(body.warehouse_ids ?? body.warehouseIds) || [];

  if (!branchIds.length) {
    throw httpError(400, 'Assign at least one branch');
  }
  await assertBranchesInBusiness(actor.businessId, branchIds);
  await assertWarehousesForBranches(actor.businessId, warehouseIds, branchIds);

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

  const defaultBranchId =
    body.default_branch_id || body.defaultBranchId || branchIds[0] || null;
  if (defaultBranchId && !branchIds.includes(String(defaultBranchId))) {
    throw httpError(400, 'default_branch_id must be one of the assigned branches');
  }

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
        defaultBranchId: defaultBranchId ? String(defaultBranchId) : null,
        createdById: actor.id,
        userRoles: { create: [{ roleId: roleRow.id }] },
        userBranches: {
          create: branchIds.map((branchId) => ({
            branchId,
            businessId: actor.businessId,
            status: 'active',
            assignedById: actor.id
          }))
        },
        ...(warehouseIds.length
          ? {
              userWarehouses: {
                create: warehouseIds.map((warehouseId) => ({
                  warehouseId,
                  businessId: actor.businessId,
                  status: 'active',
                  assignedById: actor.id
                }))
              }
            }
          : {})
      }
    });

    await writeAudit({
      user: actor,
      action: 'create',
      module: 'users',
      entityType: 'User',
      entityId: created.id,
      summary: `Created user ${username}`
    });
    return serialize(omitPassword(await loadUser(actor.businessId, created.id)));
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

  const branchIds = asIdList(body.branch_ids ?? body.branchIds);
  const warehouseIds = asIdList(body.warehouse_ids ?? body.warehouseIds);

  if (branchIds) {
    if (!branchIds.length) throw httpError(400, 'Assign at least one branch');
    await syncUserBranches(actor, id, branchIds);
  }

  const activeBranches =
    branchIds ||
    (
      await prisma.userBranch.findMany({
        where: { userId: id, businessId: actor.businessId, status: 'active' },
        select: { branchId: true }
      })
    ).map((r) => r.branchId);

  if (warehouseIds) {
    await syncUserWarehouses(actor, id, warehouseIds, activeBranches);
  } else if (branchIds) {
    // Drop warehouse access outside the new branch set
    const allowed = await prisma.warehouse.findMany({
      where: { businessId: actor.businessId, branchId: { in: activeBranches } },
      select: { id: true }
    });
    const keep = new Set(allowed.map((w) => w.id));
    const current = await prisma.userWarehouse.findMany({
      where: { userId: id, businessId: actor.businessId, status: 'active' }
    });
    for (const row of current) {
      if (!keep.has(row.warehouseId)) {
        await prisma.userWarehouse.update({
          where: { userId_warehouseId: { userId: id, warehouseId: row.warehouseId } },
          data: { status: 'revoked' }
        });
      }
    }
  }

  const data: Record<string, unknown> = { updatedById: actor.id };
  if (body.full_name != null || body.fullName != null) {
    data.fullName = String(body.full_name || body.fullName).trim();
  }
  if (body.email !== undefined) data.email = body.email || null;
  if (body.phone !== undefined) data.phone = body.phone || null;
  if (body.department !== undefined) data.department = body.department || null;
  if (body.status != null) data.status = body.status;
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

  if (body.default_branch_id !== undefined || body.defaultBranchId !== undefined) {
    const nextDefault = body.default_branch_id || body.defaultBranchId || null;
    if (nextDefault && !activeBranches.includes(String(nextDefault))) {
      throw httpError(400, 'default_branch_id must be one of the assigned branches');
    }
    data.defaultBranchId = nextDefault;
  } else if (branchIds && existing.defaultBranchId && !branchIds.includes(existing.defaultBranchId)) {
    data.defaultBranchId = branchIds[0] || null;
  }

  await prisma.user.update({
    where: { id },
    data: data as any
  });

  await writeAudit({
    user: actor,
    action: 'update',
    module: 'users',
    entityType: 'User',
    entityId: id,
    summary: `Updated user ${existing.username}`
  });
  return serialize(omitPassword(await loadUser(actor.businessId, id)));
}
