import { prisma } from '../utils/prisma.js';
import { httpError, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';

export const CROSS_BRANCH_ROLES = new Set([
  'business_owner',
  'managing_director',
  'general_manager',
  'finance_manager',
  'auditor'
]);

export function canAccessAllBranches(user: Pick<AuthUser, 'role' | 'permissions'>): boolean {
  if (CROSS_BRANCH_ROLES.has(user.role)) return true;
  const perms = user.permissions || [];
  return (
    perms.includes('branches.report_all') ||
    perms.includes('reports.consolidate') ||
    perms.includes('reports.export')
  );
}

export async function ensureDefaultBranch(businessId: string, createdById?: string | null) {
  const existing = await prisma.branch.findFirst({
    where: { businessId, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (existing) return existing;

  const any = await prisma.branch.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'asc' }
  });
  if (any) {
    return prisma.branch.update({
      where: { id: any.id },
      data: { isActive: true }
    });
  }

  return prisma.branch.create({
    data: {
      id: shortId('br'),
      businessId,
      name: 'Head Office',
      code: 'HQ',
      createdById: createdById || null
    }
  });
}

export async function listAuthorisedBranchIds(
  userId: string,
  businessId: string,
  role?: string
): Promise<string[]> {
  let resolvedRole = role;
  if (!resolvedRole) {
    const user = await prisma.user.findFirst({
      where: { id: userId, businessId },
      select: { role: true }
    });
    resolvedRole = user?.role;
  }

  if (resolvedRole && CROSS_BRANCH_ROLES.has(resolvedRole)) {
    const rows = await prisma.branch.findMany({
      where: { businessId, isActive: true },
      select: { id: true }
    });
    return rows.map((r) => r.id);
  }

  const memberships = await prisma.userBranch.findMany({
    where: { userId, businessId, status: 'active' },
    select: { branchId: true, branch: { select: { isActive: true } } }
  });
  return memberships.filter((m) => m.branch.isActive).map((m) => m.branchId);
}

export async function listAuthorisedBranches(user: AuthUser) {
  if (canAccessAllBranches(user)) {
    return prisma.branch.findMany({
      where: { businessId: user.businessId },
      orderBy: { name: 'asc' }
    });
  }
  const ids = await listAuthorisedBranchIds(user.id, user.businessId, user.role);
  return prisma.branch.findMany({
    where: { businessId: user.businessId, id: { in: ids } },
    orderBy: { name: 'asc' }
  });
}

export async function assertBranchMembership(user: AuthUser, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId: user.businessId }
  });
  if (!branch) throw httpError(404, 'Branch not found');

  if (canAccessAllBranches(user)) return branch;

  const membership = await prisma.userBranch.findUnique({
    where: { userId_branchId: { userId: user.id, branchId } }
  });
  if (!membership || membership.status !== 'active') {
    throw httpError(403, 'Branch access denied or revoked');
  }
  return branch;
}

export async function assertBranchActive(businessId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, businessId }
  });
  if (!branch) throw httpError(400, 'Branch not found for this business');
  if (!branch.isActive) {
    throw httpError(409, 'Branch is inactive; cannot create new transactions');
  }
  return branch;
}

/** Resolve branch for write operations — validates membership + active status. */
export async function resolveWriteBranchId(
  user: AuthUser,
  requestedBranchId?: string | null
): Promise<string> {
  const candidate =
    requestedBranchId ||
    user.activeBranchId ||
    user.defaultBranchId ||
    (user.branchIds && user.branchIds[0]) ||
    null;

  if (!candidate) {
    const fallback = await ensureDefaultBranch(user.businessId, user.id);
    await ensureUserMembership(user.businessId, user.id, fallback.id, user.id);
    await assertBranchMembership(user, fallback.id);
    await assertBranchActive(user.businessId, fallback.id);
    return fallback.id;
  }

  await assertBranchMembership(user, candidate);
  await assertBranchActive(user.businessId, candidate);
  return candidate;
}

