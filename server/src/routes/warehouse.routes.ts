import { Router } from 'express';
import * as warehouseController from '../controllers/warehouse.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/categories',
  requirePermission('warehouses.view', 'sales.view', 'pos.view', 'inventory.view'),
  warehouseController.listCategories
);
router.post(
  '/categories',
  requirePermission('warehouses.create', 'warehouses.edit'),
  warehouseController.createCategory
);
router.patch(
  '/categories/:id',
  requirePermission('warehouses.edit'),
  warehouseController.updateCategory
);
router.delete(
  '/categories/:id',
  requirePermission('warehouses.delete', 'warehouses.edit'),
  warehouseController.removeCategory
);

router.get(
  '/',
  requirePermission('warehouses.view', 'sales.view', 'pos.view', 'inventory.view'),
  warehouseController.list
);
router.post('/', requirePermission('warehouses.create'), warehouseController.create);
router.patch('/:id', requirePermission('warehouses.edit'), warehouseController.update);
router.delete('/:id', requirePermission('warehouses.delete'), warehouseController.remove);

export default router;
