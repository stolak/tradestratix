import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { applyBranchPricing } from './branch-pricing.service.js';

type TrackingFlags = {
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  trackWeight: boolean;
  trackLength: boolean;
  hasVariants: boolean;
  trackingMode: string;
};

function composeTrackingMode(flags: Omit<TrackingFlags, 'trackingMode'>): string {
  const parts: string[] = [];
  if (flags.trackExpiry) parts.push('expiry');
  if (flags.trackBatch) parts.push('batch');
  if (flags.trackSerial) parts.push('serial');
  if (flags.trackWeight) parts.push('weight');
  if (flags.trackLength) parts.push('length');
  if (flags.hasVariants) parts.push('variants');
  return parts.length ? parts.join('+') : 'standard';
}

/** Multi-select tracking: flags are independent and may be combined. */
function resolveTrackingFlags(body: Record<string, any>): TrackingFlags {
  const hasExplicitFlags =
    body.track_batch != null ||
    body.trackBatch != null ||
    body.track_expiry != null ||
    body.trackExpiry != null ||
    body.track_serial != null ||
    body.trackSerial != null ||
    body.track_weight != null ||
    body.trackWeight != null ||
    body.track_length != null ||
    body.trackLength != null ||
    body.has_variants != null ||
    body.hasVariants != null ||
    Array.isArray(body.tracking_modes) ||
    Array.isArray(body.trackingModes);

  if (hasExplicitFlags) {
    const modes = new Set(
      [...(body.tracking_modes || body.trackingModes || [])].map((m: string) =>
        String(m).toLowerCase()
      )
    );
    const flags = {
      trackBatch:
        body.track_batch != null || body.trackBatch != null
          ? Boolean(body.track_batch ?? body.trackBatch)
          : modes.has('batch'),
      trackExpiry:
        body.track_expiry != null || body.trackExpiry != null
          ? Boolean(body.track_expiry ?? body.trackExpiry)
          : modes.has('expiry'),
      trackSerial:
        body.track_serial != null || body.trackSerial != null
          ? Boolean(body.track_serial ?? body.trackSerial)
          : modes.has('serial'),
      trackWeight:
        body.track_weight != null || body.trackWeight != null
          ? Boolean(body.track_weight ?? body.trackWeight)
          : modes.has('weight'),
      trackLength:
        body.track_length != null || body.trackLength != null
          ? Boolean(body.track_length ?? body.trackLength)
          : modes.has('length'),
      hasVariants:
        body.has_variants != null || body.hasVariants != null
          ? Boolean(body.has_variants ?? body.hasVariants)
          : modes.has('variants') ||
            modes.has('size') ||
            modes.has('colour') ||
            modes.has('color') ||
            modes.has('size_colour')
    };
    return { ...flags, trackingMode: composeTrackingMode(flags) };
  }

  // Legacy single tracking_mode string still accepted and expanded into flags.
  const m = String(body.tracking_mode || body.trackingMode || 'standard').toLowerCase();
  const flags = {
    trackBatch: m.includes('batch') || m === 'expiry',
    trackExpiry: m.includes('expiry'),
    trackSerial: m.includes('serial'),
    trackWeight: m.includes('weight'),
    trackLength: m.includes('length'),
    hasVariants:
      m.includes('size') || m.includes('colour') || m.includes('color') || m.includes('variant')
  };
  return { ...flags, trackingMode: composeTrackingMode(flags) };
}

const productDetailInclude = {
  category: true,
  brand: true,
  baseUom: true,
  purchaseUom: true,
  sellingUom: true,
  variants: true,
  conversions: { include: { fromUom: true, toUom: true } },
  sellingPrices: { where: { isActive: true }, include: { uom: true }, orderBy: { unitPrice: 'asc' as const } },
  _count: {
    select: {
      stockMovements: true,
      stockLots: true,
      transferItems: true
    }
  }
};

function withDeleteFlag(row: any) {
  const c = row?._count;
  const canDelete = !c
    ? true
    : !(c.stock_movements || c.stock_lots || c.transfer_items);
  return { ...row, can_delete: canDelete };
}

async function productIsTransacted(productId: string, businessId: string) {
  const [movements, lots, transfers] = await Promise.all([
    prisma.stockMovement.count({ where: { productId, businessId } }),
    prisma.stockLot.count({ where: { productId, businessId } }),
    prisma.stockTransferItem.count({ where: { productId } })
  ]);
  return movements > 0 || lots > 0 || transfers > 0;
}

