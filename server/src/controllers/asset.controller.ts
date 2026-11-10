import type { Request, Response, NextFunction } from 'express';
import * as assetService from '../services/asset.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await assetService.listAssets(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await assetService.getAsset(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await assetService.createAsset(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listDepreciationEntries(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await assetService.listDepreciationEntries(req.user!.businessId, {
        asset_id:
          typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        period_label:
          typeof req.query.period_label === 'string' ? req.query.period_label : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function runDepreciation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await assetService.runDepreciation(req.user!, {
        period_label: req.body?.period_label || req.body?.periodLabel,
        asset_ids: req.body?.asset_ids || req.body?.assetIds
      })
    );
  } catch (err) {
    return next(err);
  }
}
