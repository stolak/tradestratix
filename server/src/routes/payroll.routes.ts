import { Router } from 'express';
import * as payrollController from '../controllers/payroll.controller.js';
import * as configController from '../controllers/payroll-config.controller.js';
import * as reportController from '../controllers/payroll-report.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Config (H1)
router.post(
  '/config/ensure-defaults',
  requirePermission('payroll.edit'),
  configController.ensureDefaults
);
router.get('/config/summary', requirePermission('payroll.view'), configController.summary);

router.get('/components', requirePermission('payroll.view'), configController.listComponents);
router.post('/components', requirePermission('payroll.edit'), configController.createComponent);
router.patch(
  '/components/:id',
  requirePermission('payroll.edit'),
  configController.updateComponent
);

router.get('/grades', requirePermission('payroll.view'), configController.listGrades);
router.post('/grades', requirePermission('payroll.edit'), configController.createGrade);
router.patch('/grades/:id', requirePermission('payroll.edit'), configController.updateGrade);

router.get('/chart', requirePermission('payroll.view'), configController.listChart);
router.post('/chart', requirePermission('payroll.edit'), configController.upsertChart);
router.delete('/chart/:id', requirePermission('payroll.edit'), configController.deleteChart);

router.get('/statutory', requirePermission('payroll.view'), configController.listStatutory);
router.post('/statutory', requirePermission('payroll.edit'), configController.upsertStatutory);

router.get('/period', requirePermission('payroll.view'), configController.getPeriod);
router.put('/period', requirePermission('payroll.edit'), configController.setPeriod);

router.get(
  '/employees/:employeeId/package',
  requirePermission('payroll.view'),
  configController.listPackage
);
router.post('/package', requirePermission('payroll.edit'), configController.upsertPackage);

router.get('/overrides', requirePermission('payroll.view'), configController.listOverrides);
router.post('/overrides', requirePermission('payroll.edit'), configController.createOverride);
router.patch(
  '/overrides/:id',
  requirePermission('payroll.edit'),
  configController.updateOverride
);
router.delete(
  '/overrides/:id',
  requirePermission('payroll.edit'),
  configController.deleteOverride
);

// Reports (H5) — static paths before :id
router.get('/reports/period', requirePermission('payroll.view'), reportController.periodReport);
router.get('/reports/payslip', requirePermission('payroll.view'), reportController.payslip);
router.get(
  '/reports/employees/:employeeId/ytd',
  requirePermission('payroll.view'),
  reportController.employeeYtd
);
router.get(
  '/payslips/:itemId',
  requirePermission('payroll.view'),
  reportController.payslip
);

// Runs (static paths before :id)
router.get('/runs', requirePermission('payroll.view'), payrollController.listRuns);
router.post('/runs', requirePermission('payroll.create'), payrollController.createRun);
router.post(
  '/compute',
  requirePermission('payroll.create'),
  payrollController.computeActivePeriod
);
router.post(
  '/runs/preview',
  requirePermission('payroll.view'),
  payrollController.previewCompute
);
router.get('/runs/:id', requirePermission('payroll.view'), payrollController.getRun);
router.get(
  '/runs/:id/payslips',
  requirePermission('payroll.view'),
  reportController.runPayslips
);
router.post(
  '/runs/:id/recompute',
  requirePermission('payroll.create'),
  payrollController.recomputeRun
);
router.post(
  '/runs/:id/approve',
  requirePermission('payroll.approve'),
  payrollController.approveRun
);
router.post(
  '/runs/:id/unapprove',
  requirePermission('payroll.approve'),
  payrollController.unapproveRun
);
router.post('/runs/:id/post', requirePermission('payroll.post'), payrollController.postRun);
router.post('/runs/:id/pay', requirePermission('payroll.post'), payrollController.payRun);

export default router;
