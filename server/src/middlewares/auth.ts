import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import * as permissionService from '../services/permission.service.js';
import * as branchAccess from '../services/branch-access.service.js';

export async function resolveBranchContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const requested =
      (typeof req.headers['x-branch-id'] === 'string' && req.headers['x-branch-id']) ||
      (typeof req.query.branch_id === 'string' ? req.query.branch_id : null) ||
      req.user.activeBranchId ||
      null;

    req.user = await branchAccess.hydrateBranchContext(req.user, requested);
    return next();
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    return resolveBranchContext(req, res, next);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authenticateStrict(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next);
}

export function requirePermission(...codes: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      if (req.user.role === 'business_owner') return next();
      const ok = await permissionService.userHasAnyPermission(req.user.id, codes);
      if (!ok) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: codes
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireBusinessOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'business_owner') {
    return res.status(403).json({ error: 'Business owner access required' });
  }
  return next();
}
