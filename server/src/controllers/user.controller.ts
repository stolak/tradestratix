import type { Request, Response, NextFunction } from 'express';
import * as userService from '../services/user.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await userService.listUsers(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await userService.createUser(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await userService.updateUser(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
