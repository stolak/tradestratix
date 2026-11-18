import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const assetInclude = {
  branch: true,
  assetCategory: true,
  location: true,
  warehouse: true,
  custodian: { select: { id: true, code: true, fullName: true } },
  supplier: { select: { id: true, code: true, name: true } },
  depreciationEntries: { orderBy: { periodLabel: 'desc' as const }, take: 24 },
  assignmentHistory: { orderBy: { changedAt: 'desc' as const }, take: 50 },
  statusHistory: { orderBy: { changedAt: 'desc' as const }, take: 50 },
  documents: { orderBy: { createdAt: 'desc' as const }, take: 50 }
};

export type AssetListFilters = BranchListOpts & {
  status?: string;
  operationalStatus?: string;
  financialStatus?: string;
  categoryId?: string;
  locationId?: string;
  custodianEmployeeId?: string;
  q?: string;
};

export function monthlyDepreciationAmount(cost: number, salvage: number, usefulLifeMonths: number) {
  if (!usefulLifeMonths || usefulLifeMonths <= 0) return 0;
  return Math.max(0, roundMoney((cost - salvage) / usefulLifeMonths));
}

export function netBookValue(asset: {
  purchaseCost: unknown;
  freightCost?: unknown;
  installationCost?: unknown;
  otherCapitalCost?: unknown;
  accumulatedDepreciation: unknown;
  accumulatedImpairment?: unknown;
}) {
  const cost =
    Number(asset.purchaseCost || 0) +
    Number(asset.freightCost || 0) +
    Number(asset.installationCost || 0) +
    Number(asset.otherCapitalCost || 0);
  return roundMoney(
    cost - Number(asset.accumulatedDepreciation || 0) - Number(asset.accumulatedImpairment || 0)
  );
}

function defaultPeriodLabel(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function withNbv<T extends Record<string, any>>(row: T) {
  return { ...row, net_book_value: netBookValue(row) };
}

export async function listAssets(user: AuthUser, statusOrFilters?: string | AssetListFilters, opts?: BranchListOpts) {
  const filters: AssetListFilters =
    typeof statusOrFilters === 'string' || statusOrFilters == null
      ? { status: statusOrFilters || undefined, ...(opts || {}) }
      : statusOrFilters;

  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filters.branchId,
    allowConsolidated: filters.allowConsolidated
  });
  const q = filters.q?.trim();
  const rows = await prisma.fixedAsset.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.operationalStatus ? { operationalStatus: filters.operationalStatus } : {}),
      ...(filters.financialStatus ? { financialStatus: filters.financialStatus } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.locationId ? { locationId: filters.locationId } : {}),
      ...(filters.custodianEmployeeId ? { custodianEmployeeId: filters.custodianEmployeeId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { serialNumber: { contains: q } },
              { barcode: { contains: q } }
            ]
          }
        : {})
    },
    include: {
      branch: true,
      assetCategory: true,
      location: true,
      custodian: { select: { id: true, code: true, fullName: true } }
    },
    orderBy: { name: 'asc' }
  });
  return serialize(rows.map((r) => withNbv(r)));
}

export async function getAsset(businessId: string, id: string) {
  const row = await prisma.fixedAsset.findFirst({
    where: { id, businessId },
    include: assetInclude
  });
  if (!row) throw httpError(404, 'Asset not found');
  return serialize(withNbv(row));
}

