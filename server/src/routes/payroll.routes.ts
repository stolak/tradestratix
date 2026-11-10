import { Router } from 'express';
import * as payrollController from '../controllers/payroll.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/runs', requirePermission('payroll.view'), payrollController.listRuns);
router.post('/runs', requirePermission('payroll.create'), payrollController.createRun);
router.post('/runs/:id/post', requirePermission('payroll.post'), payrollController.postRun);
router.post('/runs/:id/pay', requirePermission('payroll.post'), payrollController.payRun);

export default router;
