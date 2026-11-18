import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

async function assertAccount(
  businessId: string,
  accountId: string | null | undefined,
  allowedTypes: string[],
  label: string
) {
  if (!accountId) return null;
  const acc = await prisma.account.findFirst({ where: { id: accountId, businessId } });
  if (!acc) throw httpError(400, `Invalid ${label}`);
  if (!acc.isActive) throw httpError(400, `${label} account is inactive`);
  if (!allowedTypes.includes(acc.accountType)) {
    throw httpError(400, `${label} must be one of: ${allowedTypes.join(', ')}`);
  }
  return acc.id;
}

function parseAccounts(body: Record<string, any>) {
  return {
    costAccountId: body.cost_account_id || body.costAccountId || null,
    accumDepAccountId: body.accum_dep_account_id || body.accumDepAccountId || null,
    depExpenseAccountId: body.dep_expense_account_id || body.depExpenseAccountId || null,
    impairmentAccountId: body.impairment_account_id || body.impairmentAccountId || null,
    disposalGainAccountId: body.disposal_gain_account_id || body.disposalGainAccountId || null,
    disposalLossAccountId: body.disposal_loss_account_id || body.disposalLossAccountId || null,
    cipAccountId: body.cip_account_id || body.cipAccountId || null
  };
}

const include = {
  costAccount: true,
  accumDepAccount: true,
  depExpenseAccount: true,
  impairmentAccount: true,
  disposalGainAccount: true,
  disposalLossAccount: true,
  cipAccount: true
};

const DEFAULT_CATEGORIES: {
  code: string;
  name: string;
  usefulLife: number;
  method?: string;
}[] = [
  // IAS 16 / US GAAP: freehold land has unlimited useful life → not depreciated
  { code: 'LAND', name: 'Land', usefulLife: 0, method: 'none' },
  { code: 'BUILDING', name: 'Buildings', usefulLife: 240 },
  { code: 'PLANT', name: 'Plant and machinery', usefulLife: 120 },
  { code: 'VEHICLE', name: 'Vehicles', usefulLife: 60 },
  { code: 'COMPUTER', name: 'Computers', usefulLife: 36 },
  { code: 'FURNITURE', name: 'Office furniture', usefulLife: 60 },
  { code: 'EQUIPMENT', name: 'Equipment', usefulLife: 60 },
  { code: 'FIXTURE', name: 'Fixtures and fittings', usefulLife: 60 }
];

const DEPRECIATION_METHODS = new Set([
  'straight_line',
  'reducing_balance',
  'units_of_production',
  'none'
]);

function normalizeDepreciationMethod(raw: unknown, fallback = 'straight_line') {
  const method = String(raw || fallback).trim().toLowerCase() || fallback;
  if (!DEPRECIATION_METHODS.has(method)) {
    throw httpError(
      400,
      `Invalid depreciation method. Use: ${[...DEPRECIATION_METHODS].join(', ')}`
    );
  }
  return method;
}

/** Seed standard categories when the business has none (idempotent). */
export async function ensureDefaultCategories(user: AuthUser) {
  const count = await prisma.assetCategory.count({ where: { businessId: user.businessId } });
  if (count > 0) return listCategories(user);

  const { getDefaultAccountMap } = await import('./accounting.service.js');
  const map = await getDefaultAccountMap(user.businessId);

  for (const c of DEFAULT_CATEGORIES) {
    await prisma.assetCategory.create({
      data: {
        id: shortId('acat'),
        businessId: user.businessId,
        code: c.code,
        name: c.name,
        assetType: 'tangible',
        defaultUsefulLifeMonths: c.method === 'none' ? 0 : c.usefulLife || 36,
        defaultDepreciationMethod: c.method || 'straight_line',
        capitalisationThreshold: toDec(0),
        defaultResidualPercent: toDec(0),
        costAccountId: map.fixed_assets || null,
        accumDepAccountId: map.accumulated_depreciation || null,
        depExpenseAccountId: map.depreciation_expense || null,
        createdById: user.id
      }
    });
  }

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetCategory',
    entityId: user.businessId,
    summary: 'Seeded default asset categories'
  });
  return listCategories(user);
}

export async function listCategories(user: AuthUser, opts?: { activeOnly?: boolean; ensureDefaults?: boolean }) {
  if (opts?.ensureDefaults !== false) {
    const count = await prisma.assetCategory.count({ where: { businessId: user.businessId } });
    if (count === 0) return ensureDefaultCategories(user);
  }
  const rows = await prisma.assetCategory.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.activeOnly ? { isActive: true } : {})
    },
    include,
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function getCategory(user: AuthUser, id: string) {
  const row = await prisma.assetCategory.findFirst({
    where: { id, businessId: user.businessId },
    include
  });
  if (!row) throw httpError(404, 'Asset category not found');
  return serialize(row);
}

