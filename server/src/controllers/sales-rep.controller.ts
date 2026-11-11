import type { Request, Response, NextFunction } from 'express';
import * as salesRepService from '../services/sales-rep.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const branchId =
      typeof req.query.branch_id === 'string'
        ? req.query.branch_id
        : req.user?.activeBranchId || req.user?.defaultBranchId || undefined;
    return res.json(
      await salesRepService.listSalesReps(req.user!.businessId, {
        branchId,
        activeOnly: true
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function mine(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await salesRepService.findSalesRepForUser(
      req.user!.businessId,
      req.user!.id
    );
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await salesRepService.createSalesRep(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await salesRepService.updateSalesRep(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function setActive(req: Request, res: Response, next: NextFunction) {
  try {
    const active = Boolean(req.body?.active ?? req.body?.is_active ?? true);
    return res.json(await salesRepService.setSalesRepActive(req.user!, req.params.id, active));
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesRepService.deleteSalesRep(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listCommissions(req: Request, res: Response, next: NextFunction) {
  try {
    const salesRepId =
      typeof req.query.sales_rep_id === 'string' ? req.query.sales_rep_id : undefined;
    return res.json(await salesRepService.listCommissions(req.user!.businessId, salesRepId));
  } catch (err) {
    return next(err);
  }
}
