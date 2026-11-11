import { Router } from 'express';
import * as branchController from '../controllers/branch.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('branches.view'), branchController.list);
router.get('/:id', requirePermission('branches.view'), branchController.get);
router.post('/', requirePermission('branches.create'), branchController.create);
router.patch('/:id', requirePermission('branches.edit'), branchController.update);
router.post('/:id/deactivate', requirePermission('branches.edit'), branchController.deactivate);
router.post('/:id/activate', requirePermission('branches.edit'), branchController.activate);
router.delete('/:id', requirePermission('branches.delete'), branchController.remove);

router.get('/:id/members', requirePermission('branches.view'), branchController.listMembers);
router.post('/:id/members', requirePermission('branches.edit'), branchController.assignMember);
router.delete(
  '/:id/members/:userId',
  requirePermission('branches.edit'),
  branchController.revokeMember
);

export default router;
