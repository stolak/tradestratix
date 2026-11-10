import type { Request, Response, NextFunction } from 'express';
import * as mobileService from '../services/mobile.service.js';

export async function home(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await mobileService.getHome(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function listDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await mobileService.listOpenDeliveries(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function deliver(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await mobileService.deliverMobile(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}
