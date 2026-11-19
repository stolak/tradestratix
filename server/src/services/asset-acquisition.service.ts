import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import { createStockMovement } from './inventory.service.js';
import * as branchAccess from './branch-access.service.js';

const acqInclude = {
  branch: true,
  supplier: { select: { id: true, code: true, name: true } },
  category: true,
  location: true,
  capitalisedAsset: { select: { id: true, code: true, name: true, financialStatus: true } },
  costAdditions: true,
  capitalisations: {
    include: { asset: { select: { id: true, code: true, name: true, serialNumber: true } } }
  }
};

function totalCost(row: {
  purchaseCost: unknown;
  freightCost?: unknown;
  installationCost?: unknown;
  otherCapitalCost?: unknown;
  costAdditions?: { amount: unknown }[];
}) {
  const base =
    Number(row.purchaseCost || 0) +
    Number(row.freightCost || 0) +
    Number(row.installationCost || 0) +
    Number(row.otherCapitalCost || 0);
  const additions = (row.costAdditions || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  return roundMoney(base + additions);
}

/** Split a lot amount across N units; remainder cents go to the last unit. */
function allocateAcross(total: number, quantity: number): number[] {
  const qty = Math.max(1, quantity);
  if (qty === 1) return [roundMoney(total)];
  const each = roundMoney(total / qty);
  const parts = Array.from({ length: qty }, () => each);
  const allocated = roundMoney(each * (qty - 1));
  parts[qty - 1] = roundMoney(total - allocated);
  return parts;
}

export function parseSerialNumbers(input: unknown): string[] {
  if (input == null || input === '') return [];
  let raw: string[] = [];
  if (Array.isArray(input)) {
    raw = input.map((x) => String(x ?? '').trim());
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) raw = parsed.map((x) => String(x ?? '').trim());
        else raw = [trimmed];
      } catch {
        raw = trimmed.split(/[\n,;]+/).map((s) => s.trim());
      }
    } else {
      raw = trimmed.split(/[\n,;]+/).map((s) => s.trim());
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) {
      throw httpError(400, `Duplicate serial in list: ${s}`);
    }
    seen.add(key);
    out.push(s);
  }
  return out;
}

function serialsToJson(serials: string[]): string | null {
  return serials.length ? JSON.stringify(serials) : null;
}

async function assertSerialsAvailable(
  businessId: string,
  serials: string[],
  tx?: { fixedAsset: typeof prisma.fixedAsset }
) {
  if (!serials.length) return;
  const db = tx || prisma;
  const existing = await db.fixedAsset.findMany({
    where: { businessId, serialNumber: { in: serials } },
    select: { serialNumber: true, code: true }
  });
  if (existing.length) {
    const list = existing.map((e) => `${e.serialNumber} (${e.code || e.serialNumber})`).join(', ');
    throw httpError(400, `Serial number(s) already on register: ${list}`);
  }
}

/** Next N asset tags: {CAT}-{YYYY}-{####} */
export async function nextAssetCodes(
  businessId: string,
  categoryCode: string | null | undefined,
  count: number,
  tx?: { fixedAsset: { findFirst: typeof prisma.fixedAsset.findFirst } }
) {
  const db = tx || prisma;
  const year = new Date().getFullYear();
  const prefix = `${String(categoryCode || 'FA')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12) || 'FA'}-${year}-`;
  const latest = await db.fixedAsset.findFirst({
    where: { businessId, code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true }
  });
  let seq = latest?.code ? Number(String(latest.code).slice(prefix.length)) : 0;
  if (!Number.isFinite(seq) || seq < 0) seq = 0;
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    codes.push(`${prefix}${String(seq).padStart(4, '0')}`);
  }
  return codes;
}

/** Source restricts which funding methods are valid (no PO creation from Assets). */
const FUNDING_BY_SOURCE: Record<string, string[]> = {
  direct: ['bank', 'cash', 'credit'],
  opening_balance: ['opening'],
  donation: ['donation', 'equity'],
  other: ['bank', 'cash', 'credit', 'equity'],
  /** Posted GRN already Dr Inventory / Cr AP — capitalise reclasses inventory → FA */
  grn: ['inventory_reclass']
};

function normalizeSourceFunding(body: Record<string, any>) {
  const source = String(body.source || 'direct').toLowerCase();
  if (!FUNDING_BY_SOURCE[source]) {
    throw httpError(
      400,
      `Invalid source. Use: ${Object.keys(FUNDING_BY_SOURCE).join(', ')}`
    );
  }
  const allowed = FUNDING_BY_SOURCE[source];
  let fundingMethod = String(
    body.funding_method || body.fundingMethod || body.pay_method || allowed[0]
  ).toLowerCase();
  // Map legacy alias
  if (fundingMethod === 'opening_equity') fundingMethod = 'opening';
  if (!allowed.includes(fundingMethod)) {
    throw httpError(
      400,
      `Funding "${fundingMethod}" is not allowed for source "${source}". Use: ${allowed.join(', ')}`
    );
  }
  return { source, fundingMethod, allowed };
}

