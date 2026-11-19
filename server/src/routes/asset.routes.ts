import { Router } from 'express';
import * as assetController from '../controllers/asset.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';
import { proofUpload } from '../middlewares/upload.js';

const router = Router();

router.use(authenticate);

router.get(
  '/categories',
  requirePermission('assets.view', 'assets.settings.manage'),
  assetController.listCategories
);
router.post(
  '/categories',
  requirePermission('assets.settings.manage', 'assets.create'),
  assetController.createCategory
);
router.get(
  '/categories/:id',
  requirePermission('assets.view', 'assets.settings.manage'),
  assetController.getCategory
);
router.patch(
  '/categories/:id',
  requirePermission('assets.settings.manage', 'assets.edit', 'assets.update'),
  assetController.updateCategory
);

router.get(
  '/locations',
  requirePermission('assets.view', 'assets.settings.manage'),
  assetController.listLocations
);
router.post(
  '/locations',
  requirePermission('assets.settings.manage', 'assets.create'),
  assetController.createLocation
);
router.patch(
  '/locations/:id',
  requirePermission('assets.settings.manage', 'assets.edit', 'assets.update'),
  assetController.updateLocation
);

router.get('/', requirePermission('assets.view'), assetController.list);
router.post('/', requirePermission('assets.create'), assetController.create);

// Phase 7 — Dashboard & reports (before /:id)
router.get(
  '/dashboard',
  requirePermission('assets.view', 'assets.reports.view'),
  assetController.getDashboard
);
router.get(
  '/reports/register',
  requirePermission('assets.view', 'assets.reports.view'),
  assetController.getRegisterReport
);
router.get(
  '/reports/gl-reconciliation',
  requirePermission('assets.accounting.view', 'assets.reports.view', 'assets.view'),
  assetController.getGlReconciliation
);
router.get(
  '/reports/depreciation-summary',
  requirePermission('assets.depreciation.view', 'assets.reports.view', 'assets.view'),
  assetController.getDepreciationSummary
);
router.get(
  '/depreciation/entries',
  requirePermission('assets.view', 'assets.depreciation.view'),
  assetController.listDepreciationEntries
);
router.get(
  '/depreciation/runs',
  requirePermission('assets.view', 'assets.depreciation.view'),
  assetController.listDepreciationRuns
);
router.post(
  '/depreciation/runs/preview',
  requirePermission(
    'assets.depreciation.calculate',
    'assets.depreciation.post',
    'assets.post',
    'assets.create'
  ),
  assetController.createDepreciationPreview
);
router.get(
  '/depreciation/runs/:id',
  requirePermission('assets.view', 'assets.depreciation.view'),
  assetController.getDepreciationRun
);
router.post(
  '/depreciation/runs/:id/approve',
  requirePermission('assets.depreciation.approve', 'assets.approve', 'assets.depreciation.post'),
  assetController.approveDepreciationRun
);
router.post(
  '/depreciation/runs/:id/post',
  requirePermission('assets.depreciation.post', 'assets.post'),
  assetController.postDepreciationRun
);
router.post(
  '/depreciation/runs/:id/reverse',
  requirePermission('assets.depreciation.post', 'assets.post', 'assets.approve'),
  assetController.reverseDepreciationRun
);
/** Legacy one-shot: preview → approve → post */
router.post(
  '/depreciation/run',
  requirePermission('assets.depreciation.post', 'assets.post', 'assets.create'),
  assetController.runDepreciation
);

router.get(
  '/acquisitions',
  requirePermission('assets.view', 'assets.acquire'),
  assetController.listAcquisitions
);
router.post(
  '/acquisitions',
  requirePermission('assets.acquire', 'assets.create'),
  assetController.createAcquisition
);
router.post(
  '/acquisitions/from-grn',
  requirePermission('assets.acquire', 'assets.create'),
  assetController.createAcquisitionFromGrn
);
router.get(
  '/acquisitions/:id',
  requirePermission('assets.view', 'assets.acquire'),
  assetController.getAcquisition
);
router.patch(
  '/acquisitions/:id',
  requirePermission('assets.acquire', 'assets.update', 'assets.edit'),
  assetController.updateAcquisition
);
router.post(
  '/acquisitions/:id/submit',
  requirePermission('assets.acquire', 'assets.create'),
  assetController.submitAcquisition
);
router.post(
  '/acquisitions/:id/approve',
  requirePermission('assets.approve'),
  assetController.approveAcquisition
);
router.post(
  '/acquisitions/:id/capitalise',
  requirePermission('assets.capitalise', 'assets.approve', 'assets.post'),
  assetController.capitaliseAcquisition
);
router.post(
  '/acquisitions/:id/cancel',
  requirePermission('assets.acquire', 'assets.update', 'assets.edit'),
  assetController.cancelAcquisition
);
router.post(
  '/acquisitions/:id/costs',
  requirePermission('assets.acquire', 'assets.create'),
  assetController.addAcquisitionCost
);

