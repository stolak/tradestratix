import { Router } from 'express';
import * as salesRepController from '../controllers/sales-rep.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  requirePermission('sales_reps.view', 'sales.view', 'pos.view'),
  salesRepController.list
);
router.get(
  '/me',
  requirePermission('sales_reps.view', 'sales.view', 'pos.view'),
  salesRepController.mine
);
router.post('/', requirePermission('sales_reps.create'), salesRepController.create);
router.get(
  '/commissions/list',
  requirePermission('sales_reps.view', 'sales.view'),
  salesRepController.listCommissions
);
router.patch('/:id', requirePermission('sales_reps.edit'), salesRepController.update);
router.post('/:id/activate', requirePermission('sales_reps.edit'), salesRepController.setActive);
router.post('/:id/deactivate', requirePermission('sales_reps.edit'), (req, res, next) => {
  req.body = { ...(req.body || {}), active: false };
  return salesRepController.setActive(req, res, next);
});
router.delete('/:id', requirePermission('sales_reps.delete'), salesRepController.remove);

export default router;
