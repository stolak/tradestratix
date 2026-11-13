import { Router } from 'express';
import * as accountingController from '../controllers/accounting.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

/** Shared account list — needed by several accounting tabs. */
const ACCOUNT_READ = [
  'accounting.view',
  'accounting.coa',
  'accounting.defaults',
  'accounting.journals',
  'accounting.ledger',
  'accounting.trial',
  'accounting.pl',
  'accounting.bs',
  'accounting.cf'
] as const;

router.get('/accounts', requirePermission(...ACCOUNT_READ), accountingController.listAccounts);
router.post('/accounts', requirePermission('accounting.create'), accountingController.createAccount);
router.patch(
  '/accounts/:id',
  requirePermission('accounting.edit', 'accounting.create'),
  accountingController.updateAccount
);
router.get(
  '/default-accounts',
  requirePermission('accounting.defaults'),
  accountingController.listDefaults
);
router.get(
  '/default-accounts/catalog',
  requirePermission('accounting.defaults'),
  accountingController.listDefaultCatalog
);
router.get(
  '/default-accounts/status',
  requirePermission('accounting.defaults', 'settings.view'),
  accountingController.listDefaultStatus
);
router.put(
  '/default-accounts',
  requirePermission('accounting.edit', 'settings.edit'),
  accountingController.upsertDefault
);
router.get('/journals', requirePermission('accounting.journals'), accountingController.listJournals);
router.get(
  '/ledger-statement',
  requirePermission('accounting.ledger', 'reports.view'),
  accountingController.ledgerStatement
);
router.get(
  '/ledgers/:entityType/:entityId',
  requirePermission('accounting.ledger', 'reports.view'),
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
  requirePermission('accounting.trial', 'reports.view'),
  accountingController.trialBalance
);
router.get(
  '/profit-loss',
  requirePermission('accounting.pl', 'reports.view'),
  accountingController.profitAndLoss
);
router.get(
  '/balance-sheet',
  requirePermission('accounting.bs', 'reports.view'),
  accountingController.balanceSheet
);
router.get(
  '/cash-flow',
  requirePermission('accounting.cf', 'reports.view'),
  accountingController.cashFlow
);
router.get('/periods', requirePermission('accounting.periods'), accountingController.listPeriods);
router.post(
  '/periods/:id/lock',
  requirePermission('accounting.edit'),
  accountingController.lockPeriod
);

export default router;
