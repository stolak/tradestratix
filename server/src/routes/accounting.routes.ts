import { Router } from 'express';
import * as accountingController from '../controllers/accounting.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/accounts', requirePermission('accounting.view'), accountingController.listAccounts);
router.post('/accounts', requirePermission('accounting.create'), accountingController.createAccount);
router.patch(
  '/accounts/:id',
  requirePermission('accounting.edit', 'accounting.create'),
  accountingController.updateAccount
);
router.get(
  '/default-accounts',
  requirePermission('accounting.view'),
  accountingController.listDefaults
);
router.get(
  '/default-accounts/catalog',
  requirePermission('accounting.view'),
  accountingController.listDefaultCatalog
);
router.get(
  '/default-accounts/status',
  requirePermission('accounting.view', 'settings.view'),
  accountingController.listDefaultStatus
);
router.put(
  '/default-accounts',
  requirePermission('accounting.edit', 'settings.edit'),
  accountingController.upsertDefault
);
router.get('/journals', requirePermission('accounting.view'), accountingController.listJournals);
router.get(
  '/ledgers/:entityType/:entityId',
  requirePermission('accounting.view', 'reports.view'),
  accountingController.entityLedger
);
router.post('/journals', requirePermission('accounting.post'), accountingController.createJournal);
router.post(
  '/journals/:id/post',
  requirePermission('accounting.post'),
  accountingController.postJournal
);
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
router.get(
  '/cash-flow',
  requirePermission('accounting.view', 'reports.view'),
  accountingController.cashFlow
);
router.get('/periods', requirePermission('accounting.view'), accountingController.listPeriods);
router.post(
  '/periods/:id/lock',
  requirePermission('accounting.edit'),
  accountingController.lockPeriod
);

export default router;
