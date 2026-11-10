import type { Request, Response, NextFunction } from 'express';
import * as hrService from '../services/hr.service.js';

export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await hrService.listEmployees(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.createEmployee(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await hrService.updateEmployee(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await hrService.listAttendance(req.user!.businessId, {
        employee_id:
          typeof req.query.employee_id === 'string' ? req.query.employee_id : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function upsertAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.upsertAttendance(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await hrService.listLeave(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.createLeave(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function approveLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const body = { ...(req.body || {}) };
    if (body.status == null && body.approve != null) {
      body.status = body.approve === false || body.reject === true ? 'rejected' : 'approved';
    }
    return res.json(await hrService.approveLeave(req.user!, req.params.id, body));
  } catch (err) {
    return next(err);
  }
}
