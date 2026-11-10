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
import productRoutes from './product.routes.js';
import uomRoutes from './uom.routes.js';
import inventoryRoutes from './inventory.routes.js';

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
router.use('/products', productRoutes);
router.use('/uoms', uomRoutes);
router.use('/inventory', inventoryRoutes);

export default router;
