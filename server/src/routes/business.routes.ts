import { Router } from 'express';
import * as businessController from '../controllers/business.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/current', requirePermission('settings.view', 'branches.view'), businessController.getCurrent);
router.patch(
  '/current',
  requirePermission('settings.edit'),
  businessController.updateCurrent
);
router.put(
  '/current/settings/:key',
  requirePermission('settings.edit'),
  businessController.upsertSetting
);

export default router;
