import type { Request, Response, NextFunction } from 'express';
import * as reportsService from '../services/reports.service.js';
import { httpError } from '../utils/helpers.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function arAging(req: Request, res: Response, next: NextFunction) {
  try {
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    return res.json(await reportsService.arAging(req.user!, asOf, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function apAging(req: Request, res: Response, next: NextFunction) {
  try {
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    return res.json(await reportsService.apAging(req.user!, asOf, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

function idList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function stockBalance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await reportsService.stockBalance(req.user!, {
        branchIds: idList(req.query.branch_ids),
        warehouseIds: idList(req.query.warehouse_ids),
        q: typeof req.query.q === 'string' ? req.query.q : null,
        includeZero: req.query.include_zero === '1' || req.query.include_zero === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function customerStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportsService.customerStatement(
      req.user!,
      req.params.customerId,
      branchListOpts(req)
    );
    if (!data) throw httpError(404, 'Customer not found');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

export async function supplierStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reportsService.supplierStatement(
      req.user!,
      req.params.supplierId,
      branchListOpts(req)
    );
    if (!data) throw httpError(404, 'Supplier not found');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}