// Phase 4 — Transfers
router.get(
  '/transfers',
  requirePermission('assets.view', 'assets.transfer.view'),
  assetController.listTransfers
);
router.post(
  '/transfers',
  requirePermission('assets.transfer.create', 'assets.create', 'assets.update'),
  assetController.createTransfer
);
router.get(
  '/transfers/:id',
  requirePermission('assets.view', 'assets.transfer.view'),
  assetController.getTransfer
);
router.post(
  '/transfers/:id/submit',
  requirePermission('assets.transfer.create', 'assets.create'),
  assetController.submitTransfer
);
router.post(
  '/transfers/:id/approve',
  requirePermission('assets.transfer.approve', 'assets.approve'),
  assetController.approveTransfer
);
router.post(
  '/transfers/:id/dispatch',
  requirePermission('assets.transfer.dispatch', 'assets.transfer.approve', 'assets.update'),
  assetController.dispatchTransfer
);
router.post(
  '/transfers/:id/receive',
  requirePermission('assets.transfer.receive', 'assets.transfer.dispatch', 'assets.update'),
  assetController.receiveTransfer
);
router.post(
  '/transfers/:id/cancel',
  requirePermission('assets.transfer.create', 'assets.update'),
  assetController.cancelTransfer
);

// Phase 4 — Maintenance
router.get(
  '/maintenance/requests',
  requirePermission('assets.view', 'assets.maintenance.view'),
  assetController.listMaintenanceRequests
);
router.post(
  '/maintenance/requests',
  requirePermission('assets.maintenance.create', 'assets.create'),
  assetController.createMaintenanceRequest
);
router.post(
  '/maintenance/requests/:id/submit',
  requirePermission('assets.maintenance.create', 'assets.create'),
  assetController.submitMaintenanceRequest
);
router.post(
  '/maintenance/requests/:id/approve',
  requirePermission('assets.maintenance.approve', 'assets.approve'),
  assetController.approveMaintenanceRequest
);
router.post(
  '/maintenance/requests/:id/reject',
  requirePermission('assets.maintenance.approve', 'assets.approve'),
  assetController.rejectMaintenanceRequest
);
router.get(
  '/maintenance/work-orders',
  requirePermission('assets.view', 'assets.maintenance.view'),
  assetController.listWorkOrders
);
router.post(
  '/maintenance/work-orders',
  requirePermission('assets.maintenance.manage', 'assets.maintenance.create', 'assets.create'),
  assetController.createWorkOrder
);
router.get(
  '/maintenance/work-orders/:id',
  requirePermission('assets.view', 'assets.maintenance.view'),
  assetController.getWorkOrder
);
router.post(
  '/maintenance/work-orders/:id/start',
  requirePermission('assets.maintenance.manage', 'assets.update'),
  assetController.startWorkOrder
);
router.post(
  '/maintenance/work-orders/:id/complete',
  requirePermission('assets.maintenance.manage', 'assets.update'),
  assetController.completeWorkOrder
);
router.post(
  '/maintenance/work-orders/:id/costs',
  requirePermission('assets.maintenance.manage', 'assets.create'),
  assetController.addWorkOrderCost
);

// Phase 4 — Insurance / warranty
router.get(
  '/insurances',
  requirePermission('assets.view', 'assets.maintenance.view'),
  assetController.listInsurances
);
router.post(
  '/insurances',
  requirePermission('assets.maintenance.manage', 'assets.create', 'assets.update'),
  assetController.createInsurance
);
router.patch(
  '/insurances/:id',
  requirePermission('assets.maintenance.manage', 'assets.update'),
  assetController.updateInsurance
);
router.post(
  '/insurance-claims',
  requirePermission('assets.maintenance.manage', 'assets.create'),
  assetController.createInsuranceClaim
);
router.post(
  '/insurance-claims/:id/settle',
  requirePermission('assets.maintenance.approve', 'assets.approve'),
  assetController.settleInsuranceClaim
);
router.post(
  '/insurance-claims/:id/deny',
  requirePermission('assets.maintenance.approve', 'assets.approve'),
  assetController.denyInsuranceClaim
);
router.get(
  '/warranties',
  requirePermission('assets.view', 'assets.maintenance.view'),
  assetController.listWarranties
);
router.post(
  '/warranties',
  requirePermission('assets.maintenance.manage', 'assets.create', 'assets.update'),
  assetController.createWarranty
);
router.patch(
  '/warranties/:id',
  requirePermission('assets.maintenance.manage', 'assets.update'),
  assetController.updateWarranty
);

