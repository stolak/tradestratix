import { Router } from 'express';
import * as rbacController from '../controllers/rbac.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/permissions', requirePermission('roles.view'), rbacController.listPermissions);
router.get('/menus', requirePermission('roles.view'), rbacController.listMenus);
router.get('/roles', requirePermission('roles.view'), rbacController.listRoles);
router.get('/roles/:id', requirePermission('roles.view'), rbacController.getRole);
router.put('/roles/:id/access', requirePermission('roles.edit'), rbacController.updateRoleAccess);
router.get('/me/menus', rbacController.myMenus);
router.get('/me/permissions', rbacController.myPermissions);

export default router;
