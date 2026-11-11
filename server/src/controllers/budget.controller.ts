import type { Request, Response, NextFunction } from 'express';
import * as budgetService from '../services/budget.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const fy =
      typeof req.query.fiscal_year === 'string' ? Number(req.query.fiscal_year) : undefined;
    return res.json(await budgetService.listBudgets(req.user!, fy, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await budgetService.createBudget(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await budgetService.activateBudget(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function vsActual(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await budgetService.budgetVsActual(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}
