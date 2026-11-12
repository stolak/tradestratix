import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service.js';
import * as fulfilmentService from '../services/fulfilment.service.js';
import * as salesOrderService from '../services/sales-order.service.js';
import * as warehouseService from '../services/warehouse-fulfilment.service.js';
import * as pickupCodeService from '../services/pickup-code.service.js';
import * as returnService from '../services/sales-return.service.js';
import * as customerPayment from '../services/customer-payment.service.js';
import { httpError, serialize } from '../utils/helpers.js';

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
    return res.json(await warehouseService.getTask(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function fulfil(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await warehouseService.quickRelease(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function warehouseDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await warehouseService.warehouseDashboard(req.user!, {
        warehouseId: queryString(req.query.warehouse_id),
        q: queryString(req.query.q),
        status: queryString(req.query.status),
        from: queryString(req.query.from),
        to: queryString(req.query.to)
      })
    );
  } catch (err) {
    return next(err);
  }
}

type TaskAction = (user: any, id: string, body: Record<string, any>) => Promise<unknown>;
const taskAction = (fn: TaskAction) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json(await fn(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
};

export async function startPicking(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await warehouseService.startPicking(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export const confirmPicking = taskAction(warehouseService.confirmPicking);
export const releaseFulfilment = taskAction(warehouseService.releaseTask);
export const cancelFulfilment = taskAction(warehouseService.cancelTask);
export const dispatchFulfilment = taskAction(warehouseService.dispatchTask);
export const deliverFulfilment = taskAction(warehouseService.deliverTask);
export const reissuePickupCode = taskAction(pickupCodeService.reissuePickupCode);

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

export async function returnPreview(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await returnService.returnPreview(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listReturns(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await returnService.listReturns(req.user!, {
        invoiceId: queryString(req.query.invoice_id),
        customerId: queryString(req.query.customer_id),
        status: queryString(req.query.status),
        q: queryString(req.query.q)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getReturn(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await returnService.getReturn(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createReturn(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await returnService.createReturn(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function postReturn(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await returnService.postReturn(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function voidReturn(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await returnService.voidReturn(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function customerCredit(req: Request, res: Response, next: NextFunction) {
  try {
    const customerId = requireParam(req.params.customerId || req.params.id);
    const data = await customerPayment.customerUnappliedCredit(req.user!.businessId, customerId);
    return res.json(serialize(data));
  } catch (err) {
    return next(err);
  }
}

export async function applyCustomerCredit(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body || {};
    const allocations = Array.isArray(b.allocations)
      ? b.allocations.map((a: any) => ({
          invoiceId: a.invoice_id || a.invoiceId,
          amount: Number(a.amount)
        }))
      : [];
    const result = await customerPayment.applyUnappliedCredit(req.user!, {
      customerId: b.customer_id || b.customerId,
      allocations,
      idempotencyKey: b.idempotency_key || b.idempotencyKey
    });
    return res.status(result.replayed ? 200 : 201).json(serialize(result.payment));
  } catch (err) {
    return next(err);
  }
}

export async function refundCustomerCredit(req: Request, res: Response, next: NextFunction) {
  try {
    const b = req.body || {};
    const result = await customerPayment.refundUnappliedCredit(req.user!, {
      customerId: b.customer_id || b.customerId,
      amount: Number(b.amount),
      accountId: b.account_id || b.accountId,
      method: b.method,
      branchId: b.branch_id || b.branchId,
      reference: b.reference,
      notes: b.notes,
      idempotencyKey: b.idempotency_key || b.idempotencyKey
    });
    return res.status(result.replayed ? 200 : 201).json(serialize(result.payment));
  } catch (err) {
    return next(err);
  }
}

function requireParam(v: unknown): string {
  if (typeof v !== 'string' || !v) throw httpError(400, 'id is required');
  return v;
}