async function resolveBankAndSupplier(
  businessId: string,
  fundingMethod: string,
  body: Record<string, any>
) {
  let supplierId = body.supplier_id || body.supplierId || null;
  let bankAccountId = body.bank_account_id || body.bankAccountId || null;

  if (fundingMethod === 'credit') {
    if (!supplierId) throw httpError(400, 'supplier_id is required when funding is credit');
    const s = await prisma.supplier.findFirst({
      where: { id: supplierId, businessId }
    });
    if (!s) throw httpError(400, 'Invalid supplier_id');
  } else {
    // Supplier is optional metadata only for non-credit; clear if accidentally sent with bank/cash
    if (fundingMethod === 'bank' || fundingMethod === 'cash') {
      // keep supplierId if provided for reference? Recommendation: only for credit. Clear others.
      supplierId = null;
    }
  }

  if (fundingMethod === 'bank') {
    if (!bankAccountId) throw httpError(400, 'bank_account_id is required when funding is bank');
    const bank = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, businessId, isActive: true }
    });
    if (!bank) throw httpError(400, 'Invalid bank_account_id');
  } else if (fundingMethod === 'cash') {
    // Optional: pick a cash/till bank account; otherwise default cash GL is used at capitalise
    if (bankAccountId) {
      const bank = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, businessId, isActive: true }
      });
      if (!bank) throw httpError(400, 'Invalid bank_account_id');
    }
  } else {
    bankAccountId = null;
  }

  return { supplierId, bankAccountId };
}

async function nextAcquisitionNumber(businessId: string) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `AQ-${ymd}-`;
  const latest = await prisma.assetAcquisition.findFirst({
    where: { businessId, acquisitionNumber: { startsWith: prefix } },
    orderBy: { acquisitionNumber: 'desc' },
    select: { acquisitionNumber: true }
  });
  const seq = latest ? Number(latest.acquisitionNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export async function listAcquisitions(
  user: AuthUser,
  filters: {
    branchId?: string | null;
    allowConsolidated?: boolean;
    status?: string;
    q?: string;
  } = {}
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filters.branchId,
    allowConsolidated: filters.allowConsolidated
  });
  const rows = await prisma.assetAcquisition.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.q
        ? {
            OR: [
              { assetName: { contains: filters.q } },
              { acquisitionNumber: { contains: filters.q } },
              { assetCode: { contains: filters.q } }
            ]
          }
        : {})
    },
    include: acqInclude,
    orderBy: { createdAt: 'desc' },
    take: 200
  });
  return serialize(
    rows.map((r) => ({
      ...r,
      capitalised_cost: totalCost(r)
    }))
  );
}

