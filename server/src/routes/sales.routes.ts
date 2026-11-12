import { Router } from 'express';
import * as salesController from '../controllers/sales.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';
import { proofUpload } from '../middlewares/upload.js';

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
router.post('/invoices/:id/amend', requirePermission('sales.amend'), salesController.amendOrder);
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
const WAREHOUSE_VIEW = ['sales.fulfil', 'fulfilment.pick', 'fulfilment.dispatch'];
router.get('/fulfilments/pending', requirePermission(...WAREHOUSE_VIEW), salesController.pendingPickups);
router.get('/fulfilments/dashboard', requirePermission(...WAREHOUSE_VIEW), salesController.warehouseDashboard);
router.get('/fulfilments', requirePermission(...WAREHOUSE_VIEW), salesController.listFulfilments);
router.get('/fulfilments/:id', requirePermission(...WAREHOUSE_VIEW), salesController.getFulfilment);
router.post('/fulfilments', requirePermission('sales.fulfil'), salesController.fulfil);
router.post('/fulfilments/picking', requirePermission('fulfilment.pick'), salesController.startPicking);
router.post('/fulfilments/:id/pick', requirePermission('fulfilment.pick'), salesController.confirmPicking);
router.post('/fulfilments/:id/release', requirePermission('sales.fulfil'), salesController.releaseFulfilment);
router.post('/fulfilments/:id/cancel', requirePermission('fulfilment.pick', 'sales.fulfil'), salesController.cancelFulfilment);
router.post('/fulfilments/:id/dispatch', requirePermission('fulfilment.dispatch'), salesController.dispatchFulfilment);
router.post('/fulfilments/:id/deliver', requirePermission('fulfilment.dispatch'), salesController.deliverFulfilment);
router.get(
  '/fulfilments/:id/proofs',
  requirePermission('sales.fulfil', 'fulfilment.pick', 'fulfilment.dispatch'),
  salesController.listFulfilmentProofs
);
router.post(
  '/fulfilments/:id/proofs',
  requirePermission('sales.fulfil', 'fulfilment.dispatch'),
  proofUpload.single('file'),
  salesController.uploadFulfilmentProof
);
router.delete(
  '/fulfilments/:id/proofs/:proofId',
  requirePermission('sales.fulfil', 'fulfilment.dispatch'),
  salesController.deleteFulfilmentProof
);
router.post(
  '/invoices/:id/pickup-code',
  requirePermission('sales.post', 'sales.approve'),
  salesController.reissuePickupCode
);

router.get('/payments', requirePermission('sales.view'), salesController.listPayments);
router.post('/payments', requirePermission('sales.post'), salesController.recordPayment);
router.post(
  '/credits/apply',
  requirePermission('sales.post'),
  salesController.applyCustomerCredit
);
router.post(
  '/credits/refund',
  requirePermission('sales.refund'),
  salesController.refundCustomerCredit
);
router.get(
  '/customers/:id/credit',
  requirePermission('sales.view', 'customers.balances'),
  salesController.customerCredit
);

router.get('/returns', requirePermission('sales.return', 'sales.view'), salesController.listReturns);
router.post('/returns', requirePermission('sales.return'), salesController.createReturn);
router.get(
  '/returns/:id',
  requirePermission('sales.return', 'sales.view'),
  salesController.getReturn
);
router.post('/returns/:id/post', requirePermission('sales.return'), salesController.postReturn);
router.post('/returns/:id/void', requirePermission('sales.return'), salesController.voidReturn);
router.get(
  '/invoices/:id/return-preview',
  requirePermission('sales.return'),
  salesController.returnPreview
);

export default router;
