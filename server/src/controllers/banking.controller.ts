import type { Request, Response, NextFunction } from 'express';
import * as bankingService from '../services/banking.service.js';

export async function listAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await bankingService.listBankAccounts(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function createAccount(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await bankingService.createBankAccount(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const bankAccountId =
      typeof req.query.bank_account_id === 'string' ? req.query.bank_account_id : undefined;
    return res.json(await bankingService.listBankTransactions(req.user!.businessId, bankAccountId));
  } catch (err) {
    return next(err);
  }
}

export async function deposit(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await bankingService.deposit(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function withdraw(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await bankingService.withdraw(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function transfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await bankingService.transfer(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
