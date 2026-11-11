import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import {
  canAccessAllBranches,
  ensureUserBranchMembership,
  listAuthorisedBranchIds
} from './branch-access.service.js';
import { assignBranchWarehousesToUser } from './warehouse.service.js';

async function scopedBranchFilter(user: AuthUser) {
  const base: Record<string, unknown> = { businessId: user.businessId };
  if (!canAccessAllBranches(user)) {
    const ids = user.branchIds?.length
      ? user.branchIds
      : await listAuthorisedBranchIds(user.id, user.businessId);
    if (ids.length > 0) {
      base.id = { in: ids };
    } else {
      base.id = '__none__';
    }
  }
  return base;
}

export async function listBranches(user: AuthUser) {
  const rows = await prisma.branch.findMany({
    where: (await scopedBranchFilter(user)) as any,
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

    await ensureUserBranchMembership(user.id, user.businessId, created.id, user.id);

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

  const nextActive =
    body.is_active !== undefined || body.isActive !== undefined
      ? Boolean(body.is_active ?? body.isActive)
      : undefined;

  if (nextActive === false && existing.isActive) {
    const activeCount = await prisma.branch.count({
      where: { businessId: user.businessId, isActive: true }
    });
    if (activeCount <= 1) {
      throw httpError(409, 'Cannot deactivate the only active branch');
    }
  }

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
      ...(nextActive !== undefined ? { isActive: nextActive } : {}),
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

export async function deactivateBranch(user: AuthUser, id: string) {
  const existing = await prisma.branch.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Branch not found');
  if (!existing.isActive) return serialize(existing);

  const activeCount = await prisma.branch.count({
    where: { businessId: user.businessId, isActive: true }
  });
  if (activeCount <= 1) {
    throw httpError(409, 'Cannot deactivate the only active branch');
  }

  const updated = await prisma.branch.update({
    where: { id },
    data: { isActive: false, updatedById: user.id }
  });

  await writeAudit({
    user,
    action: 'deactivate',
    module: 'branches',
    entityType: 'Branch',
    entityId: id,
    summary: `Deactivated branch ${updated.code}`
  });
  return serialize(updated);
}

/** Operational / transactional usage — empty warehouses alone do not block delete. */
async function countBranchDependents(businessId: string, branchId: string) {
  const [
    purchaseOrders,
    salesInvoices,
    journalEntries,
    stockLots,
    stockMovements,
    stockTransfers,
    goodsReceipts,
    supplierBills,
    expenseBills,
    bankAccounts,
    bankTransactions,
    payrollRuns,
    budgets,
    deliveryOrders,
    fixedAssets,
    employees
  ] = await Promise.all([
    prisma.purchaseOrder.count({ where: { businessId, branchId } }),
    prisma.salesInvoice.count({ where: { businessId, branchId } }),
    prisma.journalEntry.count({ where: { businessId, branchId } }),
    prisma.stockLot.count({
      where: { businessId, warehouse: { branchId } }
    }),
    prisma.stockMovement.count({ where: { businessId, branchId } }),
    prisma.stockTransfer.count({
      where: {
        businessId,
        OR: [{ fromBranchId: branchId }, { toBranchId: branchId }]
      }
    }),
    prisma.goodsReceiptNote.count({ where: { businessId, branchId } }),
    prisma.supplierBill.count({ where: { businessId, branchId } }),
    prisma.expenseBill.count({ where: { businessId, branchId } }),
    prisma.bankAccount.count({ where: { businessId, branchId } }),
    prisma.bankTransaction.count({ where: { businessId, branchId } }),
    prisma.payrollRun.count({ where: { businessId, branchId } }),
    prisma.budget.count({ where: { businessId, branchId } }),
    prisma.deliveryOrder.count({ where: { businessId, branchId } }),
    prisma.fixedAsset.count({ where: { businessId, branchId } }),
    prisma.employee.count({ where: { businessId, branchId } })
  ]);

  return {
    purchaseOrders,
    salesInvoices,
    journalEntries,
    stockLots,
    stockMovements,
    stockTransfers,
    goodsReceipts,
    supplierBills,
    expenseBills,
    bankAccounts,
    bankTransactions,
    payrollRuns,
    budgets,
    deliveryOrders,
    fixedAssets,
    employees,
    total:
      purchaseOrders +
      salesInvoices +
      journalEntries +
      stockLots +
      stockMovements +
      stockTransfers +
      goodsReceipts +
      supplierBills +
      expenseBills +
      bankAccounts +
      bankTransactions +
      payrollRuns +
      budgets +
      deliveryOrders +
      fixedAssets +
      employees
  };
}

export async function activateBranch(user: AuthUser, id: string) {
  const existing = await prisma.branch.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Branch not found');
  if (existing.isActive) return serialize(existing);

  const updated = await prisma.branch.update({
    where: { id },
    data: { isActive: true, updatedById: user.id }
  });

  await writeAudit({
    user,
    action: 'activate',
    module: 'branches',
    entityType: 'Branch',
    entityId: id,
    summary: `Activated branch ${updated.code}`
  });
  return serialize(updated);
}

export async function deleteBranch(user: AuthUser, id: string) {
  const existing = await prisma.branch.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Branch not found');

  const activeCount = await prisma.branch.count({
    where: { businessId: user.businessId, isActive: true }
  });
  if (existing.isActive && activeCount <= 1) {
    throw httpError(409, 'Cannot delete the only active branch');
  }

  const deps = await countBranchDependents(user.businessId, id);
  if (deps.total > 0) {
    throw httpError(
      409,
      'Branch has transactions or linked records; disable it instead of deleting',
      { dependents: deps }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.userBranch.deleteMany({ where: { branchId: id, businessId: user.businessId } });
    await tx.user.updateMany({
      where: { businessId: user.businessId, defaultBranchId: id },
      data: { defaultBranchId: null }
    });
    await tx.warehouse.deleteMany({ where: { branchId: id, businessId: user.businessId } });
    await tx.branch.delete({ where: { id } });
  });

  await writeAudit({
    user,
    action: 'delete',
    module: 'branches',
    entityType: 'Branch',
    entityId: id,
    summary: `Deleted branch ${existing.code}`
  });
  return { deleted: true, id };
}

export async function listMembers(user: AuthUser, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(404, 'Branch not found');

  const rows = await prisma.userBranch.findMany({
    where: { branchId, businessId: user.businessId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          email: true,
          status: true
        }
      }
    },
    orderBy: { assignedAt: 'desc' }
  });
  return serialize(rows);
}

export async function assignMember(
  user: AuthUser,
  branchId: string,
  body: Record<string, any>
) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(404, 'Branch not found');

  const targetUserId = requireString(body.user_id || body.userId, 'user_id');
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, businessId: user.businessId }
  });
  if (!target) throw httpError(404, 'User not found');

  const roleCode =
    body.role_code != null || body.roleCode != null
      ? (String(body.role_code ?? body.roleCode ?? '').trim() || null)
      : undefined;

  const existing = await prisma.userBranch.findUnique({
    where: { userId_branchId: { userId: targetUserId, branchId } }
  });

  const row = existing
    ? await prisma.userBranch.update({
        where: { userId_branchId: { userId: targetUserId, branchId } },
        data: {
          status: 'active',
          businessId: user.businessId,
          assignedById: user.id,
          ...(roleCode !== undefined ? { roleCode } : {})
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              email: true,
              status: true
            }
          }
        }
      })
    : await prisma.userBranch.create({
        data: {
          userId: targetUserId,
          businessId: user.businessId,
          branchId,
          status: 'active',
          roleCode: roleCode ?? null,
          assignedById: user.id
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              email: true,
              status: true
            }
          }
        }
      });

  // Grant default warehouse access for the newly authorised branch
  await assignBranchWarehousesToUser({
    businessId: user.businessId,
    userId: targetUserId,
    branchIds: [branchId],
    assignedById: user.id
  });

  await writeAudit({
    user,
    action: 'assign_member',
    module: 'branches',
    entityType: 'UserBranch',
    entityId: `${targetUserId}:${branchId}`,
    summary: `Assigned user ${target.username} to branch ${branch.code}`
  });

  return serialize(row);
}

export async function revokeMember(user: AuthUser, branchId: string, memberUserId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(404, 'Branch not found');

  const existing = await prisma.userBranch.findFirst({
    where: { userId: memberUserId, branchId, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Membership not found');

  const updated = await prisma.userBranch.update({
    where: { userId_branchId: { userId: memberUserId, branchId } },
    data: { status: 'revoked' },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          email: true,
          status: true
        }
      }
    }
  });

  await writeAudit({
    user,
    action: 'revoke_member',
    module: 'branches',
    entityType: 'UserBranch',
    entityId: `${memberUserId}:${branchId}`,
    summary: `Revoked branch membership for ${updated.user.username} on ${branch.code}`
  });

  return serialize(updated);
}
