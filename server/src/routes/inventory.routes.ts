import { Router } from 'express';
import * as inventoryController from '../controllers/inventory.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/board', requirePermission('inventory.view'), inventoryController.board);
router.get('/lots', requirePermission('inventory.view'), inventoryController.lots);
router.get('/movements', requirePermission('inventory.view'), inventoryController.movements);
router.get('/expiry', requirePermission('inventory.view'), inventoryController.expiry);

router.post('/receive', requirePermission('inventory.create'), inventoryController.receive);
router.post('/issue', requirePermission('inventory.create'), inventoryController.issue);
router.post('/adjust', requirePermission('inventory.edit'), inventoryController.adjust);

router.get('/transfers', requirePermission('inventory.view', 'warehouses.view'), inventoryController.listTransfers);
router.get(
  '/transfers/warehouses',
  requirePermission('inventory.view', 'inventory.create'),
  inventoryController.transferWarehouses
);
router.post('/transfers', requirePermission('inventory.create'), inventoryController.createTransfer);
router.post(
  '/transfers/:id/approve',
  requirePermission('inventory.approve'),
  inventoryController.approveTransfer
);
router.post(
  '/transfers/:id/dispatch',
  requirePermission('inventory.create'),
  inventoryController.dispatchTransfer
);
router.post(
  '/transfers/:id/receive',
  requirePermission('inventory.create'),
  inventoryController.receiveTransfer
);
router.post(
  '/transfers/:id/cancel',
  requirePermission('inventory.create', 'inventory.edit'),
  inventoryController.cancelTransfer
);

export default router;