export async function createCategory(user: AuthUser, body: Record<string, any>) {
  const code = requireString(body.code, 'code').toUpperCase();
  const name = requireString(body.name, 'name');
  const accounts = parseAccounts(body);

  await assertAccount(user.businessId, accounts.costAccountId, ['asset'], 'cost account');
  await assertAccount(user.businessId, accounts.accumDepAccountId, ['asset'], 'accum dep account');
  await assertAccount(user.businessId, accounts.depExpenseAccountId, ['expense'], 'dep expense account');
  await assertAccount(user.businessId, accounts.impairmentAccountId, ['asset', 'expense'], 'impairment account');
  await assertAccount(user.businessId, accounts.disposalGainAccountId, ['revenue', 'equity'], 'disposal gain account');
  await assertAccount(user.businessId, accounts.disposalLossAccountId, ['expense'], 'disposal loss account');
  await assertAccount(user.businessId, accounts.cipAccountId, ['asset'], 'CIP account');

  const exists = await prisma.assetCategory.findFirst({
    where: { businessId: user.businessId, code }
  });
  if (exists) throw httpError(400, 'Category code already exists');

  const method = normalizeDepreciationMethod(
    body.default_depreciation_method || body.defaultDepreciationMethod || 'straight_line'
  );
  const useful = Number(body.default_useful_life_months ?? body.defaultUsefulLifeMonths ?? (method === 'none' ? 0 : 36));
  if (method === 'none') {
    if (useful < 0) throw httpError(400, 'default_useful_life_months cannot be negative');
  } else if (!useful || useful <= 0) {
    throw httpError(400, 'default_useful_life_months must be > 0');
  }

  const row = await prisma.assetCategory.create({
    data: {
      id: shortId('acat'),
      businessId: user.businessId,
      code,
      name,
      description: body.description || null,
      assetType: body.asset_type || body.assetType || 'tangible',
      capitalisationThreshold: toDec(
        roundMoney(Number(body.capitalisation_threshold ?? body.capitalisationThreshold ?? 0))
      ),
      defaultUsefulLifeMonths: method === 'none' ? 0 : useful,
      defaultDepreciationMethod: method,
      defaultResidualPercent: toDec(
        Number(body.default_residual_percent ?? body.defaultResidualPercent ?? 0)
      ),
      ...accounts,
      createdById: user.id
    },
    include
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetCategory',
    entityId: row.id,
    summary: `Created asset category ${code}`
  });
  return serialize(row);
}

export async function updateCategory(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.assetCategory.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Asset category not found');

  const accounts = parseAccounts(body);
  if (body.cost_account_id !== undefined || body.costAccountId !== undefined) {
    await assertAccount(user.businessId, accounts.costAccountId, ['asset'], 'cost account');
  }
  if (body.accum_dep_account_id !== undefined || body.accumDepAccountId !== undefined) {
    await assertAccount(user.businessId, accounts.accumDepAccountId, ['asset'], 'accum dep account');
  }
  if (body.dep_expense_account_id !== undefined || body.depExpenseAccountId !== undefined) {
    await assertAccount(user.businessId, accounts.depExpenseAccountId, ['expense'], 'dep expense account');
  }

  let code = existing.code;
  if (body.code != null) {
    code = String(body.code).trim().toUpperCase();
    const clash = await prisma.assetCategory.findFirst({
      where: { businessId: user.businessId, code, NOT: { id } }
    });
    if (clash) throw httpError(400, 'Category code already exists');
  }

  const row = await prisma.assetCategory.update({
    where: { id },
    data: {
      code,
      name: body.name != null ? String(body.name).trim() : undefined,
      description: body.description !== undefined ? body.description || null : undefined,
      assetType: body.asset_type || body.assetType || undefined,
      capitalisationThreshold:
        body.capitalisation_threshold != null || body.capitalisationThreshold != null
          ? toDec(roundMoney(Number(body.capitalisation_threshold ?? body.capitalisationThreshold)))
          : undefined,
      defaultUsefulLifeMonths:
        body.default_useful_life_months != null || body.defaultUsefulLifeMonths != null
          ? Number(body.default_useful_life_months ?? body.defaultUsefulLifeMonths)
          : body.default_depreciation_method === 'none' || body.defaultDepreciationMethod === 'none'
            ? 0
            : undefined,
      defaultDepreciationMethod:
        body.default_depreciation_method != null || body.defaultDepreciationMethod != null
          ? normalizeDepreciationMethod(
              body.default_depreciation_method || body.defaultDepreciationMethod
            )
          : undefined,
      defaultResidualPercent:
        body.default_residual_percent != null || body.defaultResidualPercent != null
          ? toDec(Number(body.default_residual_percent ?? body.defaultResidualPercent))
          : undefined,
      ...(body.cost_account_id !== undefined || body.costAccountId !== undefined
        ? { costAccountId: accounts.costAccountId }
        : {}),
      ...(body.accum_dep_account_id !== undefined || body.accumDepAccountId !== undefined
        ? { accumDepAccountId: accounts.accumDepAccountId }
        : {}),
      ...(body.dep_expense_account_id !== undefined || body.depExpenseAccountId !== undefined
        ? { depExpenseAccountId: accounts.depExpenseAccountId }
        : {}),
      ...(body.impairment_account_id !== undefined || body.impairmentAccountId !== undefined
        ? { impairmentAccountId: accounts.impairmentAccountId }
        : {}),
      ...(body.disposal_gain_account_id !== undefined || body.disposalGainAccountId !== undefined
        ? { disposalGainAccountId: accounts.disposalGainAccountId }
        : {}),
      ...(body.disposal_loss_account_id !== undefined || body.disposalLossAccountId !== undefined
        ? { disposalLossAccountId: accounts.disposalLossAccountId }
        : {}),
      ...(body.cip_account_id !== undefined || body.cipAccountId !== undefined
        ? { cipAccountId: accounts.cipAccountId }
        : {}),
      isActive:
        body.is_active != null || body.isActive != null
          ? Boolean(body.is_active ?? body.isActive)
          : undefined
    },
    include
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'AssetCategory',
    entityId: id,
    summary: `Updated asset category ${row.code}`
  });
  return serialize(row);
}