export async function createAsset(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const purchaseCost = roundMoney(Number(body.purchase_cost ?? body.purchaseCost ?? 0));
  if (purchaseCost <= 0) throw httpError(400, 'purchase_cost must be > 0');

  const freightCost = roundMoney(Number(body.freight_cost ?? body.freightCost ?? 0));
  const installationCost = roundMoney(Number(body.installation_cost ?? body.installationCost ?? 0));
  const otherCapitalCost = roundMoney(Number(body.other_capital_cost ?? body.otherCapitalCost ?? 0));
  const capitalisedCost = roundMoney(purchaseCost + freightCost + installationCost + otherCapitalCost);

  const salvageValue = roundMoney(Number(body.salvage_value ?? body.salvageValue ?? 0));
  let usefulLifeMonths = Number(body.useful_life_months ?? body.usefulLifeMonths ?? 36);
  let depreciationMethod =
    body.depreciation_method || body.depreciationMethod || 'straight_line';
  let categoryId: string | null = body.category_id || body.categoryId || null;
  let categoryLabel = body.category || 'equipment';

  if (categoryId) {
    const cat = await prisma.assetCategory.findFirst({
      where: { id: categoryId, businessId: user.businessId, isActive: true }
    });
    if (!cat) throw httpError(400, 'Invalid category_id');
    categoryLabel = cat.code.toLowerCase();
    if (body.useful_life_months == null && body.usefulLifeMonths == null) {
      usefulLifeMonths = cat.defaultUsefulLifeMonths;
    }
    if (body.depreciation_method == null && body.depreciationMethod == null) {
      depreciationMethod = cat.defaultDepreciationMethod;
    }
  }
  if (String(depreciationMethod).toLowerCase() === 'none') {
    usefulLifeMonths = 0;
  } else if (!usefulLifeMonths || usefulLifeMonths <= 0) {
    throw httpError(400, 'useful_life_months must be > 0');
  }

  const purchaseDate = body.purchase_date || body.purchaseDate
    ? new Date(body.purchase_date || body.purchaseDate)
    : new Date();
  const availableForUseDate = body.available_for_use_date || body.availableForUseDate
    ? new Date(body.available_for_use_date || body.availableForUseDate)
    : purchaseDate;

  const payMethod = body.pay_method || body.payMethod || null;
  const shouldPost = Boolean(payMethod) || body.post === true;

  const assetId = shortId('fa');
  let acquisitionJournalEntryId: string | null = null;
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const locationId = body.location_id || body.locationId || null;
  if (locationId) {
    const loc = await prisma.assetLocation.findFirst({
      where: { id: locationId, businessId: user.businessId }
    });
    if (!loc) throw httpError(400, 'Invalid location_id');
  }

  const custodianEmployeeId = body.custodian_employee_id || body.custodianEmployeeId || null;
  if (custodianEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: custodianEmployeeId, businessId: user.businessId }
    });
    if (!emp) throw httpError(400, 'Invalid custodian_employee_id');
  }

  const code = body.code ? String(body.code).trim() : null;
  if (code) {
    const clash = await prisma.fixedAsset.findFirst({
      where: { businessId: user.businessId, code }
    });
    if (clash) throw httpError(400, 'Asset code already exists');
  }

  const created = await prisma.$transaction(async (tx) => {
    if (shouldPost) {
      const map = await getDefaultAccountMap(user.businessId);
      let costAccountId = map.fixed_assets;
      if (categoryId) {
        const cat = await tx.assetCategory.findFirst({ where: { id: categoryId } });
        if (cat?.costAccountId) costAccountId = cat.costAccountId;
      }
      if (body.cost_account_id || body.costAccountId) {
        costAccountId = body.cost_account_id || body.costAccountId;
      }
      if (!costAccountId) throw httpError(400, 'fixed_assets GL account is not configured');

      const method = String(payMethod || 'bank').toLowerCase();
      let creditAccountId =
        method === 'cash' ? map.cash : method === 'equity' ? map.equity : map.bank;
      if (method === 'bank' && (body.bank_account_id || body.bankAccountId)) {
        const bank = await tx.bankAccount.findFirst({
          where: { id: body.bank_account_id || body.bankAccountId, businessId: user.businessId }
        });
        if (!bank) throw httpError(400, 'Invalid bank_account_id');
        creditAccountId = bank.glAccountId;
      }
      if (!creditAccountId) throw httpError(400, 'Credit GL account is not configured for acquisition');

      const journal = await createJournal(
        user,
        {
          entry_date: purchaseDate,
          memo: `Asset acquisition — ${name}`,
          source_type: 'asset_acquisition',
          source_id: assetId,
          idempotency_key: `asset_acquisition:${assetId}`,
          branch_id: branchId,
          post: true,
          lines: [
            {
              account_id: costAccountId,
              debit: capitalisedCost,
              description: `Acquire ${name}`
            },
            {
              account_id: creditAccountId,
              credit: capitalisedCost,
              description: `Pay ${method} for ${name}`
            }
          ]
        },
        tx
      );
      acquisitionJournalEntryId = (journal as any).id;
    }

    const row = await tx.fixedAsset.create({
      data: {
        id: assetId,
        businessId: user.businessId,
        branchId,
        code,
        name,
        description: body.description || null,
        category: categoryLabel,
        categoryId,
        assetType: body.asset_type || body.assetType || 'tangible',
        manufacturer: body.manufacturer || null,
        model: body.model || null,
        serialNumber: body.serial_number || body.serialNumber || null,
        barcode: body.barcode || null,
        acquisitionSource: body.acquisition_source || body.acquisitionSource || 'direct',
        supplierId: body.supplier_id || body.supplierId || null,
        purchaseDate,
        capitalisationDate: shouldPost ? purchaseDate : null,
        availableForUseDate,
        depreciationStartDate: availableForUseDate,
        purchaseCost: toDec(purchaseCost),
        freightCost: toDec(freightCost),
        installationCost: toDec(installationCost),
        otherCapitalCost: toDec(otherCapitalCost),
        salvageValue: toDec(salvageValue),
        usefulLifeMonths,
        depreciationMethod,
        accumulatedDepreciation: toDec(0),
        status: 'active',
        operationalStatus: body.operational_status || body.operationalStatus || 'in_use',
        financialStatus: shouldPost ? 'capitalised' : 'not_capitalised',
        condition: body.condition || 'good',
        department: body.department || null,
        locationId,
        warehouseId: body.warehouse_id || body.warehouseId || null,
        costCentre: body.cost_centre || body.costCentre || null,
        custodianEmployeeId,
        notes: body.notes || null,
        acquisitionJournalEntryId,
        createdById: user.id
      },
      include: {
        branch: true,
        assetCategory: true,
        location: true,
        custodian: { select: { id: true, code: true, fullName: true } }
      }
    });

    await tx.assetAssignmentHistory.create({
      data: {
        id: shortId('aah'),
        businessId: user.businessId,
        assetId: row.id,
        toBranchId: branchId,
        toLocationId: locationId,
        toDepartment: body.department || null,
        toCustodianId: custodianEmployeeId,
        toWarehouseId: body.warehouse_id || body.warehouseId || null,
        reason: 'Initial assignment',
        changedById: user.id
      }
    });

    return row;
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'FixedAsset',
    entityId: created.id,
    summary: `Created asset ${name}`
  });
  return serialize(withNbv(created));
}

