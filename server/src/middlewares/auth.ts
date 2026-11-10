import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import * as permissionService from '../services/permission.service.js';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    return next();
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