export async function getAcquisition(user: AuthUser, id: string) {
  const row = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId },
    include: acqInclude
  });
  if (!row) throw httpError(404, 'Acquisition not found');
  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function createAcquisition(user: AuthUser, body: Record<string, any>) {
  const assetName = requireString(body.asset_name || body.assetName, 'asset_name');
  const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1)));
  if (!Number.isFinite(quantity) || quantity < 1) throw httpError(400, 'quantity must be >= 1');
  if (quantity > 500) throw httpError(400, 'quantity cannot exceed 500 per acquisition');

  let unitCost = roundMoney(Number(body.unit_cost ?? body.unitCost ?? 0));
  let purchaseCost = roundMoney(Number(body.purchase_cost ?? body.purchaseCost ?? 0));
  if (unitCost > 0) {
    purchaseCost = roundMoney(unitCost * quantity);
  } else if (purchaseCost > 0) {
    unitCost = roundMoney(purchaseCost / quantity);
    purchaseCost = roundMoney(unitCost * quantity);
  }
  if (purchaseCost <= 0 && body.source !== 'opening_balance') {
    throw httpError(400, 'unit_cost or purchase_cost must be > 0');
  }

  const freightCost = roundMoney(Number(body.freight_cost ?? body.freightCost ?? 0));
  const installationCost = roundMoney(Number(body.installation_cost ?? body.installationCost ?? 0));
  const otherCapitalCost = roundMoney(Number(body.other_capital_cost ?? body.otherCapitalCost ?? 0));
  const openingAccumDep = roundMoney(Number(body.opening_accum_dep ?? body.openingAccumDep ?? 0));
  const salvageValue = roundMoney(Number(body.salvage_value ?? body.salvageValue ?? 0));
  let usefulLifeMonths = Number(body.useful_life_months ?? body.usefulLifeMonths ?? 36);
  let depreciationMethod =
    body.depreciation_method || body.depreciationMethod || 'straight_line';

  const categoryId = body.category_id || body.categoryId || null;
  if (categoryId) {
    const cat = await prisma.assetCategory.findFirst({
      where: { id: categoryId, businessId: user.businessId, isActive: true }
    });
    if (!cat) throw httpError(400, 'Invalid category_id');
    if (body.useful_life_months == null && body.usefulLifeMonths == null) {
      usefulLifeMonths = cat.defaultUsefulLifeMonths;
    }
    if (body.depreciation_method == null && body.depreciationMethod == null) {
      depreciationMethod = cat.defaultDepreciationMethod;
    }
  }
  if (depreciationMethod === 'none') {
    usefulLifeMonths = 0;
  } else if (!usefulLifeMonths || usefulLifeMonths <= 0) {
    throw httpError(400, 'useful_life_months must be > 0');
  }

  const locationId = body.location_id || body.locationId || null;
  if (locationId) {
    const loc = await prisma.assetLocation.findFirst({
      where: { id: locationId, businessId: user.businessId }
    });
    if (!loc) throw httpError(400, 'Invalid location_id');
  }

  const { source, fundingMethod } = normalizeSourceFunding(body);
  const { supplierId, bankAccountId } = await resolveBankAndSupplier(
    user.businessId,
    fundingMethod,
    body
  );

  const serials = parseSerialNumbers(
    body.serial_numbers ?? body.serialNumbers ?? body.serial_numbers_text ?? body.serialNumbersText
  );
  if (body.serial_number || body.serialNumber) {
    const one = String(body.serial_number || body.serialNumber).trim();
    if (one && !serials.length) serials.push(one);
  }
  if (serials.length && serials.length !== quantity) {
    throw httpError(
      400,
      `Provide exactly ${quantity} serial number(s); got ${serials.length}`
    );
  }
  if (quantity > 1 && !serials.length) {
    throw httpError(
      400,
      'Bulk acquisitions require one unique serial number per unit (paste one per line)'
    );
  }
  await assertSerialsAvailable(user.businessId, serials);

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const acquisitionDate = body.acquisition_date || body.acquisitionDate
    ? new Date(body.acquisition_date || body.acquisitionDate)
    : new Date();
  const availableForUseDate = body.available_for_use_date || body.availableForUseDate
    ? new Date(body.available_for_use_date || body.availableForUseDate)
    : null;

  const manufacturer = body.manufacturer || null;
  const model = body.model || body.assetName || assetName;

  const id = shortId('aaq');
  const acquisitionNumber = await nextAcquisitionNumber(user.businessId);

  const row = await prisma.assetAcquisition.create({
    data: {
      id,
      businessId: user.businessId,
      branchId,
      acquisitionNumber,
      status: 'draft',
      source,
      supplierId,
      purchaseOrderId: body.purchase_order_id || body.purchaseOrderId || null,
      grnId: body.grn_id || body.grnId || null,
      supplierBillId: body.supplier_bill_id || body.supplierBillId || null,
      categoryId,
      locationId,
      assetName,
      assetCode: body.asset_code || body.assetCode || null,
      description: body.description || null,
      manufacturer,
      model: body.model || model,
      serialNumber: serials[0] || null,
      serialNumbersJson: serialsToJson(serials),
      quantity,
      unitCost: toDec(unitCost),
      acquisitionDate,
      availableForUseDate,
      purchaseCost: toDec(purchaseCost),
      freightCost: toDec(freightCost),
      installationCost: toDec(installationCost),
      otherCapitalCost: toDec(otherCapitalCost),
      openingAccumDep: toDec(openingAccumDep),
      salvageValue: toDec(salvageValue),
      usefulLifeMonths,
      depreciationMethod,
      currencyCode: body.currency_code || body.currencyCode || 'NGN',
      exchangeRate: toDec(Number(body.exchange_rate ?? body.exchangeRate ?? 1)),
      fundingMethod,
      bankAccountId,
      notes: body.notes || null,
      createdById: user.id
    },
    include: acqInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetAcquisition',
    entityId: row.id,
    summary: `Created acquisition ${row.acquisitionNumber} — ${assetName} ×${quantity}`
  });

  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function updateAcquisition(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId },
    include: { costAdditions: true }
  });
  if (!existing) throw httpError(404, 'Acquisition not found');
  if (existing.status !== 'draft') {
    throw httpError(400, 'Only draft acquisitions can be edited');
  }

  const categoryId =
    body.category_id !== undefined || body.categoryId !== undefined
      ? body.category_id || body.categoryId || null
      : existing.categoryId;
  const locationId =
    body.location_id !== undefined || body.locationId !== undefined
      ? body.location_id || body.locationId || null
      : existing.locationId;

  if (categoryId) {
    const cat = await prisma.assetCategory.findFirst({
      where: { id: categoryId, businessId: user.businessId }
    });
    if (!cat) throw httpError(400, 'Invalid category_id');
  }
  if (locationId) {
    const loc = await prisma.assetLocation.findFirst({
      where: { id: locationId, businessId: user.businessId }
    });
    if (!loc) throw httpError(400, 'Invalid location_id');
  }

  let quantity = existing.quantity;
  if (body.quantity != null) {
    quantity = Math.max(1, Math.floor(Number(body.quantity)));
    if (quantity > 500) throw httpError(400, 'quantity cannot exceed 500 per acquisition');
  }

  let unitCost = Number(existing.unitCost || 0);
  let purchaseCost = Number(existing.purchaseCost || 0);
  if (body.unit_cost != null || body.unitCost != null) {
    unitCost = roundMoney(Number(body.unit_cost ?? body.unitCost));
    purchaseCost = roundMoney(unitCost * quantity);
  } else if (body.purchase_cost != null || body.purchaseCost != null) {
    purchaseCost = roundMoney(Number(body.purchase_cost ?? body.purchaseCost));
    unitCost = roundMoney(purchaseCost / quantity);
    purchaseCost = roundMoney(unitCost * quantity);
  } else if (body.quantity != null) {
    unitCost = roundMoney(unitCost || purchaseCost / Math.max(1, existing.quantity));
    purchaseCost = roundMoney(unitCost * quantity);
  }

  let serials: string[] | undefined;
  if (
    body.serial_numbers != null ||
    body.serialNumbers != null ||
    body.serial_numbers_text != null ||
    body.serialNumbersText != null ||
    body.serial_number != null ||
    body.serialNumber != null
  ) {
    serials = parseSerialNumbers(
      body.serial_numbers ?? body.serialNumbers ?? body.serial_numbers_text ?? body.serialNumbersText
    );
    const one = String(body.serial_number || body.serialNumber || '').trim();
    if (one && !serials.length) serials.push(one);
    if (serials.length && serials.length !== quantity) {
      throw httpError(400, `Provide exactly ${quantity} serial number(s); got ${serials.length}`);
    }
    if (quantity > 1 && !serials.length) {
      throw httpError(400, 'Bulk acquisitions require one unique serial number per unit');
    }
    await assertSerialsAvailable(user.businessId, serials);
  } else if (body.quantity != null && quantity > 1) {
    const existingSerials = parseSerialNumbers(existing.serialNumbersJson);
    if (existingSerials.length !== quantity) {
      throw httpError(400, `Provide exactly ${quantity} serial number(s); got ${existingSerials.length}`);
    }
  }

  const row = await prisma.assetAcquisition.update({
    where: { id },
    data: {
      assetName:
        body.asset_name !== undefined || body.assetName !== undefined
          ? requireString(body.asset_name || body.assetName, 'asset_name')
          : undefined,
      assetCode:
        body.asset_code !== undefined || body.assetCode !== undefined
          ? body.asset_code || body.assetCode || null
          : undefined,
      description: body.description !== undefined ? body.description || null : undefined,
      manufacturer:
        body.manufacturer !== undefined ? body.manufacturer || null : undefined,
      model: body.model !== undefined ? body.model || null : undefined,
      categoryId,
      locationId,
      supplierId:
        body.supplier_id !== undefined || body.supplierId !== undefined
          ? body.supplier_id || body.supplierId || null
          : undefined,
      quantity: body.quantity != null ? quantity : undefined,
      unitCost:
        body.unit_cost != null ||
        body.unitCost != null ||
        body.purchase_cost != null ||
        body.purchaseCost != null ||
        body.quantity != null
          ? toDec(unitCost)
          : undefined,
      purchaseCost:
        body.unit_cost != null ||
        body.unitCost != null ||
        body.purchase_cost != null ||
        body.purchaseCost != null ||
        body.quantity != null
          ? toDec(purchaseCost)
          : undefined,
      serialNumber: serials ? serials[0] || null : undefined,
      serialNumbersJson: serials ? serialsToJson(serials) : undefined,
      freightCost:
        body.freight_cost != null || body.freightCost != null
          ? toDec(roundMoney(Number(body.freight_cost ?? body.freightCost)))
          : undefined,
      installationCost:
        body.installation_cost != null || body.installationCost != null
          ? toDec(roundMoney(Number(body.installation_cost ?? body.installationCost)))
          : undefined,
      otherCapitalCost:
        body.other_capital_cost != null || body.otherCapitalCost != null
          ? toDec(roundMoney(Number(body.other_capital_cost ?? body.otherCapitalCost)))
          : undefined,
      openingAccumDep:
        body.opening_accum_dep != null || body.openingAccumDep != null
          ? toDec(roundMoney(Number(body.opening_accum_dep ?? body.openingAccumDep)))
          : undefined,
      salvageValue:
        body.salvage_value != null || body.salvageValue != null
          ? toDec(roundMoney(Number(body.salvage_value ?? body.salvageValue)))
          : undefined,
      usefulLifeMonths:
        body.useful_life_months != null || body.usefulLifeMonths != null
          ? Number(body.useful_life_months ?? body.usefulLifeMonths)
          : undefined,
      depreciationMethod:
        body.depreciation_method || body.depreciationMethod || undefined,
      fundingMethod:
        body.funding_method || body.fundingMethod || body.pay_method || undefined,
      bankAccountId:
        body.bank_account_id !== undefined || body.bankAccountId !== undefined
          ? body.bank_account_id || body.bankAccountId || null
          : undefined,
      availableForUseDate:
        body.available_for_use_date !== undefined || body.availableForUseDate !== undefined
          ? body.available_for_use_date || body.availableForUseDate
            ? new Date(body.available_for_use_date || body.availableForUseDate)
            : null
          : undefined,
      notes: body.notes !== undefined ? body.notes || null : undefined
    },
    include: acqInclude
  });

  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function submitAcquisition(user: AuthUser, id: string) {
  const existing = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId },
    include: { costAdditions: true }
  });
  if (!existing) throw httpError(404, 'Acquisition not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft acquisitions can be submitted');
  if (totalCost(existing) <= 0) throw httpError(400, 'Capitalised cost must be > 0');
  const qty = Math.max(1, Number(existing.quantity || 1));
  if (qty > 1) {
    const serials = parseSerialNumbers(existing.serialNumbersJson);
    if (serials.length !== qty) {
      throw httpError(400, `Submit requires ${qty} serial numbers; got ${serials.length}`);
    }
  }

  const row = await prisma.assetAcquisition.update({
    where: { id },
    data: { status: 'pending_approval', submittedAt: new Date() },
    include: acqInclude
  });

  await writeAudit({
    user,
    action: 'submit',
    module: 'assets',
    entityType: 'AssetAcquisition',
    entityId: id,
    summary: `Submitted acquisition ${row.acquisitionNumber}`
  });
  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function approveAcquisition(user: AuthUser, id: string) {
  const existing = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId },
    include: { costAdditions: true }
  });
  if (!existing) throw httpError(404, 'Acquisition not found');
  if (existing.status !== 'pending_approval') {
    throw httpError(400, 'Only submitted acquisitions can be approved');
  }
  if (totalCost(existing) <= 0) throw httpError(400, 'Capitalised cost must be > 0');

  const row = await prisma.assetAcquisition.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById: user.id,
      submittedAt: existing.submittedAt || new Date()
    },
    include: acqInclude
  });

  await writeAudit({
    user,
    action: 'approve',
    module: 'assets',
    entityType: 'AssetAcquisition',
    entityId: id,
    summary: `Approved acquisition ${row.acquisitionNumber}`
  });
  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function cancelAcquisition(user: AuthUser, id: string) {
  const existing = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Acquisition not found');
  if (existing.status === 'capitalised') {
    throw httpError(400, 'Capitalised acquisitions cannot be cancelled');
  }
  const row = await prisma.assetAcquisition.update({
    where: { id },
    data: { status: 'cancelled' },
    include: acqInclude
  });
  await writeAudit({
    user,
    action: 'cancel',
    module: 'assets',
    entityType: 'AssetAcquisition',
    entityId: id,
    summary: `Cancelled acquisition ${row.acquisitionNumber}`
  });
  return serialize({ ...row, capitalised_cost: totalCost(row) });
}

