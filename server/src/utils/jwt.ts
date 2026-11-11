import jwt from 'jsonwebtoken';
import type { AuthUser } from '../types/express/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'tradestratix_jwt_secret_key_2026';
const JWT_EXPIRES_IN = '7d';

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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
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
