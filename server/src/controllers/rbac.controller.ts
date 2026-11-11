import type { Request, Response, NextFunction } from 'express';
import * as permissionService from '../services/permission.service.js';

export async function listPermissions(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await permissionService.listPermissions());
  } catch (err) {
    return next(err);
  }
}

export async function listMenus(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await permissionService.listMenus(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function listRoles(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await permissionService.listRoles(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function getRole(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await permissionService.getRole(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function updateRoleAccess(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await permissionService.updateRoleAccess(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function myMenus(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await permissionService.getUserMenus(req.user!.id));
  } catch (err) {
    return next(err);
  }
}

export async function myPermissions(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json({
      permissions: await permissionService.getUserPermissionCodes(req.user!.id)
    });
  } catch (err) {
    return next(err);
  }
}
