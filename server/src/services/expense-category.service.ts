import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { auditDiff, writeAudit } from './audit.service.js';

type CatalogListOpts = { activeOnly?: boolean };

function catalogFlags(lineCount: number) {
  return {
    line_count: lineCount,
    can_delete: lineCount === 0,
    can_disable: true
  };
}

async function assertExpenseAccount(businessId: string, accountId: string) {
  const acc = await prisma.account.findFirst({
    where: { id: accountId, businessId, isActive: true }
  });
  if (!acc) throw httpError(400, 'Invalid account_id');
  if (acc.accountType !== 'expense' && acc.accountType !== 'cogs') {
    throw httpError(400, 'Category account must be an expense (or COGS) account');
  }
  return acc;
}

export async function listCategories(businessId: string, opts: CatalogListOpts = {}) {
  const rows = await prisma.expenseCategory.findMany({
    where: {
      businessId,
      ...(opts.activeOnly ? { isActive: true } : {})
    },
    include: {
      account: true,
      _count: { select: { lines: true } }
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  return serialize(
    rows.map((r) => {
      const { _count, ...rest } = r;
      return {
        ...rest,
        ...catalogFlags(_count.lines)
      };
    })
  );
}

export async function getCategory(businessId: string, id: string) {
  const row = await prisma.expenseCategory.findFirst({
    where: { id, businessId },
    include: { account: true, _count: { select: { lines: true } } }
  });
  if (!row) throw httpError(404, 'Expense category not found');
  const { _count, ...rest } = row;
  return serialize({ ...rest, ...catalogFlags(_count.lines) });
}

export async function createCategory(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name').trim();
  const accountId = requireString(body.account_id ?? body.accountId, 'account_id').trim();
  await assertExpenseAccount(user.businessId, accountId);

  try {
    const row = await prisma.expenseCategory.create({
      data: {
        id: shortId('exc'),
        businessId: user.businessId,
        name,
        code: body.code ? String(body.code).trim() : null,
        accountId,
        description: body.description || null,
        sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0) || 0,
        isActive: body.is_active !== undefined || body.isActive !== undefined
          ? Boolean(body.is_active ?? body.isActive)
          : true
      },
      include: { account: true }
    });

    await writeAudit({
      user,
      action: 'create',
      module: 'expenses',
      entityType: 'ExpenseCategory',
      entityId: row.id,
      summary: `Created expense category ${row.name}`
    });

    return serialize({ ...row, ...catalogFlags(0) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Category name already exists');
    throw err;
  }
}

export async function updateCategory(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.expenseCategory.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Expense category not found');

  const nextActive =
    body.is_active !== undefined || body.isActive !== undefined
      ? Boolean(body.is_active ?? body.isActive)
      : undefined;

  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = String(body.name).trim();
  if (body.code !== undefined) data.code = body.code ? String(body.code).trim() : null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    data.sortOrder = Number(body.sort_order ?? body.sortOrder ?? 0) || 0;
  }
  if (body.account_id !== undefined || body.accountId !== undefined) {
    const accountId = String(body.account_id ?? body.accountId).trim();
    await assertExpenseAccount(user.businessId, accountId);
    data.accountId = accountId;
  }
  if (nextActive !== undefined) data.isActive = nextActive;

  if (data.isActive === true && (data.accountId || existing.accountId)) {
    await assertExpenseAccount(
      user.businessId,
      String(data.accountId || existing.accountId)
    );
  }

  try {
    const row = await prisma.expenseCategory.update({
      where: { id },
      data: data as any,
      include: { account: true, _count: { select: { lines: true } } }
    });

    await writeAudit({
      user,
      action: 'update',
      module: 'expenses',
      entityType: 'ExpenseCategory',
      entityId: row.id,
      summary: `Updated expense category ${row.name}`,
      changes: auditDiff(existing as any, data)
    });

    const { _count, ...rest } = row;
    return serialize({ ...rest, ...catalogFlags(_count.lines) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Category name already exists');
    throw err;
  }
}

export async function deleteCategory(user: AuthUser, id: string) {
  const existing = await prisma.expenseCategory.findFirst({
    where: { id, businessId: user.businessId },
    include: { _count: { select: { lines: true } } }
  });
  if (!existing) throw httpError(404, 'Expense category not found');
  if (existing._count.lines > 0) {
    throw httpError(
      409,
      'Cannot delete: expense lines still use this category. Disable it instead.'
    );
  }

  await prisma.expenseCategory.delete({ where: { id } });

  await writeAudit({
    user,
    action: 'delete',
    module: 'expenses',
    entityType: 'ExpenseCategory',
    entityId: id,
    summary: `Deleted expense category ${existing.name}`
  });

  return { deleted: true, id };
}
