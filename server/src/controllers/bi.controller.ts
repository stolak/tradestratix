import type { Request, Response, NextFunction } from 'express';
import * as biService from '../services/bi.service.js';

export async function insights(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await biService.getInsights(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}
