import type { Request, Response, NextFunction } from 'express';
import * as assetService from '../services/asset.service.js';
import * as categoryService from '../services/asset-category.service.js';
import * as locationService from '../services/asset-location.service.js';
import * as acquisitionService from '../services/asset-acquisition.service.js';
import * as depreciationService from '../services/asset-depreciation.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await assetService.listAssets(req.user!, {
        ...branchListOpts(req),
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        operationalStatus:
          typeof req.query.operational_status === 'string' ? req.query.operational_status : undefined,
        financialStatus:
          typeof req.query.financial_status === 'string' ? req.query.financial_status : undefined,
        categoryId: typeof req.query.category_id === 'string' ? req.query.category_id : undefined,
        locationId: typeof req.query.location_id === 'string' ? req.query.location_id : undefined,
        custodianEmployeeId:
          typeof req.query.custodian_employee_id === 'string'
            ? req.query.custodian_employee_id
            : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await assetService.getAsset(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await assetService.createAsset(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await assetService.updateAsset(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listDepreciationEntries(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await depreciationService.listDepreciationEntries(req.user!.businessId, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        period_label:
          typeof req.query.period_label === 'string' ? req.query.period_label : undefined,
        run_id: typeof req.query.run_id === 'string' ? req.query.run_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function runDepreciation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await depreciationService.runDepreciationImmediate(req.user!, {
        period_label: req.body?.period_label || req.body?.periodLabel,
        asset_ids: req.body?.asset_ids || req.body?.assetIds,
        units: req.body?.units || req.body?.units_by_asset
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function listDepreciationRuns(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await depreciationService.listRuns(req.user!, {
        period_label:
          typeof req.query.period_label === 'string' ? req.query.period_label : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getDepreciationRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await depreciationService.getRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createDepreciationPreview(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await depreciationService.createPreviewRun(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function approveDepreciationRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await depreciationService.approveRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function postDepreciationRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await depreciationService.postRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function reverseDepreciationRun(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await depreciationService.reverseRun(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await categoryService.listCategories(req.user!, {
        activeOnly: req.query.active === '1' || req.query.active === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await categoryService.getCategory(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await categoryService.createCategory(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await categoryService.updateCategory(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function listLocations(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await locationService.listLocations(req.user!, {
        branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
        activeOnly: req.query.active === '1' || req.query.active === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createLocation(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await locationService.createLocation(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await locationService.updateLocation(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function uploadDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'file is required' });
    return res.status(201).json(
      await assetService.uploadAssetDocument(req.user!, req.params.id, file, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function listAcquisitions(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await acquisitionService.listAcquisitions(req.user!, {
        ...branchListOpts(req),
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await acquisitionService.getAcquisition(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await acquisitionService.createAcquisition(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await acquisitionService.updateAcquisition(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function submitAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await acquisitionService.submitAcquisition(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function approveAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await acquisitionService.approveAcquisition(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function capitaliseAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await acquisitionService.capitaliseAcquisition(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function cancelAcquisition(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await acquisitionService.cancelAcquisition(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function addAcquisitionCost(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await acquisitionService.addCostAddition(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function createAcquisitionFromGrn(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await acquisitionService.createFromGrnItem(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}
