import { Router } from 'express';
import * as branchController from '../controllers/branch.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('branches.view'), branchController.list);
router.get('/:id', requirePermission('branches.view'), branchController.get);
router.post('/', requirePermission('branches.create'), branchController.create);
router.patch('/:id', requirePermission('branches.edit'), branchController.update);

export default router;
