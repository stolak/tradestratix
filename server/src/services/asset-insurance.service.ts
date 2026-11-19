import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  roundMoney,
  serialize,
  shortId,
  toDec
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

const insuranceInclude = {
  asset: { select: { id: true, code: true, name: true } },
  claims: { orderBy: { claimDate: 'desc' as const }, take: 20 }
};

async function requireAsset(businessId: string, assetId: string) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id: assetId, businessId } });
  if (!asset) throw httpError(404, 'Asset not found');
  return asset;
}

async function syncAssetInsuranceSummary(assetId: string) {
  const active = await prisma.assetInsurance.findFirst({
    where: { assetId, status: 'active' },
    orderBy: { endDate: 'desc' }
  });
  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: {
      insuranceCompany: active?.insurerName || null,
      insurancePolicy: active?.policyNumber || null,
      insuranceExpiryDate: active?.endDate || null
    }
  });
}

async function syncAssetWarrantySummary(assetId: string) {
  const active = await prisma.assetWarranty.findFirst({
    where: { assetId, status: 'active' },
    orderBy: { endDate: 'desc' }
  });
  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: {
      warrantyProvider: active?.providerName || null,
      warrantyExpiryDate: active?.endDate || null
    }
  });
}

export async function listInsurances(user: AuthUser, opts?: { asset_id?: string; status?: string }) {
  const rows = await prisma.assetInsurance.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: insuranceInclude,
    orderBy: { endDate: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function createInsurance(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  await requireAsset(user.businessId, assetId);
  const insurerName = requireString(body.insurer_name || body.insurerName, 'insurer_name');
  const policyNumber = requireString(body.policy_number || body.policyNumber, 'policy_number');
  const startDate = new Date(body.start_date || body.startDate);
  const endDate = new Date(body.end_date || body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw httpError(400, 'start_date and end_date are required');
  }
  if (endDate < startDate) throw httpError(400, 'end_date must be on/after start_date');

  const row = await prisma.assetInsurance.create({
    data: {
      id: shortId('ain'),
      businessId: user.businessId,
      assetId,
      insurerName,
      policyNumber,
      coverageType: body.coverage_type || body.coverageType || null,
      sumInsured:
        body.sum_insured != null || body.sumInsured != null
          ? toDec(roundMoney(Number(body.sum_insured ?? body.sumInsured)))
          : null,
      premiumAmount:
        body.premium_amount != null || body.premiumAmount != null
          ? toDec(roundMoney(Number(body.premium_amount ?? body.premiumAmount)))
          : null,
      startDate,
      endDate,
      status: body.status || 'active',
      notes: body.notes || null,
      createdById: user.id
    },
    include: insuranceInclude
  });
  await syncAssetInsuranceSummary(assetId);
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetInsurance',
    entityId: row.id,
    summary: `Added insurance ${policyNumber} for asset`
  });
  return serialize(row);
}

