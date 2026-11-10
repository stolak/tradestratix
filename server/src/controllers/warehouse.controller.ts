import type { Request, Response, NextFunction } from 'express';
import * as warehouseService from '../services/warehouse.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    return res.json(await warehouseService.listWarehouses(req.user!, branchId));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await warehouseService.createWarehouse(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await warehouseService.updateWarehouse(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}
