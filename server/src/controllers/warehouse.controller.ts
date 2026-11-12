import type { Request, Response, NextFunction } from 'express';
import * as warehouseService from '../services/warehouse.service.js';
import * as warehouseCategoryService from '../services/warehouse-category.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const includeInactive =
      req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const allBranches =
      req.query.all_branches === '1' ||
      req.query.all_branches === 'true' ||
      req.query.branch_id === 'all';
    // Prefer explicit query, else the user's switched/default branch (X-Branch-Id → activeBranchId).
    const branchId =
      allBranches
        ? null
        : typeof req.query.branch_id === 'string'
          ? req.query.branch_id
          : req.user?.activeBranchId || req.user?.defaultBranchId || undefined;
    return res.json(
      await warehouseService.listWarehouses(req.user!, branchId, {
        includeInactive,
        allBranches
      })
    );
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

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await warehouseService.deleteWarehouse(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly =
      req.query.active_only === '1' || req.query.active_only === 'true';
    return res.json(
      await warehouseCategoryService.listWarehouseCategories(req.user!, { activeOnly })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await warehouseCategoryService.createWarehouseCategory(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await warehouseCategoryService.updateWarehouseCategory(
        req.user!,
        req.params.id,
        req.body || {}
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function removeCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await warehouseCategoryService.deleteWarehouseCategory(req.user!, req.params.id)
    );
  } catch (err) {
    return next(err);
  }
}
