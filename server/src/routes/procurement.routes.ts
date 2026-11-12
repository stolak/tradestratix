import { Router } from 'express';
import * as procurementController from '../controllers/procurement.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/orders', requirePermission('purchases.view'), procurementController.listOrders);
router.post('/orders', requirePermission('purchases.create'), procurementController.createOrder);
router.get('/orders/:id', requirePermission('purchases.view'), procurementController.getOrder);
router.post(
  '/orders/:id/submit',
  requirePermission('purchases.edit'),
  procurementController.submitOrder
);
router.post(
  '/orders/:id/approve',
  requirePermission('purchases.approve'),
  procurementController.approveOrder
);
router.post(
  '/orders/:id/cancel',
  requirePermission('purchases.edit'),
  procurementController.cancelOrder
);

router.get('/receipts', requirePermission('purchases.view'), procurementController.listReceipts);
router.get('/receipts/:id', requirePermission('purchases.view'), procurementController.getReceipt);
router.post('/receipts', requirePermission('purchases.create'), procurementController.receive);

router.get('/bills', requirePermission('purchases.view'), procurementController.listBills);
router.get('/payments', requirePermission('purchases.view'), procurementController.listPayments);
router.post('/payments', requirePermission('purchases.post'), procurementController.recordPayment);
router.get(
  '/suppliers/:id/credit',
  requirePermission('purchases.view'),
  procurementController.supplierCredit
);

export default router;
