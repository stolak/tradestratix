import type { Request, Response, NextFunction } from 'express';
import * as notificationService from '../services/notification.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const unreadOnly =
      req.query.unread_only === 'true' || req.query.unreadOnly === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    return res.json(
      await notificationService.listNotifications(req.user!, {
        unread_only: unreadOnly,
        limit: Number.isFinite(limit) ? limit : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await notificationService.markRead(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await notificationService.markAllRead(req.user!));
  } catch (err) {
    return next(err);
  }
}
