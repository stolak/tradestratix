import type { Request, Response, NextFunction } from 'express';
import * as reportsService from '../services/reports.service.js';
import { httpError } from '../utils/helpers.js';

export async function arAging(req: Request, res: Response, next: NextFunction) {
  try {
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    return res.json(await reportsService.arAging(req.user!.businessId, asOf));
  } catch (err) {
    return next(err);
  }
}

export async function apAging(req: Request, res: Response, next: NextFunction) {
  try {
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    return res.json(await reportsService.apAging(req.user!.businessId, asOf));
  } catch (err) {
    return next(err);
  }
}

export async function customerStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportsService.customerStatement(req.user!.businessId, req.params.customerId);
    if (!data) throw httpError(404, 'Customer not found');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

export async function supplierStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportsService.supplierStatement(req.user!.businessId, req.params.supplierId);
    if (!data) throw httpError(404, 'Supplier not found');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}
