import type { Request, Response, NextFunction } from 'express';
import * as assetService from '../services/asset.service.js';
import * as categoryService from '../services/asset-category.service.js';
import * as locationService from '../services/asset-location.service.js';
import * as acquisitionService from '../services/asset-acquisition.service.js';
import * as depreciationService from '../services/asset-depreciation.service.js';
import * as transferService from '../services/asset-transfer.service.js';
import * as maintenanceService from '../services/asset-maintenance.service.js';
import * as insuranceService from '../services/asset-insurance.service.js';
import * as cipService from '../services/asset-cip.service.js';
import * as impairmentService from '../services/asset-impairment.service.js';
import * as revaluationService from '../services/asset-revaluation.service.js';
import * as disposalService from '../services/asset-disposal.service.js';
import * as componentService from '../services/asset-component.service.js';
import * as verificationService from '../services/asset-verification.service.js';
import * as dashboardService from '../services/asset-dashboard.service.js';

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
    return res.json(await assetService.getAsset(req.user!, req.params.id));
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

// ─── Phase 4: Transfers ──────────────────────────────────────────────────────

export async function listTransfers(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await transferService.listTransfers(req.user!, {
        ...branchListOpts(req),
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.getTransfer(req.user!, req.params.id));
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

export async function submitTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.submitTransfer(req.user!, req.params.id));
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

export async function cancelTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await transferService.cancelTransfer(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

// ─── Phase 4: Maintenance ────────────────────────────────────────────────────

export async function listMaintenanceRequests(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await maintenanceService.listRequests(req.user!, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createMaintenanceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await maintenanceService.createRequest(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function submitMaintenanceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.submitRequest(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function approveMaintenanceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.approveRequest(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function rejectMaintenanceRequest(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.rejectRequest(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listWorkOrders(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await maintenanceService.listWorkOrders(req.user!, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getWorkOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.getWorkOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function createWorkOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await maintenanceService.createWorkOrder(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function startWorkOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.startWorkOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function completeWorkOrder(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await maintenanceService.completeWorkOrder(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function addWorkOrderCost(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await maintenanceService.addMaintenanceCost(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

// ─── Phase 4: Insurance / warranty ───────────────────────────────────────────

export async function listInsurances(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await insuranceService.listInsurances(req.user!, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createInsurance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await insuranceService.createInsurance(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateInsurance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await insuranceService.updateInsurance(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function createInsuranceClaim(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await insuranceService.createClaim(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function settleInsuranceClaim(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await insuranceService.settleClaim(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function denyInsuranceClaim(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await insuranceService.denyClaim(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listWarranties(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await insuranceService.listWarranties(req.user!, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createWarranty(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await insuranceService.createWarranty(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateWarranty(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await insuranceService.updateWarranty(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

// ─── Phase 5: Advanced accounting ────────────────────────────────────────────

export async function listCapitalProjects(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await cipService.listProjects(req.user!, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await cipService.createProject(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function getCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.getProject(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function activateCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.activateProject(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function addCapitalProjectCost(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.addProjectCost(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function completeCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.completeProject(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function capitaliseCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.capitaliseProject(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function cancelCapitalProject(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cipService.cancelProject(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listImpairments(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await impairmentService.listImpairments(req.user!, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createImpairment(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await impairmentService.createImpairment(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function postImpairment(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await impairmentService.postImpairment(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listRevaluations(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await revaluationService.listRevaluations(req.user!, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createRevaluation(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await revaluationService.createRevaluation(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function postRevaluation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await revaluationService.postRevaluation(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listDisposals(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await disposalService.listDisposals(req.user!, {
        asset_id: typeof req.query.asset_id === 'string' ? req.query.asset_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createDisposal(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await disposalService.createDisposal(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function submitDisposal(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await disposalService.submitDisposal(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function approveDisposal(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await disposalService.approveDisposal(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function postDisposal(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await disposalService.postDisposal(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function cancelDisposal(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await disposalService.cancelDisposal(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listComponents(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await componentService.listComponents(req.user!, {
        parent_asset_id:
          typeof req.query.parent_asset_id === 'string' ? req.query.parent_asset_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createComponent(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await componentService.createComponent(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function retireComponent(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await componentService.retireComponent(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

// ─── Phase 6: Physical verification ──────────────────────────────────────────

export async function listVerificationCampaigns(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await verificationService.listCampaigns(req.user!, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function createVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await verificationService.createCampaign(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function getVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await verificationService.getCampaign(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function openVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await verificationService.openCampaign(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function scanVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await verificationService.scanCampaign(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function closeVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await verificationService.closeCampaign(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function cancelVerificationCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await verificationService.cancelCampaign(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listVerificationResults(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await verificationService.listResults(req.user!, {
        campaign_id: typeof req.query.campaign_id === 'string' ? req.query.campaign_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function resolveVerificationResult(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await verificationService.resolveResult(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

// ─── Phase 7: Dashboard & reports ────────────────────────────────────────────

export async function getDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await dashboardService.getDashboard(req.user!, {
        branch_id: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
        as_at: typeof req.query.as_at === 'string' ? req.query.as_at : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getRegisterReport(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await dashboardService.getRegisterReport(req.user!, {
        branch_id: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
        category_id: typeof req.query.category_id === 'string' ? req.query.category_id : undefined,
        financial_status:
          typeof req.query.financial_status === 'string' ? req.query.financial_status : undefined,
        include_disposed: req.query.include_disposed === '1' || req.query.include_disposed === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getGlReconciliation(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await dashboardService.getGlReconciliation(req.user!, {
        branch_id: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
        as_at: typeof req.query.as_at === 'string' ? req.query.as_at : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function getDepreciationSummary(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await dashboardService.getDepreciationSummary(req.user!, {
        period_label:
          typeof req.query.period_label === 'string' ? req.query.period_label : undefined,
        branch_id: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}
