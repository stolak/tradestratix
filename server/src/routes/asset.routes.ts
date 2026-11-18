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
