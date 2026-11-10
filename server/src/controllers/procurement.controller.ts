import type { Request, Response, NextFunction } from 'express';
import * as procurementService from '../services/procurement.service.js';

export async function listOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await procurementService.listPurchaseOrders(req.user!.businessId, status));
  } catch (err) {
    return next(err);
  }
}

export async function getOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.getPurchaseOrder(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await procurementService.createPurchaseOrder(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function submitOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.submitPurchaseOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function approveOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.approvePurchaseOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.cancelPurchaseOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listReceipts(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.listGoodsReceipts(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function getReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await procurementService.getGoodsReceipt(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function receive(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await procurementService.receiveAgainstPurchaseOrder(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listBills(req: Request, res: Response, next: NextFunction) {
  try {
    const supplierId =
      typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined;
    return res.json(await procurementService.listSupplierBills(req.user!.businessId, supplierId));
  } catch (err) {
    return next(err);
  }
}

export async function listPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const supplierId =
      typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined;
    return res.json(
      await procurementService.listSupplierPayments(req.user!.businessId, supplierId)
    );
  } catch (err) {
    return next(err);
  }
}

export async function recordPayment(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await procurementService.recordSupplierPayment(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
