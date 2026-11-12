import type { Request, Response, NextFunction } from 'express';
import * as supplierService from '../services/supplier.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const withBalances =
      req.query.with_balances === '1' ||
      req.query.with_balances === 'true' ||
      req.query.balances === '1';
    return res.json(
      await supplierService.listSuppliers(req.user!, q, { withBalances })
    );
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await supplierService.getSupplier(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await supplierService.createSupplier(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await supplierService.updateSupplier(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}