export async function addCostAddition(user: AuthUser, acquisitionId: string, body: Record<string, any>) {
  const acq = await prisma.assetAcquisition.findFirst({
    where: { id: acquisitionId, businessId: user.businessId }
  });
  if (!acq) throw httpError(404, 'Acquisition not found');
  if (acq.status === 'capitalised' || acq.status === 'cancelled') {
    throw httpError(400, 'Cannot add costs to a closed acquisition');
  }

  const amount = roundMoney(Number(body.amount ?? 0));
  if (amount <= 0) throw httpError(400, 'amount must be > 0');
  const sourceType = requireString(body.source_type || body.sourceType || 'manual', 'source_type');
  const sourceId = requireString(body.source_id || body.sourceId || acquisitionId, 'source_id');
  const sourceLineId = String(body.source_line_id || body.sourceLineId || shortId('acl'));

  try {
    const row = await prisma.assetCostAddition.create({
      data: {
        id: shortId('aca'),
        businessId: user.businessId,
        acquisitionId,
        sourceType,
        sourceId,
        sourceLineId,
        description: body.description || null,
        amount: toDec(amount),
        createdById: user.id
      }
    });
    return serialize(row);
  } catch (err: any) {
    if (String(err?.code) === 'P2002') {
      throw httpError(400, 'This source line has already been capitalised (duplicate cost addition)');
    }
    throw err;
  }
}

