import type { Request, Response, NextFunction } from 'express';
import * as payrollService from '../services/payroll.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function listRuns(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await payrollService.listRuns(req.user!, status, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function getRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.getRun(req.user!.businessId, req.params.id));
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

export async function recomputeRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await payrollService.recomputeRun(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function previewCompute(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.previewCompute(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function approveRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.approveRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function unapproveRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await payrollService.unapproveRun(req.user!, req.params.id));
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
