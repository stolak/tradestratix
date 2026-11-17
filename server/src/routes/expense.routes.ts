import { Router } from 'express';
import * as expenseController from '../controllers/expense.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/categories', requirePermission('expenses.view'), expenseController.listCategories);
router.post('/categories', requirePermission('expenses.create'), expenseController.createCategory);
router.get('/categories/:id', requirePermission('expenses.view'), expenseController.getCategory);
router.patch('/categories/:id', requirePermission('expenses.edit'), expenseController.updateCategory);
router.delete(
  '/categories/:id',
  requirePermission('expenses.edit'),
  expenseController.deleteCategory
);

router.get('/', requirePermission('expenses.view'), expenseController.list);
router.post('/', requirePermission('expenses.create'), expenseController.create);
router.get('/:id', requirePermission('expenses.view'), expenseController.get);
router.delete('/:id', requirePermission('expenses.edit'), expenseController.remove);
router.post('/:id/post', requirePermission('expenses.post'), expenseController.post);
router.post('/:id/pay', requirePermission('expenses.post'), expenseController.pay);

export default router;
