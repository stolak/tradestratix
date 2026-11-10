import { Router } from 'express';
import * as budgetController from '../controllers/budget.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('accounting.view'), budgetController.list);
router.post('/', requirePermission('accounting.create'), budgetController.create);
router.post('/:id/activate', requirePermission('accounting.create'), budgetController.activate);
router.get('/:id/vs-actual', requirePermission('accounting.view'), budgetController.vsActual);

export default router;
