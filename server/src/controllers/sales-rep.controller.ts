import type { Request, Response, NextFunction } from 'express';
import * as salesRepService from '../services/sales-rep.service.js';
import { httpError } from '../utils/helpers.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const scoped =
      typeof req.query.branch_id === 'string'
        ? req.query.branch_id
        : undefined;
    const allStatuses =
      req.query.all === '1' ||
      req.query.all === 'true' ||
      req.query.include_inactive === '1' ||
      req.query.include_inactive === 'true';
    const withBalances =
      req.query.with_balances === '1' ||
      req.query.with_balances === 'true' ||
      req.query.balances === '1';
    return res.json(
      await salesRepService.listSalesReps(req.user!.businessId, {
        // Sales/POS pickers stay branch-scoped + active; management page uses all=1
        branchId: allStatuses ? null : scoped || req.user?.activeBranchId || undefined,
        activeOnly: !allStatuses,
        withBalances
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function mine(req: Request, res: Response, next: NextFunction) {
  try {
    const withBalance =
      req.query.with_balances === '1' ||
      req.query.with_balances === 'true' ||
      req.query.balances === '1';
    const row = await salesRepService.findSalesRepForUser(
      req.user!.businessId,
      req.user!.id,
      { withBalance }
    );
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

export async function retireCash(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(
      await salesRepService.retireSalesRepCash(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function retireMyCash(req: Request, res: Response, next: NextFunction) {
  try {
    const me = (await salesRepService.findSalesRepForUser(
      req.user!.businessId,
      req.user!.id
    )) as { id?: string } | null;
    if (!me?.id) throw httpError(400, 'You are not an active sales representative');
    return res.status(201).json(
      await salesRepService.retireSalesRepCash(req.user!, me.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await salesRepService.createSalesRep(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await salesRepService.updateSalesRep(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function setActive(req: Request, res: Response, next: NextFunction) {
  try {
    const active = Boolean(req.body?.active ?? req.body?.is_active ?? true);
    return res.json(await salesRepService.setSalesRepActive(req.user!, req.params.id, active));
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await salesRepService.deleteSalesRep(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listCommissions(req: Request, res: Response, next: NextFunction) {
  try {
    const salesRepId =
      typeof req.query.sales_rep_id === 'string' ? req.query.sales_rep_id : undefined;
    return res.json(await salesRepService.listCommissions(req.user!.businessId, salesRepId));
  } catch (err) {
    return next(err);
  }
}
