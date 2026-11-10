import type { Request, Response, NextFunction } from 'express';
import * as logisticsService from '../services/logistics.service.js';

export async function listVehicles(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await logisticsService.listVehicles(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function createVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await logisticsService.createVehicle(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await logisticsService.updateVehicle(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function listDeliveries(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await logisticsService.listDeliveries(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function getDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await logisticsService.getDelivery(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await logisticsService.createDelivery(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function scheduleDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await logisticsService.scheduleDelivery(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function dispatchDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await logisticsService.dispatchDelivery(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function markDelivered(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await logisticsService.markDelivered(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function cancelDelivery(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await logisticsService.cancelDelivery(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}
