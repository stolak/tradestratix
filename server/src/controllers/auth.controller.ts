import type { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service.js';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const result = await authService.login(String(username), String(password), {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || undefined
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const result = await authService.me(req.user.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}
