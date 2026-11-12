import type { Request, Response, NextFunction } from 'express';
import * as customerService from '../services/customer.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const includeWalkIn =
      req.query.include_walk_in === '1' ||
      req.query.include_walk_in === 'true' ||
      req.query.includeWalkIn === '1' ||
      req.query.includeWalkIn === 'true';
    return res.json(
      await customerService.listCustomers(req.user!.businessId, q, status, { includeWalkIn })
    );
  } catch (err) {
    return next(err);
  }
}

function purchaseFilter(req: Request) {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    branchId: str(req.query.branch_id),
    from: str(req.query.from),
    to: str(req.query.to),
    q: str(req.query.q)
  };
}

export async function balances(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await customerService.customerBalances(req.user!, purchaseFilter(req)));
  } catch (err) {
    return next(err);
  }
}

export async function invoices(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await customerService.customerInvoices(req.user!, req.params.id, purchaseFilter(req))
    );
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await customerService.getCustomer(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await customerService.createCustomer(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await customerService.updateCustomer(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await customerService.setCustomerStatus(req.user!, req.params.id, 'active'));
  } catch (err) {
    return next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await customerService.setCustomerStatus(req.user!, req.params.id, 'inactive'));
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await customerService.deleteCustomer(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function addNote(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await customerService.addCustomerNote(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
