import jwt, { type SignOptions } from 'jsonwebtoken';
import type { AuthUser } from '../types/express/index.js';

/** Default access-token lifetime; override with JWT_EXPIRES_IN (e.g. 8h, 12h). */
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN?.trim() || '12h') as SignOptions['expiresIn'];

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      businessId: user.businessId,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      email: user.email,
      department: user.department,
      defaultBranchId: user.defaultBranchId,
      activeBranchId: user.activeBranchId || null,
      branchIds: user.branchIds || [],
      permissions: user.permissions || []
    },
    requireJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, requireJwtSecret()) as AuthUser;
  return {
    id: payload.id,
    businessId: payload.businessId,
    username: payload.username,
    fullName: payload.fullName,
    role: payload.role,
    email: payload.email,
    department: payload.department,
    defaultBranchId: payload.defaultBranchId,
    activeBranchId: payload.activeBranchId || null,
    branchIds: payload.branchIds || [],
    permissions: payload.permissions || []
  };
}
