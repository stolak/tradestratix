import { Router } from 'express';
import * as warehouseController from '../controllers/warehouse.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('warehouses.view'), warehouseController.list);
router.post('/', requirePermission('warehouses.create'), warehouseController.create);
router.patch('/:id', requirePermission('warehouses.edit'), warehouseController.update);
router.delete('/:id', requirePermission('warehouses.delete'), warehouseController.remove);

export default router;
