import { Router } from 'express';
import * as mobileController from '../controllers/mobile.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/home',
  requirePermission('distribution.view', 'sales.view', 'dashboard.view'),
  mobileController.home
);
router.get(
  '/deliveries',
  requirePermission('distribution.view'),
  mobileController.listDeliveries
);
router.post(
  '/deliveries/:id/deliver',
  requirePermission('distribution.approve', 'distribution.edit'),
  mobileController.deliver
);

export default router;
