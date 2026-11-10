import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);
router.get('/summary', requirePermission('dashboard.view'), dashboardController.summary);

export default router;
