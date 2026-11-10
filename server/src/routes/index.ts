import { Router } from 'express';
import authRoutes from './auth.routes.js';
import businessRoutes from './business.routes.js';
import branchRoutes from './branch.routes.js';
import warehouseRoutes from './warehouse.routes.js';
import userRoutes from './user.routes.js';
import rbacRoutes from './rbac.routes.js';
import accountingRoutes from './accounting.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import auditRoutes from './audit.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/businesses', businessRoutes);
router.use('/branches', branchRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/users', userRoutes);
router.use('/rbac', rbacRoutes);
router.use('/accounting', accountingRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/audit', auditRoutes);

export default router;