export async function listProducts(businessId: string, q?: string, branchId?: string | null) {
  const rows = await prisma.product.findMany({
    where: {
      businessId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { barcode: { contains: q } },
              { productCode: { contains: q } }
            ]
          }
        : {})
    },
    include: {
      category: true,
      brand: true,
      baseUom: true,
      purchaseUom: true,
      sellingUom: true,
      variants: { where: { isActive: true } },
      conversions: { include: { fromUom: true, toUom: true } },
      sellingPrices: { where: { isActive: true }, include: { uom: true }, orderBy: { unitPrice: 'asc' } },
      _count: {
        select: {
          stockMovements: true,
          stockLots: true,
          transferItems: true
        }
      }
    },
    orderBy: { name: 'asc' }
  });
  const products = (serialize(rows) as any[]).map(withDeleteFlag);
  return applyBranchPricing(businessId, branchId, products);
}

export async function getProduct(businessId: string, id: string) {
  const row = await prisma.product.findFirst({
    where: { id, businessId },
    include: productDetailInclude
  });
  if (!row) throw httpError(404, 'Product not found');
  return withDeleteFlag(serialize(row) as any);
}

export async function createProduct(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const baseUomId = requireString(body.base_uom_id || body.baseUomId, 'base_uom_id');
  const uom = await prisma.unitOfMeasure.findFirst({
    where: { id: baseUomId, businessId: user.businessId }
  });
  if (!uom) throw httpError(400, 'Invalid base_uom_id');

  const tracking = resolveTrackingFlags(body);

  const sku = body.sku ? String(body.sku).trim() : null;
  const productId = shortId('prd');

  const conversionsInput: any[] = Array.isArray(body.conversions) ? body.conversions : [];
  const allowedUomIds = new Set<string>([baseUomId]);
  for (const c of conversionsInput) {
    const fromId = c.from_uom_id || c.fromUomId;
    const toId = c.to_uom_id || c.toUomId || baseUomId;
    const factor = Number(c.factor);
    if (!fromId) throw httpError(400, 'conversions[].from_uom_id is required');
    if (fromId === baseUomId) {
      throw httpError(400, 'Packaging UoM must be different from the base UoM');
    }
    if (!factor || factor <= 0) throw httpError(400, 'Conversion factor must be greater than 0');
    if (toId !== baseUomId) {
      throw httpError(400, 'Conversions must target the product base UoM');
    }
    allowedUomIds.add(fromId);
  }

  const purchaseUomId = body.purchase_uom_id || body.purchaseUomId || baseUomId;
  if (!allowedUomIds.has(purchaseUomId)) {
    throw httpError(
      400,
      'Purchase UoM must be the base unit or one of the defined packaging conversions'
    );
  }

  const sellingPricesInput: any[] = Array.isArray(body.selling_prices)
    ? body.selling_prices
    : Array.isArray(body.sellingPrices)
      ? body.sellingPrices
      : [];

  if (!sellingPricesInput.length) {
    // Back-compat: single selling uom + default price
    const sellUom = body.selling_uom_id || body.sellingUomId || baseUomId;
    if (!allowedUomIds.has(sellUom)) {
      throw httpError(
        400,
        'Selling UoM must be the base unit or one of the defined packaging conversions'
      );
    }
    sellingPricesInput.push({
      uom_id: sellUom,
      unit_price: body.default_selling_price ?? body.defaultSellingPrice ?? 0,
      price_level: 'retail',
      is_default: true
    });
  }

  for (const sp of sellingPricesInput) {
    const uomId = sp.uom_id || sp.uomId;
    if (!uomId || !allowedUomIds.has(uomId)) {
      throw httpError(
        400,
        'Each selling price UoM must be the base unit or a defined packaging conversion'
      );
    }
    if (sp.unit_price == null && sp.unitPrice == null) {
      throw httpError(400, 'selling_prices[].unit_price is required');
    }
  }

  const defaultSell =
    sellingPricesInput.find((s) => s.is_default || s.isDefault) || sellingPricesInput[0];
  const defaultSellUom = defaultSell.uom_id || defaultSell.uomId || baseUomId;
  const defaultSellPrice = Number(defaultSell.unit_price ?? defaultSell.unitPrice ?? 0);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          id: productId,
          businessId: user.businessId,
          name,
          productCode: body.product_code || body.productCode || null,
          sku,
          barcode: body.barcode || null,
          description: body.description || null,
          categoryId: body.category_id || body.categoryId || null,
          brandId: body.brand_id || body.brandId || null,
          manufacturer: body.manufacturer || null,
          imageUrl: body.image_url || body.imageUrl || null,
          ...tracking,
          baseUomId,
          purchaseUomId,
          sellingUomId: defaultSellUom,
          reorderLevel: body.reorder_level ?? body.reorderLevel ?? 0,
          minStock: body.min_stock ?? body.minStock ?? 0,
          maxStock: body.max_stock ?? body.maxStock ?? null,
          defaultPurchaseCost: body.default_purchase_cost ?? body.defaultPurchaseCost ?? 0,
          defaultSellingPrice: defaultSellPrice,
          distributorPrice: body.distributor_price ?? body.distributorPrice ?? null,
          wholesalePrice: body.wholesale_price ?? body.wholesalePrice ?? null,
          retailPrice: body.retail_price ?? body.retailPrice ?? defaultSellPrice,
          taxCategory: body.tax_category || body.taxCategory || null,
          expiryAlertDaysJson: body.expiry_alert_days
            ? JSON.stringify(body.expiry_alert_days)
            : JSON.stringify([180, 90, 60, 30, 7]),
          createdById: user.id
        }
      });

      const variantsInput: any[] = Array.isArray(body.variants) ? body.variants : [];
      if (variantsInput.length === 0) {
        await tx.productVariant.create({
          data: {
            id: shortId('var'),
            businessId: user.businessId,
            productId: product.id,
            name: 'Default',
            sku: sku ? `${sku}-DEF` : null,
            isDefault: true,
            purchaseCost: product.defaultPurchaseCost,
            sellingPrice: product.defaultSellingPrice
          }
        });
      } else {
        for (const [i, v] of variantsInput.entries()) {
          await tx.productVariant.create({
            data: {
              id: shortId('var'),
              businessId: user.businessId,
              productId: product.id,
              name: v.name || `${v.colour || ''} ${v.size || ''}`.trim() || `Variant ${i + 1}`,
              sku: v.sku || null,
              barcode: v.barcode || null,
              size: v.size || null,
              colour: v.colour || v.color || null,
              purchaseCost: v.purchase_cost ?? v.purchaseCost ?? product.defaultPurchaseCost,
              sellingPrice: v.selling_price ?? v.sellingPrice ?? product.defaultSellingPrice,
              isDefault: i === 0
            }
          });
        }
        await tx.product.update({
          where: { id: product.id },
          data: { hasVariants: true }
        });
      }

      for (const c of conversionsInput) {
        await tx.productUnitConversion.create({
          data: {
            id: shortId('puc'),
            businessId: user.businessId,
            productId: product.id,
            fromUomId: c.from_uom_id || c.fromUomId,
            toUomId: c.to_uom_id || c.toUomId || baseUomId,
            factor: c.factor
          }
        });
      }

      let sawDefault = false;
      for (const sp of sellingPricesInput) {
        const isDefault = Boolean(sp.is_default ?? sp.isDefault) && !sawDefault;
        if (isDefault) sawDefault = true;
        await tx.productSellingPrice.create({
          data: {
            id: shortId('psp'),
            businessId: user.businessId,
            productId: product.id,
            uomId: sp.uom_id || sp.uomId,
            priceLevel: sp.price_level || sp.priceLevel || 'retail',
            label: sp.label || null,
            unitPrice: sp.unit_price ?? sp.unitPrice,
            minQty: sp.min_qty ?? sp.minQty ?? 1,
            isDefault
          }
        });
      }
      if (!sawDefault && sellingPricesInput.length) {
        const first = await tx.productSellingPrice.findFirst({
          where: { productId: product.id },
          orderBy: { createdAt: 'asc' }
        });
        if (first) {
          await tx.productSellingPrice.update({
            where: { id: first.id },
            data: { isDefault: true }
          });
        }
      }

      return tx.product.findUnique({
        where: { id: product.id },
        include: {
          category: true,
          brand: true,
          baseUom: true,
          purchaseUom: true,
          sellingUom: true,
          variants: true,
          conversions: { include: { fromUom: true, toUom: true } },
          sellingPrices: { include: { uom: true } }
        }
      });
    });

    await writeAudit({
      user,
      action: 'create',
      module: 'products',
      entityType: 'Product',
      entityId: productId,
      summary: `Created product ${name}`
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'SKU already exists for this business');
    throw err;
  }
}

