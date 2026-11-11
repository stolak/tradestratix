import type { Request, Response, NextFunction } from 'express';
import * as branchPricingService from '../services/branch-pricing.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    return res.json(await branchPricingService.listBranchPricing(req.user!, branchId, q));
  } catch (err) {
    return next(err);
  }
}

export async function set(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await branchPricingService.setBranchPrice(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function setDiscount(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await branchPricingService.setBranchDiscount(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function clearDiscount(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await branchPricingService.clearBranchDiscount(
        req.user!,
        req.params.branchId,
        req.params.productId
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function clear(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await branchPricingService.clearBranchPrice(
        req.user!,
        req.params.branchId,
        req.params.sellingPriceId
      )
    );
  } catch (err) {
    return next(err);
  }
}
