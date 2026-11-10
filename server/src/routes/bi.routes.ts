import { Router } from 'express';
import * as biController from '../controllers/bi.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/insights',
  requirePermission('reports.view', 'dashboard.view'),
  biController.insights
);

export default router;
