import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
    return res.json(
      await salesService.listInvoices(req.user!, { status, channel, ...branchListOpts(req) })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesService.getInvoice(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await salesService.createInvoice(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function postInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await salesService.postInvoice(req.user!, req.params.id, {
        pay_now: Boolean(req.body?.pay_now ?? req.body?.payNow),
        payment_method: req.body?.payment_method || req.body?.paymentMethod,
        account_id: req.body?.account_id || req.body?.accountId
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createPosSale(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(
      await salesService.createInvoice(req.user!, {
        ...(req.body || {}),
        channel: 'pos',
        pay_now: true,
        payment_method: req.body?.payment_method || req.body?.paymentMethod || 'cash'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function listPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const customerId =
      typeof req.query.customer_id === 'string' ? req.query.customer_id : undefined;
    return res.json(
      await salesService.listCustomerPayments(req.user!, customerId, branchListOpts(req))
    );
  } catch (err) {
    return next(err);
  }
}

export async function recordPayment(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await salesService.recordCustomerPayment(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
