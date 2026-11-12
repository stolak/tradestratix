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
router.post(
  '/invoices/:id/confirm',
  requirePermission('sales.post', 'sales.approve'),
  salesController.postInvoice
);
router.post('/invoices/:id/cancel', requirePermission('sales.cancel'), salesController.cancelOrder);
router.post(
  '/invoices/:id/reallocate',
  requirePermission('fulfilment.reallocate'),
  salesController.reallocateOrder
);
router.post(
  '/invoices/:id/allocate',
  requirePermission('fulfilment.reallocate', 'sales.post'),
  salesController.allocateBackorders
);
router.post(
  '/allocation-preview',
  requirePermission('sales.create'),
  salesController.previewAllocation
);
router.post(
  '/reservations/expire',
  requirePermission('fulfilment.reallocate'),
  salesController.expireReservations
);

router.post('/pos', requirePermission('pos.create', 'pos.post', 'sales.create'), salesController.createPosSale);

router.get(
  '/fulfilment-options',
  requirePermission('sales.create'),
  salesController.fulfilmentOptions
);
router.get('/fulfilments/pending', requirePermission('sales.fulfil'), salesController.pendingPickups);
router.get('/fulfilments', requirePermission('sales.fulfil'), salesController.listFulfilments);
router.get('/fulfilments/:id', requirePermission('sales.fulfil'), salesController.getFulfilment);
router.post('/fulfilments', requirePermission('sales.fulfil'), salesController.fulfil);

router.get('/payments', requirePermission('sales.view'), salesController.listPayments);
router.post('/payments', requirePermission('sales.post'), salesController.recordPayment);

export default router;