export async function updateProduct(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.product.findFirst({
    where: { id, businessId: user.businessId },
    include: { conversions: true }
  });
  if (!existing) throw httpError(404, 'Product not found');

  const transacted = await productIsTransacted(id, user.businessId);
  const nextBaseUomId = body.base_uom_id || body.baseUomId;
  if (nextBaseUomId && nextBaseUomId !== existing.baseUomId) {
    if (transacted) {
      throw httpError(409, 'Cannot change base UoM after the product has been transacted');
    }
    const uom = await prisma.unitOfMeasure.findFirst({
      where: { id: nextBaseUomId, businessId: user.businessId }
    });
    if (!uom) throw httpError(400, 'Invalid base_uom_id');
  }

  const baseUomId = nextBaseUomId || existing.baseUomId;
  const replaceConversions = Array.isArray(body.conversions);
  const replaceSelling = Array.isArray(body.selling_prices) || Array.isArray(body.sellingPrices);

  const conversionsInput: any[] = replaceConversions ? body.conversions : [];
  const allowedUomIds = new Set<string>([baseUomId]);
  if (replaceConversions) {
    for (const c of conversionsInput) {
      const fromId = c.from_uom_id || c.fromUomId;
      const toId = c.to_uom_id || c.toUomId || baseUomId;
      const factor = Number(c.factor);
      if (!fromId) throw httpError(400, 'conversions[].from_uom_id is required');
      if (fromId === baseUomId) {
        throw httpError(400, 'Packaging UoM must be different from the base UoM');
      }
      if (!factor || factor <= 0) throw httpError(400, 'Conversion factor must be greater than 0');
      if (toId !== baseUomId) {
        throw httpError(400, 'Conversions must target the product base UoM');
      }
      allowedUomIds.add(fromId);
    }
  } else {
    for (const c of existing.conversions) {
      allowedUomIds.add(c.fromUomId);
    }
  }

  const purchaseUomId = body.purchase_uom_id || body.purchaseUomId;
  if (purchaseUomId != null && !allowedUomIds.has(purchaseUomId)) {
    throw httpError(
      400,
      'Purchase UoM must be the base unit or one of the defined packaging conversions'
    );
  }

  const sellingPricesInput: any[] | null = replaceSelling
    ? (Array.isArray(body.selling_prices) ? body.selling_prices : body.sellingPrices) || []
    : null;
  if (sellingPricesInput) {
    if (!sellingPricesInput.length) {
      throw httpError(400, 'At least one selling price is required');
    }
    for (const sp of sellingPricesInput) {
      const uomId = sp.uom_id || sp.uomId;
      if (!uomId || !allowedUomIds.has(uomId)) {
        throw httpError(
          400,
          'Each selling price UoM must be the base unit or a defined packaging conversion'
        );
      }
      if (sp.unit_price == null && sp.unitPrice == null) {
        throw httpError(400, 'selling_prices[].unit_price is required');
      }
    }
  }

  const data: Record<string, unknown> = { updatedById: user.id };
  const map: Record<string, string> = {
    name: 'name',
    product_code: 'productCode',
    productCode: 'productCode',
    sku: 'sku',
    barcode: 'barcode',
    description: 'description',
    category_id: 'categoryId',
    categoryId: 'categoryId',
    brand_id: 'brandId',
    brandId: 'brandId',
    manufacturer: 'manufacturer',
    status: 'status',
    reorder_level: 'reorderLevel',
    reorderLevel: 'reorderLevel',
    min_stock: 'minStock',
    minStock: 'minStock',
    max_stock: 'maxStock',
    maxStock: 'maxStock',
    default_purchase_cost: 'defaultPurchaseCost',
    defaultPurchaseCost: 'defaultPurchaseCost',
    default_selling_price: 'defaultSellingPrice',
    defaultSellingPrice: 'defaultSellingPrice',
    distributor_price: 'distributorPrice',
    wholesale_price: 'wholesalePrice',
    retail_price: 'retailPrice'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }
  if (nextBaseUomId) data.baseUomId = nextBaseUomId;
  if (purchaseUomId) data.purchaseUomId = purchaseUomId;

  const trackingTouched =
    body.tracking_mode != null ||
    body.trackingMode != null ||
    body.tracking_modes != null ||
    body.trackingModes != null ||
    body.track_batch != null ||
    body.trackBatch != null ||
    body.track_expiry != null ||
    body.trackExpiry != null ||
    body.track_serial != null ||
    body.trackSerial != null ||
    body.track_weight != null ||
    body.trackWeight != null ||
    body.track_length != null ||
    body.trackLength != null ||
    body.has_variants != null ||
    body.hasVariants != null;
  if (trackingTouched) {
    Object.assign(data, resolveTrackingFlags(body));
  }

  if (sellingPricesInput && sellingPricesInput.length) {
    const defaultSell =
      sellingPricesInput.find((s) => s.is_default || s.isDefault) || sellingPricesInput[0];
    data.sellingUomId = defaultSell.uom_id || defaultSell.uomId || baseUomId;
    data.defaultSellingPrice = Number(defaultSell.unit_price ?? defaultSell.unitPrice ?? 0);
    if (body.retail_price == null && body.retailPrice == null) {
      data.retailPrice = data.defaultSellingPrice;
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: data as any });

      if (replaceConversions) {
        await tx.productUnitConversion.deleteMany({ where: { productId: id } });
        for (const c of conversionsInput) {
          await tx.productUnitConversion.create({
            data: {
              id: shortId('puc'),
              businessId: user.businessId,
              productId: id,
              fromUomId: c.from_uom_id || c.fromUomId,
              toUomId: c.to_uom_id || c.toUomId || baseUomId,
              factor: c.factor
            }
          });
        }
      }

      if (sellingPricesInput) {
        await tx.productSellingPrice.deleteMany({ where: { productId: id } });
        let sawDefault = false;
        for (const sp of sellingPricesInput) {
          const isDefault = Boolean(sp.is_default ?? sp.isDefault) && !sawDefault;
          if (isDefault) sawDefault = true;
          await tx.productSellingPrice.create({
            data: {
              id: shortId('psp'),
              businessId: user.businessId,
              productId: id,
              uomId: sp.uom_id || sp.uomId,
              priceLevel: sp.price_level || sp.priceLevel || 'retail',
              label: sp.label || null,
              unitPrice: sp.unit_price ?? sp.unitPrice,
              minQty: sp.min_qty ?? sp.minQty ?? 1,
              isDefault
            }
          });
        }
        if (!sawDefault) {
          const first = await tx.productSellingPrice.findFirst({
            where: { productId: id },
            orderBy: { createdAt: 'asc' }
          });
          if (first) {
            await tx.productSellingPrice.update({
              where: { id: first.id },
              data: { isDefault: true }
            });
          }
        }
      }

      return tx.product.findFirst({
        where: { id, businessId: user.businessId },
        include: productDetailInclude
      });
    });

    await writeAudit({
      user,
      action: 'update',
      module: 'products',
      entityType: 'Product',
      entityId: id,
      summary: `Updated product ${updated?.name || id}`
    });
    return withDeleteFlag(serialize(updated) as any);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'SKU already exists for this business');
    throw err;
  }
}

