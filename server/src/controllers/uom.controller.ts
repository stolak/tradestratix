import type { Request, Response, NextFunction } from 'express';
import * as uomService from '../services/uom.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await uomService.listUoms(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await uomService.createUom(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await uomService.updateUom(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function addConversion(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await uomService.addProductConversion(req.user!, req.params.productId, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
