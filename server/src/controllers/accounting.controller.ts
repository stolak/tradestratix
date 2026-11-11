import type { Request, Response, NextFunction } from 'express';
import * as accountingService from '../services/accounting.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function listAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.listAccounts(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function createAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.createAccount(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function listDefaults(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.listDefaultAccountSettings(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function listDefaultCatalog(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(accountingService.listDefaultAccountCatalog());
  } catch (err) {
    return next(err);
  }
}

export async function listDefaultStatus(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await accountingService.listDefaultAccountSettingsStatus(req.user!.businessId)
    );
  } catch (err) {
    return next(err);
  }
}

export async function upsertDefault(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await accountingService.upsertDefaultAccountSetting(req.user!, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function listJournals(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const customerId =
      typeof req.query.customer_id === 'string' ? req.query.customer_id : undefined;
    const supplierId =
      typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined;
    const salesRepresentativeId =
      typeof req.query.sales_representative_id === 'string'
        ? req.query.sales_representative_id
        : undefined;
    const sourceType =
      typeof req.query.source_type === 'string' ? req.query.source_type : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    return res.json(
      await accountingService.listJournals(req.user!, {
        status,
        customerId,
        supplierId,
        salesRepresentativeId,
        sourceType,
        from,
        to,
        ...branchListOpts(req)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function entityLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const entityType = String(req.params.entityType || '');
    if (!['customer', 'supplier', 'sales_representative'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType must be customer|supplier|sales_representative' });
    }
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    return res.json(
      await accountingService.entityLedger(req.user!, {
        entityType: entityType as 'customer' | 'supplier' | 'sales_representative',
        entityId: req.params.entityId,
        from,
        to,
        ...branchListOpts(req)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createJournal(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.createJournal(req.user!, req.body || {});
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function reverseJournal(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await accountingService.reverseJournal(
      req.user!,
      req.params.id,
      req.body?.memo
    );
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

export async function trialBalance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.trialBalance(req.user!, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function profitAndLoss(req: Request, res: Response, next: NextFunction) {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    return res.json(
      await accountingService.profitAndLoss(req.user!, from, to, branchListOpts(req))
    );
  } catch (err) {
    return next(err);
  }
}

export async function balanceSheet(req: Request, res: Response, next: NextFunction) {
  try {
    const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : undefined;
    return res.json(await accountingService.balanceSheet(req.user!, asOf, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function listPeriods(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await accountingService.listPeriods(req.user!.businessId));
  } catch (err) {
    return next(err);
  }
}

export async function lockPeriod(req: Request, res: Response, next: NextFunction) {
  try {
    const locked = req.body?.locked !== false && req.body?.is_locked !== false;
    return res.json(await accountingService.setPeriodLocked(req.user!, req.params.id, Boolean(locked)));
  } catch (err) {
    return next(err);
  }
}
