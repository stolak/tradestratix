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

export async function upsertSetting(req: Request, res: Response, next: NextFunction) {
  try {
    const key = String(req.params.key || '');
    const value = String(req.body?.value ?? '');
    return res.json(await businessService.upsertSetting(req.user!, key, value));
  } catch (err) {
    return next(err);
  }
}
