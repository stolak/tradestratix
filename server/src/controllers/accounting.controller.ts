import type { Request, Response, NextFunction } from 'express';
import * as accountingService from '../services/accounting.service.js';

export async function listAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.listAccounts(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function createAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.createAccount(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function listDefaults(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.listDefaultAccountSettings(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function listJournals(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await accountingService.listJournals(req.user!.businessId, { status }));
  } catch (err) {
    return next(err);
  }
}

export async function createJournal(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.createJournal(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function reverseJournal(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.reverseJournal(
      req.user!,
      req.params.id,
      req.body?.memo
    );
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function trialBalance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.trialBalance(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}
