import { Router } from 'express';
import * as customerController from '../controllers/customer.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('customers.view'), customerController.list);
router.post('/', requirePermission('customers.create'), customerController.create);
router.get('/balances', requirePermission('customers.balances'), customerController.balances);
router.get('/:id/invoices', requirePermission('customers.balances'), customerController.invoices);
router.get('/:id', requirePermission('customers.view'), customerController.get);
router.patch('/:id', requirePermission('customers.edit'), customerController.update);
router.post('/:id/activate', requirePermission('customers.edit'), customerController.activate);
router.post('/:id/deactivate', requirePermission('customers.edit'), customerController.deactivate);
router.delete('/:id', requirePermission('customers.delete'), customerController.remove);
router.post('/:id/notes', requirePermission('customers.edit'), customerController.addNote);

export default router;
