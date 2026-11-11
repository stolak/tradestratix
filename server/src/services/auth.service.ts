import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { signToken } from '../utils/jwt.js';
import { httpError, omitPassword, serialize, shortId } from '../utils/helpers.js';
import { getUserPermissionCodes } from './permission.service.js';
import { writeAudit } from './audit.service.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';

async function toAuthUser(userId: string, preferredBranchId?: string | null): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userBranches: true }
  });
  if (!user) throw httpError(401, 'User not found');
  const permissions = await getUserPermissionCodes(user.id);

  const base: AuthUser = {
    id: user.id,
    businessId: user.businessId,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    department: user.department,
    defaultBranchId: user.defaultBranchId,
    branchIds: user.userBranches.filter((b) => b.status === 'active').map((b) => b.branchId),
    permissions
  };

  return branchAccess.hydrateBranchContext(base, preferredBranchId || user.defaultBranchId);
}

export async function login(
  username: string,
  password: string,
  meta?: { ipAddress?: string; userAgent?: string }
) {
  const user = await prisma.user.findFirst({
    where: { username, status: 'active' },
    include: { business: true, userBranches: true }
  });
  if (!user) throw httpError(401, 'Invalid username or password');

  const ok = await bcrypt.compare(password, user.passwordHash);
  await prisma.loginHistory.create({
    data: {
      id: shortId('lgh'),
      userId: user.id,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      success: ok
    }
  });
  if (!ok) throw httpError(401, 'Invalid username or password');
  if (user.business.status !== 'active') throw httpError(403, 'Business account is not active');

  const defaultBranch = await branchAccess.ensureDefaultBranch(user.businessId, user.id);
  await branchAccess.ensureUserMembership(
    user.businessId,
    user.id,
    user.defaultBranchId || defaultBranch.id,
    user.id,
    user.role
  );

  if (!user.defaultBranchId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultBranchId: defaultBranch.id, lastLoginAt: new Date() }
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
  }

  const authUser = await toAuthUser(user.id, user.defaultBranchId || defaultBranch.id);
  const token = signToken(authUser);
  const branches = await branchAccess.listAuthorisedBranches(authUser);

  await writeAudit({
    user: authUser,
    action: 'login',
    module: 'auth',
    summary: `User ${user.username} logged in`,
    ipAddress: meta?.ipAddress
  });

  const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
  const salesRep = await prisma.salesRep.findFirst({
    where: {
      businessId: user.businessId,
      status: 'active',
      employee: { userId: user.id }
    },
    select: { id: true, code: true, status: true, commissionPercent: true }
  });

  return {
    token,
    user: serialize(omitPassword(freshUser || user)),
    business: serialize(user.business),
    permissions: authUser.permissions,
    branches: serialize(branches),
    active_branch_id: authUser.activeBranchId,
    sales_rep: salesRep
      ? serialize({
          id: salesRep.id,
          code: salesRep.code,
          status: salesRep.status,
          commission_percent: salesRep.commissionPercent
        })
      : null,
    is_sales_rep: !!salesRep
  };
}

export async function me(user: AuthUser) {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      business: true,
      userBranches: { include: { branch: true } },
      userRoles: { include: { role: true } }
    }
  });
  if (!row) throw httpError(404, 'User not found');
  const permissions = await getUserPermissionCodes(user.id);
  const authUser = await toAuthUser(user.id, user.activeBranchId);
  const branches = await branchAccess.listAuthorisedBranches(authUser);

  const salesRep = await prisma.salesRep.findFirst({
    where: {
      businessId: user.businessId,
      status: 'active',
      employee: { userId: user.id }
    },
    select: { id: true, code: true, status: true, commissionPercent: true }
  });

  const profile = serialize(omitPassword(row));
  return {
    ...(typeof profile === 'object' && profile !== null ? (profile as Record<string, unknown>) : {}),
    permissions,
    branches: serialize(branches),
    active_branch_id: authUser.activeBranchId,
    sales_rep: salesRep
      ? serialize({
          id: salesRep.id,
          code: salesRep.code,
          status: salesRep.status,
          commission_percent: salesRep.commissionPercent
        })
      : null,
    is_sales_rep: !!salesRep
  };
}

export async function switchBranch(user: AuthUser, branchId: string) {
  if (!branchId?.trim()) throw httpError(400, 'branch_id is required');
  const branch = await branchAccess.assertBranchMembership(user, branchId);
  if (!branch.isActive) {
    throw httpError(409, 'Cannot switch to a deactivated branch');
  }

  const authUser = await toAuthUser(user.id, branchId);
  const token = signToken(authUser);
  const branches = await branchAccess.listAuthorisedBranches(authUser);

  await writeAudit({
    user: authUser,
    action: 'switch_branch',
    module: 'auth',
    entityType: 'Branch',
    entityId: branchId,
    summary: `Switched active branch to ${branch.code}`
  });

  return {
    token,
    active_branch_id: authUser.activeBranchId,
    branches: serialize(branches)
  };
}
