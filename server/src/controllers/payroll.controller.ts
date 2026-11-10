import type { Request, Response, NextFunction } from 'express';
import * as payrollService from '../services/payroll.service.js';

export async function listRuns(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await payrollService.listRuns(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function createRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await payrollService.createRun(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function postRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.postRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function payRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.payRun(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
