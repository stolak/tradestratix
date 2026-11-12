import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

const DEFAULT_CATEGORIES: {
  code: string;
  name: string;
  allowInterBranchTransfer: boolean;
  allowInterBranchPickup: boolean;
}[] = [
  {
    code: 'main',
    name: 'Main',
    allowInterBranchTransfer: true,
    allowInterBranchPickup: true
  },
  {
    code: 'retail',
    name: 'Retail',
    allowInterBranchTransfer: true,
    allowInterBranchPickup: true
  },
  {
    code: 'damaged',
    name: 'Damaged',
    allowInterBranchTransfer: false,
    allowInterBranchPickup: false
  },
  {
    code: 'quarantine',
    name: 'Quarantine',
    allowInterBranchTransfer: false,
    allowInterBranchPickup: false
  }
];

/** Ensure the built-in categories exist and link legacy warehouse.category strings. */
export async function ensureDefaultWarehouseCategories(businessId: string, createdById?: string | null) {
  for (const def of DEFAULT_CATEGORIES) {
    const existing = await prisma.warehouseCategory.findFirst({
      where: { businessId, code: def.code }
    });
    if (existing) continue;
    await prisma.warehouseCategory.create({
      data: {
        id: shortId('whc'),
        businessId,
        code: def.code,
        name: def.name,
        allowInterBranchTransfer: def.allowInterBranchTransfer,
        allowInterBranchPickup: def.allowInterBranchPickup,
        createdById: createdById || null
      }
    });
  }

  const cats = await prisma.warehouseCategory.findMany({
    where: { businessId },
    select: { id: true, code: true }
  });
  const byCode = new Map(cats.map((c) => [c.code.toLowerCase(), c.id]));
  const unlinked = await prisma.warehouse.findMany({
    where: { businessId, categoryId: null },
    select: { id: true, category: true }
  });
  for (const wh of unlinked) {
    const catId = byCode.get(String(wh.category || 'main').toLowerCase()) || byCode.get('main');
    if (!catId) continue;
    await prisma.warehouse.update({
      where: { id: wh.id },
      data: { categoryId: catId, category: String(wh.category || 'main').toLowerCase() }
    });
  }
}

export async function listWarehouseCategories(user: AuthUser, opts?: { activeOnly?: boolean }) {
  await ensureDefaultWarehouseCategories(user.businessId, user.id);
  const rows = await prisma.warehouseCategory.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.activeOnly ? { isActive: true } : {})
    },
    include: {
      _count: {
        select: {
          warehouses: true
        }
      },
      warehouses: {
        where: { isActive: true },
        select: { id: true }
      }
    },
    orderBy: [{ name: 'asc' }]
  });

  return serialize(
    rows.map((r) => {
      const activeWarehouseCount = r.warehouses.length;
      const warehouseCount = r._count.warehouses;
      const { warehouses: _w, ...rest } = r;
      return {
        ...rest,
        warehouse_count: warehouseCount,
        active_warehouse_count: activeWarehouseCount,
        can_delete: warehouseCount === 0,
        can_disable: activeWarehouseCount === 0
      };
    })
  );
}

