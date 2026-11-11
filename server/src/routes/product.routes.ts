import { Router } from 'express';
import * as productController from '../controllers/product.controller.js';
import * as uomController from '../controllers/uom.controller.js';
import * as branchPricingController from '../controllers/branch-pricing.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/categories', requirePermission('products.view'), productController.listCategories);
router.post('/categories', requirePermission('products.create'), productController.createCategory);
router.get('/brands', requirePermission('products.view'), productController.listBrands);
router.post('/brands', requirePermission('products.create'), productController.createBrand);

router.get(
  '/branch-prices',
  requirePermission('products.branch_price', 'products.view'),
  branchPricingController.list
);
router.put(
  '/branch-prices',
  requirePermission('products.branch_price'),
  branchPricingController.set
);
router.delete(
  '/branch-prices/:branchId/:sellingPriceId',
  requirePermission('products.branch_price'),
  branchPricingController.clear
);
router.put(
  '/branch-discounts',
  requirePermission('products.branch_price'),
  branchPricingController.setDiscount
);
router.delete(
  '/branch-discounts/:branchId/:productId',
  requirePermission('products.branch_price'),
  branchPricingController.clearDiscount
);

router.get('/', requirePermission('products.view'), productController.list);
router.post('/', requirePermission('products.create'), productController.create);
router.get('/:id', requirePermission('products.view'), productController.get);
router.patch('/:id', requirePermission('products.edit'), productController.update);
router.delete('/:id', requirePermission('products.delete'), productController.remove);
router.post('/:id/variants', requirePermission('products.create'), productController.addVariant);
router.post(
  '/:productId/conversions',
  requirePermission('products.edit'),
  uomController.addConversion
);

export default router;
