import type { Request, Response, NextFunction } from 'express';
import * as auditService from '../services/audit.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const module = typeof req.query.module === 'string' ? req.query.module : undefined;
    return res.json(await auditService.listAuditLogs(req.user!.businessId, { module }));
  } catch (err) {
    return next(err);
  }
}
