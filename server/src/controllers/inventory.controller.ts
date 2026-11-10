import type { Request, Response, NextFunction } from 'express';
import * as inventoryService from '../services/inventory.service.js';
import * as transferService from '../services/stock-transfer.service.js';

export async function board(req: Request, res: Response, next: NextFunction) {
  try {
    const warehouseId =
      typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : undefined;
    return res.json(await inventoryService.inventoryBoard(req.user!.businessId, warehouseId));
  } catch (err) {
    return next(err);
  }
}

export async function lots(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await inventoryService.listLots(req.user!.businessId, {
        product_id: typeof req.query.product_id === 'string' ? req.query.product_id : undefined,
        warehouse_id:
          typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : undefined,
        include_empty: req.query.include_empty === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function movements(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await inventoryService.listMovements(req.user!.businessId, {
        product_id: typeof req.query.product_id === 'string' ? req.query.product_id : undefined,
        warehouse_id:
          typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function receive(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await inventoryService.receiveStock(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function issue(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await inventoryService.issueStock(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function adjust(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await inventoryService.adjustStock(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function expiry(req: Request, res: Response, next: NextFunction) {
  try {
    const days = req.query.within_days ? Number(req.query.within_days) : 90;
    return res.json(await inventoryService.expiryReport(req.user!.businessId, days));
  } catch (err) {
    return next(err);
  }
}

export async function listTransfers(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await transferService.listTransfers(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function createTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await transferService.createTransfer(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function approveTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.approveTransfer(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function dispatchTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.dispatchTransfer(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function receiveTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.receiveTransfer(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}