/**
 * Explicitly classify a posted GRN line as a fixed-asset acquisition draft.
 * Never auto-classifies inventory receipts.
 */
export async function createFromGrnItem(user: AuthUser, body: Record<string, any>) {
  const grnItemId = requireString(body.grn_item_id || body.grnItemId, 'grn_item_id');
  const categoryId = requireString(body.category_id || body.categoryId, 'category_id');
  const item = await prisma.goodsReceiptItem.findFirst({
    where: { id: grnItemId },
    include: {
      grn: true,
      product: { select: { id: true, name: true, sku: true } }
    }
  });
  if (!item || item.grn.businessId !== user.businessId) {
    throw httpError(404, 'GRN item not found');
  }
  if (item.grn.status !== 'posted') {
    throw httpError(400, 'Only posted GRN lines can be classified as assets');
  }

  const cat = await prisma.assetCategory.findFirst({
    where: { id: categoryId, businessId: user.businessId, isActive: true }
  });
  if (!cat) throw httpError(400, 'category_id is invalid or inactive');

  const existing = await prisma.assetCostAddition.findFirst({
    where: {
      businessId: user.businessId,
      sourceType: 'grn_item',
      sourceId: item.grnId,
      sourceLineId: item.id
    }
  });
  if (existing) throw httpError(400, 'This GRN line is already linked to an asset acquisition');

  const amount = roundMoney(Number(item.lineTotal));
  const requestedQty = body.quantity != null || body.qty != null ? Number(body.quantity ?? body.qty) : 1;
  const quantity = Math.max(1, Math.round(requestedQty) || 1);
  const unitCost =
    body.unit_cost != null || body.unitCost != null
      ? Number(body.unit_cost ?? body.unitCost)
      : roundMoney(amount / quantity);
  const acq = await createAcquisition(user, {
    asset_name: body.asset_name || body.assetName || item.product.name,
    asset_code: body.asset_code || body.assetCode || null,
    category_id: cat.id,
    location_id: body.location_id || body.locationId || null,
    quantity,
    unit_cost: unitCost,
    purchase_cost: amount,
    source: 'grn',
    supplier_id: item.grn.supplierId,
    grn_id: item.grnId,
    purchase_order_id: item.grn.purchaseOrderId,
    branch_id: item.grn.branchId,
    acquisition_date: item.grn.receivedAt,
    funding_method: 'inventory_reclass',
    useful_life_months:
      body.useful_life_months || body.usefulLifeMonths || cat.defaultUsefulLifeMonths,
    depreciation_method:
      body.depreciation_method || body.depreciationMethod || cat.defaultDepreciationMethod,
    serial_numbers: body.serial_numbers || body.serialNumbers,
    notes: body.notes || `From GRN ${item.grn.grnNumber}`
  });

  // Cost lives on purchase_cost; addition amount 0 is a uniqueness marker only.
  await prisma.assetCostAddition.create({
    data: {
      id: shortId('aca'),
      businessId: user.businessId,
      acquisitionId: acq.id,
      sourceType: 'grn_item',
      sourceId: item.grnId,
      sourceLineId: item.id,
      description: `GRN line classification (${item.product.name})`,
      amount: toDec(0),
      createdById: user.id
    }
  });

  return getAcquisition(user, acq.id);
}

