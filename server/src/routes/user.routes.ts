import { Router } from 'express';
import * as userController from '../controllers/user.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.view'), userController.list);
router.post('/', requirePermission('users.create'), userController.create);
router.patch('/:id', requirePermission('users.edit'), userController.update);

export default router;
