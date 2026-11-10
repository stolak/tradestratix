import { Router } from 'express';
import * as logisticsController from '../controllers/logistics.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/vehicles', requirePermission('distribution.view'), logisticsController.listVehicles);
router.post(
  '/vehicles',
  requirePermission('distribution.create'),
  logisticsController.createVehicle
);
router.patch(
  '/vehicles/:id',
  requirePermission('distribution.edit'),
  logisticsController.updateVehicle
);

router.get(
  '/deliveries',
  requirePermission('distribution.view'),
  logisticsController.listDeliveries
);
router.post(
  '/deliveries',
  requirePermission('distribution.create'),
  logisticsController.createDelivery
);
router.get(
  '/deliveries/:id',
  requirePermission('distribution.view'),
  logisticsController.getDelivery
);
router.post(
  '/deliveries/:id/schedule',
  requirePermission('distribution.edit', 'distribution.approve'),
  logisticsController.scheduleDelivery
);
router.post(
  '/deliveries/:id/dispatch',
  requirePermission('distribution.approve', 'distribution.edit'),
  logisticsController.dispatchDelivery
);
router.post(
  '/deliveries/:id/deliver',
  requirePermission('distribution.approve', 'distribution.edit'),
  logisticsController.markDelivered
);
router.post(
  '/deliveries/:id/cancel',
  requirePermission('distribution.edit', 'distribution.approve'),
  logisticsController.cancelDelivery
);

export default router;
