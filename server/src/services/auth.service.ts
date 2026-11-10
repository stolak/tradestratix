import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { signToken } from '../utils/jwt.js';
import { httpError, omitPassword, serialize, shortId } from '../utils/helpers.js';
import { getUserPermissionCodes } from './permission.service.js';
import { writeAudit } from './audit.service.js';
import type { AuthUser } from '../types/express/index.js';

async function toAuthUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userBranches: true }
  });
  if (!user) throw httpError(401, 'User not found');
  const permissions = await getUserPermissionCodes(user.id);
  return {
    id: user.id,
    businessId: user.businessId,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    department: user.department,
    defaultBranchId: user.defaultBranchId,
    branchIds: user.userBranches.map((b) => b.branchId),
    permissions
  };
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

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  const authUser = await toAuthUser(user.id);
  const token = signToken(authUser);
  await writeAudit({
    user: authUser,
    action: 'login',
    module: 'auth',
    summary: `User ${user.username} logged in`,
    ipAddress: meta?.ipAddress
  });

  return {
    token,
    user: serialize(omitPassword(user)),
    business: serialize(user.business),
    permissions: authUser.permissions
  };
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      business: true,
      userBranches: { include: { branch: true } },
      userRoles: { include: { role: true } }
    }
  });
  if (!user) throw httpError(404, 'User not found');
  const permissions = await getUserPermissionCodes(user.id);
  return {
    ...serialize(omitPassword(user)),
    permissions
  };
}
