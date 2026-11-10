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

export default router;
