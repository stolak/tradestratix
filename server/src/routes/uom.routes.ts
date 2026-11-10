import { Router } from 'express';
import * as uomController from '../controllers/uom.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('products.view', 'inventory.view'), uomController.list);
router.post('/', requirePermission('products.create', 'settings.edit'), uomController.create);
router.patch('/:id', requirePermission('products.edit', 'settings.edit'), uomController.update);

export default router;
