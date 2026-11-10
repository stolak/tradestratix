import { Router } from 'express';
import * as hrController from '../controllers/hr.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/employees', requirePermission('hr.view'), hrController.listEmployees);
router.post('/employees', requirePermission('hr.create'), hrController.createEmployee);
router.patch('/employees/:id', requirePermission('hr.edit'), hrController.updateEmployee);

router.get('/attendance', requirePermission('hr.view'), hrController.listAttendance);
router.post('/attendance', requirePermission('hr.create'), hrController.upsertAttendance);

router.get('/leave', requirePermission('hr.view'), hrController.listLeave);
router.post('/leave', requirePermission('hr.create'), hrController.createLeave);
router.post('/leave/:id/approve', requirePermission('hr.approve'), hrController.approveLeave);

export default router;
