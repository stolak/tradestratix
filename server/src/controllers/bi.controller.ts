import type { Request, Response, NextFunction } from 'express';
import * as biService from '../services/bi.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function insights(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await biService.getInsights(req.user!, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}
