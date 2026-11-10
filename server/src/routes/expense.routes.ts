import { Router } from 'express';
import * as expenseController from '../controllers/expense.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('expenses.view'), expenseController.list);
router.post('/', requirePermission('expenses.create'), expenseController.create);
router.get('/:id', requirePermission('expenses.view'), expenseController.get);
router.post('/:id/post', requirePermission('expenses.post'), expenseController.post);
router.post('/:id/pay', requirePermission('expenses.post'), expenseController.pay);

export default router;