export async function capitaliseAcquisition(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const existing = await prisma.assetAcquisition.findFirst({
    where: { id, businessId: user.businessId },
    include: { costAdditions: true, category: true }
  });
  if (!existing) throw httpError(404, 'Acquisition not found');
  if (existing.status !== 'approved') {
    throw httpError(400, 'Only approved acquisitions can be capitalised');
  }

  const quantity = Math.max(1, Number(existing.quantity || 1));
  const capitalisedCost = totalCost(existing);
  if (capitalisedCost <= 0) throw httpError(400, 'Capitalised cost must be > 0');

  let serials = parseSerialNumbers(
    body.serial_numbers ?? body.serialNumbers ?? existing.serialNumbersJson
  );
  if (!serials.length && existing.serialNumber) serials = [existing.serialNumber];
  if (quantity > 1 && serials.length !== quantity) {
    throw httpError(
      400,
      `Capitalisation requires ${quantity} serial numbers; got ${serials.length}`
    );
  }
  if (serials.length && serials.length !== quantity && quantity === 1) {
    throw httpError(400, `Provide exactly ${quantity} serial number(s); got ${serials.length}`);
  }
  await assertSerialsAvailable(user.businessId, serials);

  const availableForUseDate =
    body.available_for_use_date || body.availableForUseDate
      ? new Date(body.available_for_use_date || body.availableForUseDate)
      : existing.availableForUseDate || existing.acquisitionDate;

  const branchId = existing.branchId;
  const categoryLabel = existing.category?.code?.toLowerCase() || 'equipment';
  let costAccountId: string | null = existing.category?.costAccountId || null;
  const batchId = shortId('acap');

  const unitPurchase =
    Number(existing.unitCost || 0) > 0
      ? roundMoney(Number(existing.unitCost))
      : roundMoney(Number(existing.purchaseCost || 0) / quantity);
  const additionTotal = existing.costAdditions.reduce((s, a) => s + Number(a.amount || 0), 0);
  const freightParts = allocateAcross(Number(existing.freightCost || 0), quantity);
  const installParts = allocateAcross(Number(existing.installationCost || 0), quantity);
  const otherParts = allocateAcross(
    Number(existing.otherCapitalCost || 0) + additionTotal,
    quantity
  );
  const openingParts = allocateAcross(Number(existing.openingAccumDep || 0), quantity);
  const salvageParts = allocateAcross(Number(existing.salvageValue || 0), quantity);

  const result = await prisma.$transaction(async (tx) => {
    const map = await getDefaultAccountMap(user.businessId);
    if (!costAccountId) costAccountId = map.fixed_assets || null;
    if (!costAccountId) throw httpError(400, 'fixed_assets GL account is not configured');

    const { fundingMethod: method } = normalizeSourceFunding({
      source: existing.source,
      funding_method: body.funding_method || body.fundingMethod || existing.fundingMethod
    });

    let creditAccountId: string | null = null;
    let creditDesc = `Fund ${method}`;
    const bankAccountId =
      body.bank_account_id || body.bankAccountId || existing.bankAccountId || null;
    const supplierId = body.supplier_id || body.supplierId || existing.supplierId || null;

    if (method === 'bank') {
      if (!bankAccountId) throw httpError(400, 'bank_account_id is required when funding is bank');
      const bank = await tx.bankAccount.findFirst({
        where: { id: bankAccountId, businessId: user.businessId }
      });
      if (!bank) throw httpError(400, 'Invalid bank_account_id');
      creditAccountId = bank.glAccountId;
      creditDesc = `Pay from ${bank.name}`;
    } else if (method === 'cash') {
      if (bankAccountId) {
        const bank = await tx.bankAccount.findFirst({
          where: { id: bankAccountId, businessId: user.businessId }
        });
        if (!bank) throw httpError(400, 'Invalid bank_account_id');
        creditAccountId = bank.glAccountId;
        creditDesc = `Pay cash from ${bank.name}`;
      } else {
        creditAccountId = map.cash || null;
        creditDesc = 'Pay cash';
      }
    } else if (method === 'equity' || method === 'donation') {
      creditAccountId = map.equity || map.asset_disposal_gain || null;
      creditDesc = method === 'donation' ? 'Donation / capital contribution' : 'Equity funding';
    } else if (method === 'credit') {
      if (!supplierId) throw httpError(400, 'supplier_id is required when funding is credit');
      creditAccountId = map.asset_acquisition_payable || map.accounts_payable || null;
      creditDesc = 'Asset acquisition payable';
    } else if (method === 'opening') {
      creditAccountId = map.equity || null;
      creditDesc = 'Opening balance equity';
    } else if (method === 'inventory_reclass') {
      creditAccountId = map.inventory || null;
      creditDesc = 'Reclass from inventory (GRN)';
    }
    if (!creditAccountId) {
      throw httpError(400, `Credit GL account is not configured for funding method "${method}"`);
    }

    const openingAccumLot = roundMoney(Number(existing.openingAccumDep || 0));
    const lines: {
      account_id: string;
      debit?: number;
      credit?: number;
      description: string;
    }[] = [
      {
        account_id: costAccountId,
        debit: capitalisedCost,
        description: `Capitalise ${existing.assetName} ×${quantity}`
      }
    ];

    if (openingAccumLot > 0) {
      const accumId =
        existing.category?.accumDepAccountId || map.accumulated_depreciation || null;
      if (!accumId) throw httpError(400, 'accumulated_depreciation GL account is not configured');
      lines.push({
        account_id: accumId,
        credit: openingAccumLot,
        description: `Opening accum. dep. — ${existing.assetName}`
      });
      lines.push({
        account_id: creditAccountId,
        credit: roundMoney(capitalisedCost - openingAccumLot),
        description: creditDesc
      });
    } else {
      lines.push({
        account_id: creditAccountId,
        credit: capitalisedCost,
        description: creditDesc
      });
    }

    const journal = await createJournal(
      user,
      {
        entry_date: availableForUseDate,
        memo: `Asset capitalisation — ${existing.acquisitionNumber} — ${existing.assetName} ×${quantity}`,
        source_type: 'asset_capitalisation',
        source_id: batchId,
        idempotency_key: `asset_capitalisation:${id}`,
        branch_id: branchId || undefined,
        supplier_id: method === 'credit' ? supplierId : existing.supplierId,
        post: true,
        lines
      },
      tx
    );
    const journalEntryId = (journal as any).id as string;

    const codes = await nextAssetCodes(
      user.businessId,
      existing.category?.code,
      quantity,
      tx as any
    );
    // Optional single override only when quantity is 1
    if (quantity === 1 && existing.assetCode) {
      const code = String(existing.assetCode).trim();
      const clash = await tx.fixedAsset.findFirst({
        where: { businessId: user.businessId, code }
      });
      if (clash) throw httpError(400, 'Asset code already exists');
      codes[0] = code;
    }

    await assertSerialsAvailable(user.businessId, serials, tx as any);

    const assets: any[] = [];
    const capitalisations: any[] = [];

    for (let i = 0; i < quantity; i += 1) {
      const assetId = shortId('fa');
      const unitCap = roundMoney(
        unitPurchase + freightParts[i] + installParts[i] + otherParts[i]
      );
      const serial = serials[i] || null;

      const asset = await tx.fixedAsset.create({
        data: {
          id: assetId,
          businessId: user.businessId,
          branchId,
          code: codes[i],
          name: existing.assetName,
          description: existing.description,
          category: categoryLabel,
          categoryId: existing.categoryId,
          assetType: 'tangible',
          manufacturer: existing.manufacturer,
          model: existing.model || existing.assetName,
          serialNumber: serial,
          acquisitionSource: existing.source,
          supplierId: existing.supplierId,
          purchaseOrderId: existing.purchaseOrderId,
          grnId: existing.grnId,
          supplierBillId: existing.supplierBillId,
          purchaseDate: existing.acquisitionDate,
          capitalisationDate: new Date(),
          availableForUseDate,
          depreciationStartDate: availableForUseDate,
          purchaseCost: toDec(unitPurchase),
          freightCost: toDec(freightParts[i]),
          installationCost: toDec(installParts[i]),
          otherCapitalCost: toDec(otherParts[i]),
          salvageValue: toDec(salvageParts[i]),
          usefulLifeMonths: existing.usefulLifeMonths,
          depreciationMethod: existing.depreciationMethod,
          accumulatedDepreciation: toDec(openingParts[i]),
          status: 'active',
          operationalStatus: 'in_use',
          financialStatus: 'capitalised',
          condition: 'good',
          locationId: existing.locationId,
          notes: existing.notes,
          acquisitionJournalEntryId: journalEntryId,
          createdById: user.id
        }
      });
      assets.push(asset);

      await tx.assetAssignmentHistory.create({
        data: {
          id: shortId('aah'),
          businessId: user.businessId,
          assetId: asset.id,
          toBranchId: branchId,
          toLocationId: existing.locationId,
          reason: `Capitalised from ${existing.acquisitionNumber}`,
          changedById: user.id
        }
      });

      await tx.assetStatusHistory.create({
        data: {
          id: shortId('ash'),
          businessId: user.businessId,
          assetId: asset.id,
          field: 'financial_status',
          fromValue: 'not_capitalised',
          toValue: 'capitalised',
          reason: quantity > 1 ? `Bulk capitalisation (${i + 1}/${quantity})` : 'Capitalisation',
          changedById: user.id
        }
      });

      const capitalisation = await tx.assetCapitalisation.create({
        data: {
          id: shortId('acap'),
          businessId: user.businessId,
          acquisitionId: id,
          assetId: asset.id,
          capitalisedAmount: toDec(unitCap),
          journalEntryId,
          capitalisedById: user.id,
          notes: body.notes || null
        }
      });
      capitalisations.push(capitalisation);
    }

    if (assets[0]) {
      await tx.assetCostAddition.updateMany({
        where: { acquisitionId: id },
        data: { assetId: assets[0].id }
      });
    }

    // GRN path: inventory qty came in on receive; remove it now that GL reclassed to FA
    if (method === 'inventory_reclass') {
      const grnLink = existing.costAdditions.find((a) => a.sourceType === 'grn_item' && a.sourceLineId);
      if (grnLink?.sourceLineId) {
        const grnItem = await tx.goodsReceiptItem.findFirst({
          where: { id: grnLink.sourceLineId },
          include: { grn: true }
        });
        if (grnItem?.grn?.warehouseId) {
          const issueQty = roundMoney(Number(grnItem.quantity));
          if (issueQty > 0) {
            let lotId: string | undefined;
            if (grnItem.stockMovementId) {
              const mv = await tx.stockMovement.findFirst({
                where: { id: grnItem.stockMovementId, businessId: user.businessId }
              });
              if (mv?.lotId) lotId = mv.lotId;
            }
            const issueSerials =
              serials.length > 0
                ? serials
                : parseSerialNumbers(grnItem.serialNumbersJson);
            await createStockMovement(
              user,
              {
                product_id: grnItem.productId,
                variant_id: grnItem.variantId || undefined,
                warehouse_id: grnItem.grn.warehouseId,
                lot_id: lotId,
                movement_type: 'asset_capitalise',
                quantity_in: 0,
                quantity_out: issueQty,
                unit_cost: Number(grnItem.unitCost),
                batch_number: grnItem.batchNumber || undefined,
                expiry_date: grnItem.expiryDate || undefined,
                serial_numbers: issueSerials.length ? issueSerials : undefined,
                allow_expired: true,
                reason: `Capitalise ${existing.acquisitionNumber} (inventory → FA)`,
                reference_type: 'asset_capitalisation',
                reference_id: id,
                idempotency_key: `asset_cap_stock:${id}`
              },
              tx
            );
          }
        }
      }
    }

    const acq = await tx.assetAcquisition.update({
      where: { id },
      data: {
        status: 'capitalised',
        capitalisedAssetId: assets[0]?.id || null,
        availableForUseDate,
        serialNumbersJson: serialsToJson(serials),
        serialNumber: serials[0] || existing.serialNumber
      },
      include: acqInclude
    });

    return { acq, assets, capitalisations, journalEntryId };
  });

  await writeAudit({
    user,
    action: 'capitalise',
    module: 'assets',
    entityType: 'AssetAcquisition',
    entityId: id,
    summary: `Capitalised ${existing.acquisitionNumber} → ${result.assets.length} asset(s)`
  });

  return serialize({
    ...result.acq,
    capitalised_cost: capitalisedCost,
    quantity,
    assets: result.assets,
    asset: result.assets[0],
    capitalisations: result.capitalisations,
    capitalisation: result.capitalisations[0],
    journal_entry_id: result.journalEntryId
  });
}