// Phase 5 — CIP / components / impairment / revaluation / disposal
router.get(
  '/capital-projects',
  requirePermission('assets.view', 'assets.acquire', 'assets.capitalise'),
  assetController.listCapitalProjects
);
router.post(
  '/capital-projects',
  requirePermission('assets.acquire', 'assets.create', 'assets.capitalise'),
  assetController.createCapitalProject
);
router.get(
  '/capital-projects/:id',
  requirePermission('assets.view', 'assets.acquire', 'assets.capitalise'),
  assetController.getCapitalProject
);
router.post(
  '/capital-projects/:id/activate',
  requirePermission('assets.acquire', 'assets.update'),
  assetController.activateCapitalProject
);
router.post(
  '/capital-projects/:id/costs',
  requirePermission('assets.acquire', 'assets.create', 'assets.capitalise'),
  assetController.addCapitalProjectCost
);
router.post(
  '/capital-projects/:id/complete',
  requirePermission('assets.approve', 'assets.capitalise'),
  assetController.completeCapitalProject
);
router.post(
  '/capital-projects/:id/capitalise',
  requirePermission('assets.capitalise', 'assets.approve'),
  assetController.capitaliseCapitalProject
);
router.post(
  '/capital-projects/:id/cancel',
  requirePermission('assets.acquire', 'assets.update'),
  assetController.cancelCapitalProject
);

router.get(
  '/impairments',
  requirePermission('assets.view', 'assets.impairment.manage', 'assets.accounting.view'),
  assetController.listImpairments
);
router.post(
  '/impairments',
  requirePermission('assets.impairment.manage', 'assets.approve', 'assets.create'),
  assetController.createImpairment
);
router.post(
  '/impairments/:id/post',
  requirePermission('assets.impairment.manage', 'assets.post', 'assets.approve'),
  assetController.postImpairment
);

router.get(
  '/revaluations',
  requirePermission('assets.view', 'assets.revaluation.manage', 'assets.accounting.view'),
  assetController.listRevaluations
);
router.post(
  '/revaluations',
  requirePermission('assets.revaluation.manage', 'assets.approve', 'assets.create'),
  assetController.createRevaluation
);
router.post(
  '/revaluations/:id/post',
  requirePermission('assets.revaluation.manage', 'assets.post', 'assets.approve'),
  assetController.postRevaluation
);

router.get(
  '/disposals',
  requirePermission('assets.view', 'assets.disposal.request', 'assets.disposal.approve'),
  assetController.listDisposals
);
router.post(
  '/disposals',
  requirePermission('assets.disposal.request', 'assets.create', 'assets.update'),
  assetController.createDisposal
);
router.post(
  '/disposals/:id/submit',
  requirePermission('assets.disposal.request', 'assets.create'),
  assetController.submitDisposal
);
router.post(
  '/disposals/:id/approve',
  requirePermission('assets.disposal.approve', 'assets.approve'),
  assetController.approveDisposal
);
router.post(
  '/disposals/:id/post',
  requirePermission('assets.disposal.post', 'assets.post', 'assets.approve'),
  assetController.postDisposal
);
router.post(
  '/disposals/:id/cancel',
  requirePermission('assets.disposal.request', 'assets.update'),
  assetController.cancelDisposal
);

router.get(
  '/components',
  requirePermission('assets.view', 'assets.update'),
  assetController.listComponents
);
router.post(
  '/components',
  requirePermission('assets.create', 'assets.update'),
  assetController.createComponent
);
router.post(
  '/components/:id/retire',
  requirePermission('assets.update', 'assets.edit'),
  assetController.retireComponent
);

// Phase 6 — Physical verification
router.get(
  '/verification/campaigns',
  requirePermission('assets.view', 'assets.verification.view'),
  assetController.listVerificationCampaigns
);
router.post(
  '/verification/campaigns',
  requirePermission('assets.verification.manage', 'assets.create'),
  assetController.createVerificationCampaign
);
router.get(
  '/verification/campaigns/:id',
  requirePermission('assets.view', 'assets.verification.view'),
  assetController.getVerificationCampaign
);
router.post(
  '/verification/campaigns/:id/open',
  requirePermission('assets.verification.manage', 'assets.update'),
  assetController.openVerificationCampaign
);
router.post(
  '/verification/campaigns/:id/scan',
  requirePermission('assets.verification.manage', 'assets.update'),
  assetController.scanVerificationCampaign
);
router.post(
  '/verification/campaigns/:id/close',
  requirePermission('assets.verification.manage', 'assets.approve'),
  assetController.closeVerificationCampaign
);
router.post(
  '/verification/campaigns/:id/cancel',
  requirePermission('assets.verification.manage', 'assets.update'),
  assetController.cancelVerificationCampaign
);
router.get(
  '/verification/results',
  requirePermission('assets.view', 'assets.verification.view'),
  assetController.listVerificationResults
);
router.post(
  '/verification/results/:id/resolve',
  requirePermission('assets.verification.resolve', 'assets.approve', 'assets.update'),
  assetController.resolveVerificationResult
);

router.get('/:id', requirePermission('assets.view'), assetController.get);
router.patch(
  '/:id',
  requirePermission('assets.update', 'assets.edit'),
  assetController.update
);
router.post(
  '/:id/documents',
  requirePermission('assets.update', 'assets.edit', 'assets.create'),
  proofUpload.single('file'),
  assetController.uploadDocument
);

export default router;
