import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

/** Active branch overrides keyed by ProductSellingPrice id. */
export async function getBranchPriceMap(
  businessId: string,
  branchId: string | null | undefined,
  sellingPriceIds?: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!branchId) return map;
  if (sellingPriceIds && !sellingPriceIds.length) return map;
  const rows = await prisma.branchSellingPrice.findMany({
    where: {
      businessId,
      branchId,
      isActive: true,
      ...(sellingPriceIds ? { sellingPriceId: { in: sellingPriceIds } } : {})
    },
    select: { sellingPriceId: true, unitPrice: true }
  });
  for (const r of rows) map.set(r.sellingPriceId, Number(r.unitPrice));
  return map;
}

/** Active branch discount % keyed by product id. */
export async function getBranchDiscountMap(
  businessId: string,
  branchId: string | null | undefined,
  productIds?: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!branchId) return map;
  if (productIds && !productIds.length) return map;
  const rows = await prisma.branchProductDiscount.findMany({
    where: {
      businessId,
      branchId,
      isActive: true,
      ...(productIds ? { productId: { in: productIds } } : {})
    },
    select: { productId: true, discountPercent: true }
  });
  for (const r of rows) map.set(r.productId, Number(r.discountPercent));
  return map;
}

export function applyDiscount(price: number, discountPercent: number | null | undefined) {
  if (!discountPercent) return roundMoney(price);
  return roundMoney(price * (1 - discountPercent / 100));
}

/**
 * Annotate serialized products with branch pricing:
 * - product.branch_discount_percent (null when none)
 * - selling_prices[].global_unit_price, branch_unit_price (null when not overridden),
 *   pre_discount_unit_price, effective_unit_price (what the branch actually charges)
 */
export async function applyBranchPricing<T extends { id: string; selling_prices?: any[] }>(
  businessId: string,
  branchId: string | null | undefined,
  products: T[]
): Promise<T[]> {
  const ids = products.flatMap((p) => (p.selling_prices || []).map((sp: any) => sp.id));
  const [overrides, discounts] = await Promise.all([
    getBranchPriceMap(businessId, branchId, ids),
    getBranchDiscountMap(
      businessId,
      branchId,
      products.map((p) => p.id)
    )
  ]);
  return products.map((p) => {
    const discount = discounts.has(p.id) ? discounts.get(p.id)! : null;
    return {
      ...p,
      branch_discount_percent: discount,
      selling_prices: (p.selling_prices || []).map((sp: any) => {
        const branchPrice = overrides.has(sp.id) ? overrides.get(sp.id)! : null;
        const base = branchPrice ?? Number(sp.unit_price);
        return {
          ...sp,
          global_unit_price: sp.unit_price,
          branch_unit_price: branchPrice,
          pre_discount_unit_price: base,
          effective_unit_price: applyDiscount(base, discount)
        };
      })
    };
  });
}

export async function listBranchPricing(user: AuthUser, branchIdInput?: string | null, q?: string) {
  const branchId = branchIdInput || user.activeBranchId;
  if (!branchId) throw httpError(400, 'branch_id is required');
  const branch = await branchAccess.assertBranchMembership(user, branchId);

  const products = await prisma.product.findMany({
    where: {
      businessId: user.businessId,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { productCode: { contains: q } }
            ]
          }
        : {})
    },
    select: {
      id: true,
      name: true,
      sku: true,
      branchDiscounts: { where: { branchId, isActive: true } },
      sellingPrices: {
        where: { isActive: true },
        include: {
          uom: { select: { id: true, code: true, name: true } },
          branchOverrides: { where: { branchId } }
        },
        orderBy: [{ uomId: 'asc' }, { priceLevel: 'asc' }]
      }
    },
    orderBy: { name: 'asc' }
  });

  return {
    branch: serialize({ id: branch.id, code: branch.code, name: branch.name }),
    products: products
      .filter((p) => p.sellingPrices.length)
      .map((p) => {
        const discount = p.branchDiscounts[0] ? Number(p.branchDiscounts[0].discountPercent) : null;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          discount_percent: discount,
          prices: p.sellingPrices.map((sp) => {
            const ov = sp.branchOverrides.find((o) => o.isActive) || null;
            const base = ov ? Number(ov.unitPrice) : Number(sp.unitPrice);
            return {
              selling_price_id: sp.id,
              uom: sp.uom,
              price_level: sp.priceLevel,
              label: sp.label,
              is_default: sp.isDefault,
              global_unit_price: Number(sp.unitPrice),
              branch_unit_price: ov ? Number(ov.unitPrice) : null,
              pre_discount_unit_price: base,
              effective_unit_price: applyDiscount(base, discount),
              updated_at: ov?.updatedAt ?? null
            };
          })
        };
      })
  };
}

