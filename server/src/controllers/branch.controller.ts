import type { Request, Response, NextFunction } from 'express';
import * as branchService from '../services/branch.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await branchService.listBranches(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await branchService.getBranch(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await branchService.createBranch(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await branchService.updateBranch(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
