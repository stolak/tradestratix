import { Router } from 'express';
import * as bankingController from '../controllers/banking.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/accounts', requirePermission('banking.view'), bankingController.listAccounts);
router.post('/accounts', requirePermission('banking.create'), bankingController.createAccount);
router.get('/transactions', requirePermission('banking.view'), bankingController.listTransactions);
router.post('/deposits', requirePermission('banking.post', 'banking.create'), bankingController.deposit);
router.post(
  '/withdrawals',
  requirePermission('banking.post', 'banking.create'),
  bankingController.withdraw
);
router.post(
  '/transfers',
  requirePermission('banking.post', 'banking.create'),
  bankingController.transfer
);

export default router;
