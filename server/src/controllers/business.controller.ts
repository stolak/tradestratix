import type { Request, Response, NextFunction } from 'express';
import * as businessService from '../services/business.service.js';

export async function getCurrent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await businessService.getCurrentBusiness(req.user!.businessId);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

export async function updateCurrent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await businessService.updateCurrentBusiness(req.user!, req.body || {});
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}