/** Update non-balance fields only — never allow PATCH of accum. dep. / NBV. */
export async function updateAsset(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.fixedAsset.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Asset not found');
  if (existing.financialStatus === 'disposed' || existing.status === 'disposed') {
    throw httpError(400, 'Disposed assets cannot be edited');
  }

  if (
    body.accumulated_depreciation != null ||
    body.accumulatedDepreciation != null ||
    body.purchase_cost != null ||
    body.purchaseCost != null
  ) {
    throw httpError(
      400,
      'Financial balances cannot be edited directly — use acquisition, depreciation or disposal workflows'
    );
  }

  const branchId =
    body.branch_id !== undefined || body.branchId !== undefined
      ? body.branch_id || body.branchId
        ? await branchAccess.resolveWriteBranchId(user, body.branch_id || body.branchId)
        : null
      : existing.branchId;

  const locationId =
    body.location_id !== undefined || body.locationId !== undefined
      ? body.location_id || body.locationId || null
      : existing.locationId;
  const custodianEmployeeId =
    body.custodian_employee_id !== undefined || body.custodianEmployeeId !== undefined
      ? body.custodian_employee_id || body.custodianEmployeeId || null
      : existing.custodianEmployeeId;
  const department =
    body.department !== undefined ? body.department || null : existing.department;
  const warehouseId =
    body.warehouse_id !== undefined || body.warehouseId !== undefined
      ? body.warehouse_id || body.warehouseId || null
      : existing.warehouseId;

  if (locationId) {
    const loc = await prisma.assetLocation.findFirst({
      where: { id: locationId, businessId: user.businessId }
    });
    if (!loc) throw httpError(400, 'Invalid location_id');
  }
  if (custodianEmployeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: custodianEmployeeId, businessId: user.businessId }
    });
    if (!emp) throw httpError(400, 'Invalid custodian_employee_id');
  }

  let categoryId = existing.categoryId;
  let categoryLabel = existing.category;
  if (body.category_id !== undefined || body.categoryId !== undefined) {
    categoryId = body.category_id || body.categoryId || null;
    if (categoryId) {
      const cat = await prisma.assetCategory.findFirst({
        where: { id: categoryId, businessId: user.businessId }
      });
      if (!cat) throw httpError(400, 'Invalid category_id');
      categoryLabel = cat.code.toLowerCase();
    }
  }

  const assignmentChanged =
    branchId !== existing.branchId ||
    locationId !== existing.locationId ||
    custodianEmployeeId !== existing.custodianEmployeeId ||
    department !== existing.department ||
    warehouseId !== existing.warehouseId;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.fixedAsset.update({
      where: { id },
      data: {
        name: body.name != null ? String(body.name).trim() : undefined,
        description: body.description !== undefined ? body.description || null : undefined,
        code: body.code !== undefined ? (body.code ? String(body.code).trim() : null) : undefined,
        category: categoryLabel,
        categoryId,
        assetType: body.asset_type || body.assetType || undefined,
        manufacturer: body.manufacturer !== undefined ? body.manufacturer || null : undefined,
        model: body.model !== undefined ? body.model || null : undefined,
        serialNumber:
          body.serial_number !== undefined || body.serialNumber !== undefined
            ? body.serial_number || body.serialNumber || null
            : undefined,
        barcode: body.barcode !== undefined ? body.barcode || null : undefined,
        branchId,
        locationId,
        warehouseId,
        department,
        custodianEmployeeId,
        costCentre:
          body.cost_centre !== undefined || body.costCentre !== undefined
            ? body.cost_centre || body.costCentre || null
            : undefined,
        condition: body.condition || undefined,
        operationalStatus: body.operational_status || body.operationalStatus || undefined,
        notes: body.notes !== undefined ? body.notes || null : undefined,
        warrantyProvider:
          body.warranty_provider !== undefined || body.warrantyProvider !== undefined
            ? body.warranty_provider || body.warrantyProvider || null
            : undefined,
        warrantyExpiryDate:
          body.warranty_expiry_date || body.warrantyExpiryDate
            ? new Date(body.warranty_expiry_date || body.warrantyExpiryDate)
            : body.warranty_expiry_date === null || body.warrantyExpiryDate === null
              ? null
              : undefined,
        insuranceCompany:
          body.insurance_company !== undefined || body.insuranceCompany !== undefined
            ? body.insurance_company || body.insuranceCompany || null
            : undefined,
        insurancePolicy:
          body.insurance_policy !== undefined || body.insurancePolicy !== undefined
            ? body.insurance_policy || body.insurancePolicy || null
            : undefined,
        insuranceExpiryDate:
          body.insurance_expiry_date || body.insuranceExpiryDate
            ? new Date(body.insurance_expiry_date || body.insuranceExpiryDate)
            : body.insurance_expiry_date === null || body.insuranceExpiryDate === null
              ? null
              : undefined,
        updatedById: user.id,
        version: { increment: 1 }
      },
      include: {
        branch: true,
        assetCategory: true,
        location: true,
        custodian: { select: { id: true, code: true, fullName: true } }
      }
    });

    if (assignmentChanged) {
      await tx.assetAssignmentHistory.create({
        data: {
          id: shortId('aah'),
          businessId: user.businessId,
          assetId: id,
          fromBranchId: existing.branchId,
          toBranchId: branchId,
          fromLocationId: existing.locationId,
          toLocationId: locationId,
          fromDepartment: existing.department,
          toDepartment: department,
          fromCustodianId: existing.custodianEmployeeId,
          toCustodianId: custodianEmployeeId,
          fromWarehouseId: existing.warehouseId,
          toWarehouseId: warehouseId,
          reason: body.assignment_reason || body.assignmentReason || 'Assignment update',
          changedById: user.id
        }
      });
    }

    if (
      body.operational_status &&
      body.operational_status !== existing.operationalStatus
    ) {
      await tx.assetStatusHistory.create({
        data: {
          id: shortId('ash'),
          businessId: user.businessId,
          assetId: id,
          field: 'operational_status',
          fromValue: existing.operationalStatus,
          toValue: String(body.operational_status),
          changedById: user.id
        }
      });
    }

    return row;
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'FixedAsset',
    entityId: id,
    summary: `Updated asset ${updated.name}`
  });
  return serialize(withNbv(updated));
}