export async function ensureUserMembership(
  businessId: string,
  userId: string,
  branchId: string,
  assignedById?: string | null,
  roleCode?: string | null
) {
  return prisma.userBranch.upsert({
    where: { userId_branchId: { userId, branchId } },
    create: {
      userId,
      businessId,
      branchId,
      roleCode: roleCode || null,
      status: 'active',
      assignedById: assignedById || null
    },
    update: {
      status: 'active',
      ...(roleCode !== undefined ? { roleCode } : {})
    }
  });
}

/** Alias matching branch.service call order: userId, businessId, branchId, assignedById */
export async function ensureUserBranchMembership(
  userId: string,
  businessId: string,
  branchId: string,
  assignedById?: string | null,
  roleCode?: string | null
) {
  return ensureUserMembership(businessId, userId, branchId, assignedById, roleCode);
}

/**
 * Scope for list queries.
 * - Default: active branch only
 * - consolidated + authorised: all authorised branch IDs
 */
export async function branchScopeWhere(
  user: AuthUser,
  opts: { allowConsolidated?: boolean; branchId?: string | null } = {}
): Promise<{ branchId: string } | { branchId: { in: string[] } }> {
  if (opts.branchId) {
    await assertBranchMembership(user, opts.branchId);
    return { branchId: opts.branchId };
  }

  // Explicit active branch wins over consolidated list scope
  if (user.activeBranchId && !opts.allowConsolidated) {
    return { branchId: user.activeBranchId };
  }

  if (opts.allowConsolidated && !opts.branchId) {
    const ids = await listAuthorisedBranchIds(user.id, user.businessId, user.role);
    if (!ids.length) throw httpError(403, 'No authorised branches');
    if (canAccessAllBranches(user) || ids.length > 1) {
      return { branchId: { in: ids } };
    }
    return { branchId: ids[0] };
  }

  const active = await resolveWriteBranchId(user, user.activeBranchId);
  return { branchId: active };
}

/** For models that may have null historical branchId — include null only for cross-branch admins when consolidating. */
export async function branchScopeWhereLoose(
  user: AuthUser,
  opts: { allowConsolidated?: boolean; branchId?: string | null } = {}
): Promise<Record<string, unknown>> {
  const scope = await branchScopeWhere(user, opts);
  if ('branchId' in scope && typeof scope.branchId === 'string') {
    return { OR: [{ branchId: scope.branchId }, { branchId: null }] };
  }
  return scope;
}

export async function resolveWarehouseInBranch(
  businessId: string,
  warehouseId: string,
  branchId: string
) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId, isActive: true }
  });
  if (!warehouse) throw httpError(400, 'Invalid warehouse_id');
  if (warehouse.branchId !== branchId) {
    throw httpError(400, 'Warehouse does not belong to the active branch');
  }
  return warehouse;
}

/** Refresh JWT branch claims from DB (revocation-aware). */
export async function hydrateBranchContext(
  user: AuthUser,
  headerBranchId?: string | null
): Promise<AuthUser> {
  await ensureDefaultBranch(user.businessId, user.id);

  const authorisedIds = await listAuthorisedBranchIds(user.id, user.businessId, user.role);
  if (!authorisedIds.length && !canAccessAllBranches(user)) {
    throw httpError(403, 'User has no active branch membership');
  }

  // Ensure membership row exists for owners on all active branches (lazy)
  if (canAccessAllBranches(user) && user.defaultBranchId) {
    await ensureUserMembership(user.businessId, user.id, user.defaultBranchId, user.id);
  }

  let activeBranchId = headerBranchId || user.activeBranchId || user.defaultBranchId || null;

  if (activeBranchId) {
    try {
      await assertBranchMembership(user, activeBranchId);
    } catch {
      throw httpError(403, 'Branch access revoked');
    }
  } else {
    activeBranchId = authorisedIds[0] || null;
  }

  if (!activeBranchId) throw httpError(403, 'No active branch available');

  return {
    ...user,
    branchIds: authorisedIds,
    activeBranchId
  };
}

export async function countActiveBranches(businessId: string) {
  return prisma.branch.count({ where: { businessId, isActive: true } });
}