export async function setBranchPrice(user: AuthUser, body: Record<string, any>) {
  const branchId = requireString(body.branch_id || body.branchId || user.activeBranchId, 'branch_id');
  const sellingPriceId = requireString(
    body.selling_price_id || body.sellingPriceId,
    'selling_price_id'
  );
  const unitPrice = Number(body.unit_price ?? body.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw httpError(400, 'unit_price must be a number ≥ 0');
  }

  const branch = await branchAccess.assertBranchMembership(user, branchId);
  const sp = await prisma.productSellingPrice.findFirst({
    where: { id: sellingPriceId, businessId: user.businessId },
    include: { product: { select: { name: true } }, uom: { select: { code: true } } }
  });
  if (!sp) throw httpError(404, 'Selling price not found');

  const existing = await prisma.branchSellingPrice.findUnique({
    where: { branchId_sellingPriceId: { branchId, sellingPriceId } }
  });
  const row = existing
    ? await prisma.branchSellingPrice.update({
        where: { id: existing.id },
        data: { unitPrice: toDec(unitPrice), isActive: true, updatedById: user.id }
      })
    : await prisma.branchSellingPrice.create({
        data: {
          id: shortId('bsp'),
          businessId: user.businessId,
          branchId,
          sellingPriceId,
          unitPrice: toDec(unitPrice),
          createdById: user.id,
          updatedById: user.id
        }
      });

  await writeAudit({
    user,
    action: existing ? 'update' : 'create',
    module: 'products',
    entityType: 'BranchSellingPrice',
    entityId: row.id,
    summary: `${branch.code}: ${sp.product.name} ${sp.uom.code} ${sp.priceLevel} price ${
      existing ? `${Number(existing.unitPrice)} → ` : `(global ${Number(sp.unitPrice)}) → `
    }${unitPrice}`
  });

  return serialize(row);
}

export async function setBranchDiscount(user: AuthUser, body: Record<string, any>) {
  const branchId = requireString(body.branch_id || body.branchId || user.activeBranchId, 'branch_id');
  const productId = requireString(body.product_id || body.productId, 'product_id');
  const pct = Number(body.discount_percent ?? body.discountPercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    throw httpError(400, 'discount_percent must be greater than 0 and less than 100');
  }

  const branch = await branchAccess.assertBranchMembership(user, branchId);
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId: user.businessId },
    select: { id: true, name: true }
  });
  if (!product) throw httpError(404, 'Product not found');

  const existing = await prisma.branchProductDiscount.findUnique({
    where: { branchId_productId: { branchId, productId } }
  });
  const row = existing
    ? await prisma.branchProductDiscount.update({
        where: { id: existing.id },
        data: { discountPercent: toDec(pct), isActive: true, updatedById: user.id }
      })
    : await prisma.branchProductDiscount.create({
        data: {
          id: shortId('bpd'),
          businessId: user.businessId,
          branchId,
          productId,
          discountPercent: toDec(pct),
          createdById: user.id,
          updatedById: user.id
        }
      });

  await writeAudit({
    user,
    action: existing ? 'update' : 'create',
    module: 'products',
    entityType: 'BranchProductDiscount',
    entityId: row.id,
    summary: `${branch.code}: ${product.name} discount ${
      existing ? `${Number(existing.discountPercent)}% → ` : ''
    }${pct}%`
  });
  return serialize(row);
}

export async function clearBranchDiscount(user: AuthUser, branchId: string, productId: string) {
  const branch = await branchAccess.assertBranchMembership(user, branchId);
  const existing = await prisma.branchProductDiscount.findFirst({
    where: { businessId: user.businessId, branchId, productId },
    include: { product: { select: { name: true } } }
  });
  if (!existing) throw httpError(404, 'No branch discount for this product');
  await prisma.branchProductDiscount.delete({ where: { id: existing.id } });

  await writeAudit({
    user,
    action: 'delete',
    module: 'products',
    entityType: 'BranchProductDiscount',
    entityId: existing.id,
    summary: `${branch.code}: ${existing.product.name} discount ${Number(existing.discountPercent)}% removed`
  });
  return { ok: true };
}

export async function clearBranchPrice(user: AuthUser, branchId: string, sellingPriceId: string) {
  const branch = await branchAccess.assertBranchMembership(user, branchId);
  const existing = await prisma.branchSellingPrice.findFirst({
    where: { businessId: user.businessId, branchId, sellingPriceId },
    include: {
      sellingPrice: {
        include: { product: { select: { name: true } }, uom: { select: { code: true } } }
      }
    }
  });
  if (!existing) throw httpError(404, 'No branch override for this price');
  await prisma.branchSellingPrice.delete({ where: { id: existing.id } });

  await writeAudit({
    user,
    action: 'delete',
    module: 'products',
    entityType: 'BranchSellingPrice',
    entityId: existing.id,
    summary: `${branch.code}: ${existing.sellingPrice.product.name} ${existing.sellingPrice.uom.code} back to global price ${Number(existing.sellingPrice.unitPrice)}`
  });
  return { ok: true };
}
