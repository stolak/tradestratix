import { Router } from 'express';
import * as assetController from '../controllers/asset.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('assets.view'), assetController.list);
router.post('/', requirePermission('assets.create'), assetController.create);
router.get(
  '/depreciation/entries',
  requirePermission('assets.view'),
  assetController.listDepreciationEntries
);
router.post(
  '/depreciation/run',
  requirePermission('assets.post', 'assets.create'),
  assetController.runDepreciation
);
router.get('/:id', requirePermission('assets.view'), assetController.get);

export default router;
