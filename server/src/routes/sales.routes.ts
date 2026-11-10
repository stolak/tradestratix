import { Router } from 'express';
import * as salesController from '../controllers/sales.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/invoices', requirePermission('sales.view', 'pos.view'), salesController.listInvoices);
router.post('/invoices', requirePermission('sales.create'), salesController.createInvoice);
router.get(
  '/invoices/:id',
  requirePermission('sales.view', 'pos.view'),
  salesController.getInvoice
);
router.post(
  '/invoices/:id/post',
  requirePermission('sales.post', 'sales.approve'),
  salesController.postInvoice
);

router.post('/pos', requirePermission('pos.create', 'pos.post', 'sales.create'), salesController.createPosSale);

router.get('/payments', requirePermission('sales.view'), salesController.listPayments);
router.post('/payments', requirePermission('sales.post'), salesController.recordPayment);

export default router;
