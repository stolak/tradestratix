import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service.js';
import * as fulfilmentService from '../services/fulfilment.service.js';
import * as salesOrderService from '../services/sales-order.service.js';

const queryString = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export async function fulfilmentOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = (queryString(req.query.product_ids) || '').split(',').map((s) => s.trim());
    return res.json(await fulfilmentService.fulfilmentOptions(req.user!, ids));
  } catch (err) {
    return next(err);
  }
}

export async function pendingPickups(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await fulfilmentService.listPendingPickups(req.user!, {
        warehouseId: queryString(req.query.warehouse_id),
        q: queryString(req.query.q)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function listFulfilments(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await fulfilmentService.listFulfilments(req.user!, {
        warehouseId: queryString(req.query.warehouse_id)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getFulfilment(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await fulfilmentService.getFulfilment(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function fulfil(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await fulfilmentService.fulfilPickup(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

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
    const b = req.body || {};
    return res.json(
      await salesService.postInvoice(req.user!, req.params.id, {
        pay_now: Boolean(b.pay_now ?? b.payNow),
        payment_method: b.payment_method || b.paymentMethod,
        account_id: b.account_id || b.accountId,
        amount_paid: b.amount_paid ?? b.amountPaid,
        allow_backorder: b.allow_backorder ?? b.allowBackorder,
        override_credit: b.override_credit ?? b.overrideCredit,
        override_reason: b.override_reason ?? b.overrideReason
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function previewAllocation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesOrderService.previewAllocation(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesOrderService.cancelOrder(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function reallocateOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await salesOrderService.reallocateOrder(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function allocateBackorders(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesOrderService.allocateBackorders(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function expireReservations(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesOrderService.runExpiry(req.user!));
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
