import type { Request, Response, NextFunction } from 'express';
import * as expenseService from '../services/expense.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await expenseService.listExpenses(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await expenseService.getExpense(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await expenseService.createExpense(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await expenseService.postExpense(req.user!, req.params.id, {
        pay_now: Boolean(req.body?.pay_now ?? req.body?.payNow),
        pay_method: req.body?.pay_method || req.body?.payMethod,
        bank_account_id: req.body?.bank_account_id || req.body?.bankAccountId
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function pay(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await expenseService.payExpense(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