export async function updateInsurance(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.assetInsurance.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Insurance policy not found');

  const updated = await prisma.assetInsurance.update({
    where: { id },
    data: {
      ...(body.insurer_name != null || body.insurerName != null
        ? { insurerName: String(body.insurer_name || body.insurerName) }
        : {}),
      ...(body.policy_number != null || body.policyNumber != null
        ? { policyNumber: String(body.policy_number || body.policyNumber) }
        : {}),
      ...(body.coverage_type !== undefined || body.coverageType !== undefined
        ? { coverageType: body.coverage_type ?? body.coverageType ?? null }
        : {}),
      ...(body.status != null ? { status: String(body.status) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.end_date || body.endDate
        ? { endDate: new Date(body.end_date || body.endDate) }
        : {}),
      ...(body.start_date || body.startDate
        ? { startDate: new Date(body.start_date || body.startDate) }
        : {})
    },
    include: insuranceInclude
  });
  await syncAssetInsuranceSummary(existing.assetId);
  return serialize(updated);
}

async function nextClaimNumber(businessId: string) {
  return nextDocNumber(prisma.assetInsuranceClaim, businessId, 'claimNumber', 'ACL', 5);
}

export async function createClaim(user: AuthUser, body: Record<string, any>) {
  const insuranceId = requireString(body.insurance_id || body.insuranceId, 'insurance_id');
  const policy = await prisma.assetInsurance.findFirst({
    where: { id: insuranceId, businessId: user.businessId }
  });
  if (!policy) throw httpError(404, 'Insurance policy not found');
  const claimAmount = roundMoney(Number(body.claim_amount ?? body.claimAmount ?? 0));
  if (claimAmount < 0) throw httpError(400, 'claim_amount must be >= 0');
  const claimNumber = await nextClaimNumber(user.businessId);
  const row = await prisma.assetInsuranceClaim.create({
    data: {
      id: shortId('acl'),
      businessId: user.businessId,
      insuranceId,
      assetId: policy.assetId,
      claimNumber,
      status: 'open',
      claimDate: body.claim_date || body.claimDate ? new Date(body.claim_date || body.claimDate) : new Date(),
      description: body.description || null,
      claimAmount: toDec(claimAmount),
      createdById: user.id
    }
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetInsuranceClaim',
    entityId: row.id,
    summary: `Opened insurance claim ${claimNumber}`
  });
  return serialize(row);
}

export async function settleClaim(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const existing = await prisma.assetInsuranceClaim.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Claim not found');
  if (!['open', 'submitted'].includes(existing.status)) {
    throw httpError(400, 'Claim cannot be settled in current status');
  }
  const settledAmount = roundMoney(
    Number(body.settled_amount ?? body.settledAmount ?? existing.claimAmount)
  );
  const updated = await prisma.assetInsuranceClaim.update({
    where: { id },
    data: {
      status: 'settled',
      settledAmount: toDec(settledAmount),
      settledAt: new Date()
    }
  });
  await writeAudit({
    user,
    action: 'settle',
    module: 'assets',
    entityType: 'AssetInsuranceClaim',
    entityId: id,
    summary: `Settled claim ${existing.claimNumber} for ${settledAmount}`
  });
  return serialize(updated);
}

export async function denyClaim(user: AuthUser, id: string) {
  const existing = await prisma.assetInsuranceClaim.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Claim not found');
  if (!['open', 'submitted'].includes(existing.status)) {
    throw httpError(400, 'Claim cannot be denied in current status');
  }
  const updated = await prisma.assetInsuranceClaim.update({
    where: { id },
    data: { status: 'denied' }
  });
  return serialize(updated);
}

export async function listWarranties(user: AuthUser, opts?: { asset_id?: string; status?: string }) {
  const rows = await prisma.assetWarranty.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.asset_id ? { assetId: opts.asset_id } : {}),
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: { asset: { select: { id: true, code: true, name: true } } },
    orderBy: { endDate: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function createWarranty(user: AuthUser, body: Record<string, any>) {
  const assetId = requireString(body.asset_id || body.assetId, 'asset_id');
  await requireAsset(user.businessId, assetId);
  const providerName = requireString(body.provider_name || body.providerName, 'provider_name');
  const startDate = new Date(body.start_date || body.startDate);
  const endDate = new Date(body.end_date || body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw httpError(400, 'start_date and end_date are required');
  }
  if (endDate < startDate) throw httpError(400, 'end_date must be on/after start_date');

  const row = await prisma.assetWarranty.create({
    data: {
      id: shortId('awa'),
      businessId: user.businessId,
      assetId,
      providerName,
      warrantyNumber: body.warranty_number || body.warrantyNumber || null,
      coverageNotes: body.coverage_notes || body.coverageNotes || null,
      startDate,
      endDate,
      status: body.status || 'active',
      createdById: user.id
    },
    include: { asset: { select: { id: true, code: true, name: true } } }
  });
  await syncAssetWarrantySummary(assetId);
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetWarranty',
    entityId: row.id,
    summary: `Added warranty from ${providerName}`
  });
  return serialize(row);
}

export async function updateWarranty(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.assetWarranty.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Warranty not found');
  const updated = await prisma.assetWarranty.update({
    where: { id },
    data: {
      ...(body.provider_name != null || body.providerName != null
        ? { providerName: String(body.provider_name || body.providerName) }
        : {}),
      ...(body.status != null ? { status: String(body.status) } : {}),
      ...(body.end_date || body.endDate
        ? { endDate: new Date(body.end_date || body.endDate) }
        : {}),
      ...(body.coverage_notes !== undefined || body.coverageNotes !== undefined
        ? { coverageNotes: body.coverage_notes ?? body.coverageNotes ?? null }
        : {})
    },
    include: { asset: { select: { id: true, code: true, name: true } } }
  });
  await syncAssetWarrantySummary(existing.assetId);
  return serialize(updated);
}
