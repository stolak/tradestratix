import { Router } from 'express';
import * as reportsController from '../controllers/reports.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/ar-aging', requirePermission('reports.view', 'sales.view'), reportsController.arAging);
router.get('/ap-aging', requirePermission('reports.view', 'purchases.view'), reportsController.apAging);
router.get(
  '/stock-balance',
  requirePermission('reports.view', 'inventory.view'),
  reportsController.stockBalance
);
router.get(
  '/customers/:customerId/statement',
  requirePermission('reports.view', 'customers.view'),
  reportsController.customerStatement
);
router.get(
  '/suppliers/:supplierId/statement',
  requirePermission('reports.view', 'suppliers.view'),
  reportsController.supplierStatement
);

export default router;