export async function deleteProduct(user: AuthUser, id: string) {
  const existing = await prisma.product.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Product not found');

  if (await productIsTransacted(id, user.businessId)) {
    throw httpError(
      409,
      'Cannot delete product that has already been transacted. Deactivate it instead.'
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.productSellingPrice.deleteMany({ where: { productId: id } });
    await tx.productUnitConversion.deleteMany({ where: { productId: id } });
    await tx.productVariant.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
  });

  await writeAudit({
    user,
    action: 'delete',
    module: 'products',
    entityType: 'Product',
    entityId: id,
    summary: `Deleted product ${existing.name}`
  });
  return { ok: true, id };
}

export async function addVariant(user: AuthUser, productId: string, body: Record<string, any>) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId: user.businessId }
  });
  if (!product) throw httpError(404, 'Product not found');
  const name = requireString(body.name || `${body.colour || ''} ${body.size || ''}`.trim(), 'name');
  const created = await prisma.productVariant.create({
    data: {
      id: shortId('var'),
      businessId: user.businessId,
      productId,
      name,
      sku: body.sku || null,
      barcode: body.barcode || null,
      size: body.size || null,
      colour: body.colour || body.color || null,
      purchaseCost: body.purchase_cost ?? body.purchaseCost ?? product.defaultPurchaseCost,
      sellingPrice: body.selling_price ?? body.sellingPrice ?? product.defaultSellingPrice
    }
  });
  await prisma.product.update({ where: { id: productId }, data: { hasVariants: true } });
  return serialize(created);
}

export async function listCategories(businessId: string) {
  return serialize(
    await prisma.productCategory.findMany({
      where: { businessId },
      include: { children: true },
      orderBy: { name: 'asc' }
    })
  );
}

export async function createCategory(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  try {
    const row = await prisma.productCategory.create({
      data: {
        id: shortId('cat'),
        businessId: user.businessId,
        name,
        code: body.code || null,
        parentId: body.parent_id || body.parentId || null,
        description: body.description || null
      }
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Category name already exists');
    throw err;
  }
}

export async function listBrands(businessId: string) {
  return serialize(
    await prisma.brand.findMany({ where: { businessId }, orderBy: { name: 'asc' } })
  );
}

export async function createBrand(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  try {
    return serialize(
      await prisma.brand.create({
        data: {
          id: shortId('brd'),
          businessId: user.businessId,
          name,
          code: body.code || null
        }
      })
    );
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Brand name already exists');
    throw err;
  }
}
