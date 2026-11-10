import { Router } from 'express';
import * as accountingController from '../controllers/accounting.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/accounts', requirePermission('accounting.view'), accountingController.listAccounts);
router.post('/accounts', requirePermission('accounting.create'), accountingController.createAccount);
router.get(
  '/default-accounts',
  requirePermission('accounting.view'),
  accountingController.listDefaults
);
router.get('/journals', requirePermission('accounting.view'), accountingController.listJournals);
router.post('/journals', requirePermission('accounting.post'), accountingController.createJournal);
router.post(
  '/journals/:id/reverse',
  requirePermission('accounting.reverse'),
  accountingController.reverseJournal
);
router.get(
  '/trial-balance',
  requirePermission('accounting.view', 'reports.view'),
  accountingController.trialBalance
);
router.get(
  '/profit-loss',
  requirePermission('accounting.view', 'reports.view'),
  accountingController.profitAndLoss
);
router.get(
  '/balance-sheet',
  requirePermission('accounting.view', 'reports.view'),
  accountingController.balanceSheet
);
router.get('/periods', requirePermission('accounting.view'), accountingController.listPeriods);
router.post(
  '/periods/:id/lock',
  requirePermission('accounting.edit'),
  accountingController.lockPeriod
);

export default router;
