import type { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service.js';

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await dashboardService.getDashboardSummary(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}
