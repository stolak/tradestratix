import { Router } from 'express';
import * as subscriptionController from '../controllers/subscription.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/plans', requirePermission('settings.view'), subscriptionController.listPlans);
router.get('/current', requirePermission('settings.view'), subscriptionController.current);
router.get('/', requirePermission('settings.view'), subscriptionController.listBusiness);
router.patch(
  '/:id/status',
  requirePermission('settings.view'),
  subscriptionController.updateStatus
);

export default router;