export async function createWarehouseCategory(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name').trim();
  const code = requireString(body.code, 'code').trim().toLowerCase();
  const allowTransfer =
    body.allow_inter_branch_transfer !== undefined || body.allowInterBranchTransfer !== undefined
      ? Boolean(body.allow_inter_branch_transfer ?? body.allowInterBranchTransfer)
      : true;
  const allowPickup =
    body.allow_inter_branch_pickup !== undefined || body.allowInterBranchPickup !== undefined
      ? Boolean(body.allow_inter_branch_pickup ?? body.allowInterBranchPickup)
      : true;

  try {
    const created = await prisma.warehouseCategory.create({
      data: {
        id: shortId('whc'),
        businessId: user.businessId,
        name,
        code,
        allowInterBranchTransfer: allowTransfer,
        allowInterBranchPickup: allowPickup,
        createdById: user.id
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'warehouses',
      entityType: 'WarehouseCategory',
      entityId: created.id,
      summary: `Created warehouse category ${code}`
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Category name or code already exists');
    throw err;
  }
}

export async function updateWarehouseCategory(
  user: AuthUser,
  id: string,
  body: Record<string, any>
) {
  const existing = await prisma.warehouseCategory.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warehouse category not found');

  const nextActive =
    body.is_active !== undefined || body.isActive !== undefined
      ? Boolean(body.is_active ?? body.isActive)
      : undefined;

  if (nextActive === false && existing.isActive) {
    const activeWh = await prisma.warehouse.count({
      where: { businessId: user.businessId, categoryId: id, isActive: true }
    });
    if (activeWh > 0) {
      throw httpError(
        409,
        `Cannot disable: ${activeWh} active warehouse(s) still use this category`
      );
    }
  }

  const data: Record<string, unknown> = { updatedById: user.id };
  if (body.name != null) data.name = String(body.name).trim();
  if (body.code != null) data.code = String(body.code).trim().toLowerCase();
  if (body.allow_inter_branch_transfer !== undefined || body.allowInterBranchTransfer !== undefined) {
    data.allowInterBranchTransfer = Boolean(
      body.allow_inter_branch_transfer ?? body.allowInterBranchTransfer
    );
  }
  if (body.allow_inter_branch_pickup !== undefined || body.allowInterBranchPickup !== undefined) {
    data.allowInterBranchPickup = Boolean(
      body.allow_inter_branch_pickup ?? body.allowInterBranchPickup
    );
  }
  if (nextActive !== undefined) data.isActive = nextActive;

  try {
    const updated = await prisma.warehouseCategory.update({
      where: { id },
      data: data as any
    });

    // Keep denormalized warehouse.category code in sync when code changes.
    if (body.code != null && String(body.code).trim().toLowerCase() !== existing.code) {
      await prisma.warehouse.updateMany({
        where: { businessId: user.businessId, categoryId: id },
        data: { category: updated.code }
      });
    }

    await writeAudit({
      user,
      action: 'update',
      module: 'warehouses',
      entityType: 'WarehouseCategory',
      entityId: id,
      summary: `Updated warehouse category ${updated.code}`
    });
    return serialize(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Category name or code already exists');
    throw err;
  }
}

export async function deleteWarehouseCategory(user: AuthUser, id: string) {
  const existing = await prisma.warehouseCategory.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warehouse category not found');

  const warehouseCount = await prisma.warehouse.count({
    where: { businessId: user.businessId, categoryId: id }
  });
  if (warehouseCount > 0) {
    throw httpError(
      409,
      `Cannot delete: ${warehouseCount} warehouse(s) still use this category. Reassign or delete them first.`
    );
  }

  await prisma.warehouseCategory.delete({ where: { id } });
  await writeAudit({
    user,
    action: 'delete',
    module: 'warehouses',
    entityType: 'WarehouseCategory',
    entityId: id,
    summary: `Deleted warehouse category ${existing.code}`
  });
  return { deleted: true, id };
}

/** Resolve category id/code for warehouse create/update. */
export async function resolveWarehouseCategory(
  businessId: string,
  body: Record<string, any>,
  userId?: string | null
) {
  await ensureDefaultWarehouseCategories(businessId, userId);
  const categoryId = body.category_id || body.categoryId || null;
  const categoryCode =
    body.category != null ? String(body.category).trim().toLowerCase() : null;

  if (categoryId) {
    const cat = await prisma.warehouseCategory.findFirst({
      where: { id: String(categoryId), businessId, isActive: true }
    });
    if (!cat) throw httpError(400, 'Invalid or inactive category_id');
    return cat;
  }

  const code = categoryCode || 'main';
  const cat = await prisma.warehouseCategory.findFirst({
    where: { businessId, code, isActive: true }
  });
  if (!cat) throw httpError(400, `Invalid or inactive warehouse category "${code}"`);
  return cat;
}
