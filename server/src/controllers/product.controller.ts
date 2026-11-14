import type { Request, Response, NextFunction } from 'express';
import * as productService from '../services/product.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    return res.json(
      await productService.listProducts(req.user!.businessId, q, req.user!.activeBranchId)
    );
  } catch (err) {
    return next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.getProduct(req.user!.businessId, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await productService.createProduct(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.updateProduct(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.deleteProduct(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function addVariant(req: Request, res: Response, next: NextFunction) {
  try {
    return res
      .status(201)
      .json(await productService.addVariant(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active_only === '1' || req.query.active_only === 'true';
    return res.json(await productService.listCategories(req.user!.businessId, { activeOnly }));
  } catch (err) {
    return next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await productService.createCategory(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.updateCategory(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.deleteCategory(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listBrands(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active_only === '1' || req.query.active_only === 'true';
    return res.json(await productService.listBrands(req.user!.businessId, { activeOnly }));
  } catch (err) {
    return next(err);
  }
}

export async function createBrand(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await productService.createBrand(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateBrand(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.updateBrand(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function deleteBrand(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.deleteBrand(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listMakes(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active_only === '1' || req.query.active_only === 'true';
    return res.json(await productService.listMakes(req.user!.businessId, { activeOnly }));
  } catch (err) {
    return next(err);
  }
}

export async function createMake(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await productService.createMake(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateMake(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.updateMake(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function deleteMake(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await productService.deleteMake(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}
