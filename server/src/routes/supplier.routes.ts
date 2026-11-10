import { Router } from 'express';
import * as supplierController from '../controllers/supplier.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('suppliers.view'), supplierController.list);
router.post('/', requirePermission('suppliers.create'), supplierController.create);
router.get('/:id', requirePermission('suppliers.view'), supplierController.get);
router.patch('/:id', requirePermission('suppliers.edit'), supplierController.update);

export default router;