/** @deprecated Prefer asset-depreciation.service createPreviewRun → approve → post */
export async function runDepreciation(
  user: AuthUser,
  opts: { period_label?: string; asset_ids?: string[]; units?: Record<string, number> } = {}
) {
  const dep = await import('./asset-depreciation.service.js');
  return dep.runDepreciationImmediate(user, opts);
}

export async function listDepreciationEntries(
  businessId: string,
  opts: { asset_id?: string; period_label?: string; run_id?: string } = {}
) {
  const dep = await import('./asset-depreciation.service.js');
  return dep.listDepreciationEntries(businessId, opts);
}

export async function uploadAssetDocument(
  user: AuthUser,
  assetId: string,
  file: { buffer: Buffer; mimetype: string; originalname?: string; size?: number },
  body: Record<string, any> = {}
) {
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, businessId: user.businessId }
  });
  if (!asset) throw httpError(404, 'Asset not found');

  const { uploadBusinessObject, s3Configured } = await import('../utils/s3.js');
  if (!s3Configured()) throw httpError(500, 'Document storage (S3) is not configured');

  const uploaded = await uploadBusinessObject({
    businessId: user.businessId,
    folder: 'assets',
    entityId: assetId,
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    kind: body.doc_type || body.docType || 'other'
  });

  const row = await prisma.assetDocument.create({
    data: {
      id: shortId('adoc'),
      businessId: user.businessId,
      assetId,
      docType: String(body.doc_type || body.docType || 'other'),
      fileName: file.originalname || uploaded.key.split('/').pop() || 'document',
      mimeType: file.mimetype || null,
      sizeBytes: file.size ?? file.buffer.length,
      storageKey: uploaded.key,
      url: uploaded.url,
      uploadedById: user.id
    }
  });

  if ((body.doc_type || body.docType) === 'photo' || body.set_photo === true) {
    await prisma.fixedAsset.update({
      where: { id: assetId },
      data: { photoUrl: uploaded.url }
    });
  }

  await writeAudit({
    user,
    action: 'upload',
    module: 'assets',
    entityType: 'AssetDocument',
    entityId: row.id,
    summary: `Uploaded document for asset ${asset.name}`
  });
  return serialize(row);
}
