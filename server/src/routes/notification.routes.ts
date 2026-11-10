import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('notifications.view', 'dashboard.view'),
  notificationController.list
);
router.post(
  '/read-all',
  requirePermission('notifications.view', 'dashboard.view'),
  notificationController.markAllRead
);
router.post(
  '/:id/read',
  requirePermission('notifications.view', 'dashboard.view'),
  notificationController.markRead
);

export default router;
