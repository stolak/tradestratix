import type { Request, Response, NextFunction } from 'express';
import * as customerService from '../services/customer.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    return res.json(await customerService.listCustomers(req.user!.businessId, q));
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

export async function addNote(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await customerService.addCustomerNote(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
