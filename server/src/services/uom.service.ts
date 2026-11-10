import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';

export async function listUoms(businessId: string) {
  return serialize(
    await prisma.unitOfMeasure.findMany({
      where: { businessId },
      orderBy: [{ unitCategory: 'asc' }, { code: 'asc' }]
    })
  );
}

export async function createUom(user: AuthUser, body: Record<string, any>) {
  const code = requireString(body.code, 'code').toUpperCase();
  const name = requireString(body.name, 'name');
  try {
    return serialize(
      await prisma.unitOfMeasure.create({
        data: {
          id: shortId('uom'),
          businessId: user.businessId,
          code,
          name,
          unitCategory: body.unit_category || body.unitCategory || 'Count',
          allowsDecimal: Boolean(body.allows_decimal ?? body.allowsDecimal)
        }
      })
    );
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'UoM code already exists');
    throw err;
  }
}

export async function updateUom(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.unitOfMeasure.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Unit not found');
  return serialize(
    await prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(body.name != null ? { name: String(body.name).trim() } : {}),
        ...(body.unit_category != null || body.unitCategory != null
          ? { unitCategory: body.unit_category || body.unitCategory }
          : {}),
        ...(body.allows_decimal != null || body.allowsDecimal != null
          ? { allowsDecimal: Boolean(body.allows_decimal ?? body.allowsDecimal) }
          : {}),
        ...(body.is_active != null || body.isActive != null
          ? { isActive: Boolean(body.is_active ?? body.isActive) }
          : {})
      }
    })
  );
}

export async function addProductConversion(
  user: AuthUser,
  productId: string,
  body: Record<string, any>
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId: user.businessId }
  });
  if (!product) throw httpError(404, 'Product not found');
  const fromUomId = requireString(body.from_uom_id || body.fromUomId, 'from_uom_id');
  const toUomId = body.to_uom_id || body.toUomId || product.baseUomId;
  const factor = Number(body.factor);
  if (!factor || factor <= 0) throw httpError(400, 'factor must be a positive number');

  try {
    return serialize(
      await prisma.productUnitConversion.create({
        data: {
          id: shortId('puc'),
          businessId: user.businessId,
          productId,
          fromUomId,
          toUomId,
          factor
        },
        include: { fromUom: true, toUom: true }
      })
    );
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Conversion already exists');
    throw err;
  }
}
