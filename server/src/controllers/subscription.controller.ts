import type { Request, Response, NextFunction } from 'express';
import * as subscriptionService from '../services/subscription.service.js';

export async function listPlans(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await subscriptionService.listPlans());
  } catch (err) {
    return next(err);
  }
}

export async function current(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await subscriptionService.getCurrentSubscription(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function listBusiness(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await subscriptionService.listBusinessSubscriptions(req.user!.businessId)
    );
  } catch (err) {
    return next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.body?.status;
    return res.json(
      await subscriptionService.updateSubscriptionStatus(
        req.user!,
        req.params.id,
        String(status || '')
      )
    );
  } catch (err) {
    return next(err);
  }
}
