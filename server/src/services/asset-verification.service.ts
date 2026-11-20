import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  serialize,
  shortId
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

const campaignInclude = {
  branch: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, code: true, name: true } },
  results: {
    include: {
      asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
    },
    orderBy: { createdAt: 'asc' as const },
    take: 500
  }
};

async function nextCampaignNumber(businessId: string) {
  return nextDocNumber(prisma.assetVerificationCampaign, businessId, 'campaignNumber', 'AVC', 5);
}

async function refreshCampaignCounts(campaignId: string, tx: any = prisma) {
  const grouped = await tx.assetVerificationResult.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true }
  });
  const count = (status: string) =>
    grouped.find((g: any) => g.status === status)?._count?._all || 0;
  const expected = count('expected');
  const matched = count('matched');
  const mismatch = count('mismatch');
  const missing = count('missing');
  const unexpected = count('unexpected');
  const resolved = count('resolved');
  const scanned = matched + mismatch + unexpected + resolved;
  return tx.assetVerificationCampaign.update({
    where: { id: campaignId },
    data: {
      expectedCount: expected + matched + mismatch + missing + resolved,
      scannedCount: scanned,
      matchedCount: matched,
      mismatchCount: mismatch,
      missingCount: missing,
      unexpectedCount: unexpected
    },
    include: campaignInclude
  });
}

function ensureQrPayload(asset: { id: string; code: string | null; qrPayload: string | null }) {
  if (asset.qrPayload) return asset.qrPayload;
  return `asset:${asset.code || asset.id}`;
}

export async function listCampaigns(user: AuthUser, opts?: { status?: string }) {
  const scope = await branchAccess.branchScopeWhereLoose(user, { allowConsolidated: true });
  const rows = await prisma.assetVerificationCampaign.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
      category: { select: { id: true, code: true, name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return serialize(rows);
}

export async function getCampaign(user: AuthUser, id: string) {
  const row = await prisma.assetVerificationCampaign.findFirst({
    where: { id, businessId: user.businessId },
    include: campaignInclude
  });
  if (!row) throw httpError(404, 'Verification campaign not found');
  return serialize(row);
}

export async function createCampaign(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const branchId = body.branch_id || body.branchId || null;
  const locationId = body.location_id || body.locationId || null;
  const categoryId = body.category_id || body.categoryId || null;

  if (branchId) {
    const b = await prisma.branch.findFirst({ where: { id: branchId, businessId: user.businessId } });
    if (!b) throw httpError(400, 'Invalid branch_id');
  }
  if (locationId) {
    const loc = await prisma.assetLocation.findFirst({
      where: { id: locationId, businessId: user.businessId }
    });
    if (!loc) throw httpError(400, 'Invalid location_id');
  }
  if (categoryId) {
    const cat = await prisma.assetCategory.findFirst({
      where: { id: categoryId, businessId: user.businessId }
    });
    if (!cat) throw httpError(400, 'Invalid category_id');
  }

  const campaignNumber = await nextCampaignNumber(user.businessId);
  const row = await prisma.assetVerificationCampaign.create({
    data: {
      id: shortId('avc'),
      businessId: user.businessId,
      branchId,
      locationId,
      categoryId,
      campaignNumber,
      name,
      description: body.description || null,
      status: 'draft',
      createdById: user.id
    },
    include: campaignInclude
  });
  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetVerificationCampaign',
    entityId: row.id,
    summary: `Created verification campaign ${campaignNumber}`
  });
  return serialize(row);
}

export async function openCampaign(user: AuthUser, id: string) {
  const existing = await prisma.assetVerificationCampaign.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Verification campaign not found');
  if (existing.status !== 'draft') throw httpError(400, 'Only draft campaigns can be opened');

  const assets = await prisma.fixedAsset.findMany({
    where: {
      businessId: user.businessId,
      financialStatus: { not: 'disposed' },
      operationalStatus: { notIn: ['disposed', 'archived'] },
      ...(existing.branchId ? { branchId: existing.branchId } : {}),
      ...(existing.locationId ? { locationId: existing.locationId } : {}),
      ...(existing.categoryId ? { categoryId: existing.categoryId } : {})
    },
    select: {
      id: true,
      code: true,
      branchId: true,
      locationId: true,
      custodianEmployeeId: true,
      condition: true,
      qrPayload: true,
      barcode: true
    }
  });

  const updated = await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      const qr = ensureQrPayload(asset);
      if (!asset.qrPayload) {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { qrPayload: qr }
        });
      }
      await tx.assetVerificationResult.create({
        data: {
          id: shortId('avr'),
          businessId: user.businessId,
          campaignId: id,
          assetId: asset.id,
          status: 'expected',
          expectedBranchId: asset.branchId,
          expectedLocationId: asset.locationId,
          expectedCustodianId: asset.custodianEmployeeId,
          expectedCondition: asset.condition
        }
      });
    }
    await tx.assetVerificationCampaign.update({
      where: { id },
      data: {
        status: 'open',
        openedAt: new Date(),
        expectedCount: assets.length
      }
    });
    return refreshCampaignCounts(id, tx);
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'AssetVerificationCampaign',
    entityId: id,
    summary: `Opened verification ${existing.campaignNumber} with ${assets.length} expected assets`
  });
  return serialize(updated);
}

async function findAssetByScan(businessId: string, scanned: string) {
  const code = scanned.trim();
  if (!code) return null;
  const key = code.startsWith('asset:') ? code.slice('asset:'.length) : code;
  return prisma.fixedAsset.findFirst({
    where: {
      businessId,
      OR: [
        { code: key },
        { barcode: key },
        { serialNumber: key },
        { qrPayload: code },
        { qrPayload: key },
        { id: key }
      ]
    }
  });
}

/**
 * Scan does not mutate the fixed-asset register — mismatches stay on the result until resolve.
 */
export async function scanCampaign(user: AuthUser, id: string, body: Record<string, any>) {
  const campaign = await prisma.assetVerificationCampaign.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!campaign) throw httpError(404, 'Verification campaign not found');
  if (campaign.status !== 'open') throw httpError(400, 'Campaign must be open to scan');

  const scannedCode = requireString(body.scanned_code || body.scannedCode || body.code, 'scanned_code');
  const foundLocationId = body.found_location_id || body.foundLocationId || null;
  const foundBranchId = body.found_branch_id || body.foundBranchId || null;
  const foundCustodianId = body.found_custodian_id || body.foundCustodianId || null;
  const foundCondition = body.found_condition || body.foundCondition || null;
  const notes = body.notes || null;

  const asset = await findAssetByScan(user.businessId, scannedCode);

  const result = await prisma.$transaction(async (tx) => {
    if (!asset) {
      const unexpected = await tx.assetVerificationResult.create({
        data: {
          id: shortId('avr'),
          businessId: user.businessId,
          campaignId: id,
          assetId: null,
          status: 'unexpected',
          scannedCode,
          foundBranchId,
          foundLocationId,
          foundCustodianId,
          foundCondition,
          notes,
          scannedAt: new Date(),
          scannedById: user.id
        },
        include: {
          asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
        }
      });
      await refreshCampaignCounts(id, tx);
      return unexpected;
    }

    let row = await tx.assetVerificationResult.findFirst({
      where: { campaignId: id, assetId: asset.id }
    });

    const obsBranch = foundBranchId || asset.branchId;
    const obsLocation = foundLocationId || asset.locationId;
    const obsCustodian = foundCustodianId || asset.custodianEmployeeId;
    const obsCondition = foundCondition || asset.condition;

    const locationMismatch =
      row &&
      ((row.expectedLocationId || null) !== (obsLocation || null) ||
        (row.expectedBranchId || null) !== (obsBranch || null) ||
        (row.expectedCustodianId || null) !== (obsCustodian || null) ||
        (foundCondition && row.expectedCondition && row.expectedCondition !== foundCondition));

    if (!row) {
      row = await tx.assetVerificationResult.create({
        data: {
          id: shortId('avr'),
          businessId: user.businessId,
          campaignId: id,
          assetId: asset.id,
          status: 'unexpected',
          scannedCode,
          expectedBranchId: asset.branchId,
          expectedLocationId: asset.locationId,
          expectedCustodianId: asset.custodianEmployeeId,
          expectedCondition: asset.condition,
          foundBranchId: obsBranch,
          foundLocationId: obsLocation,
          foundCustodianId: obsCustodian,
          foundCondition: obsCondition,
          notes,
          scannedAt: new Date(),
          scannedById: user.id
        },
        include: {
          asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
        }
      });
    } else {
      if (['matched', 'resolved'].includes(row.status)) {
        throw httpError(400, 'Asset already verified in this campaign');
      }
      row = await tx.assetVerificationResult.update({
        where: { id: row.id },
        data: {
          status: locationMismatch ? 'mismatch' : 'matched',
          scannedCode,
          foundBranchId: obsBranch,
          foundLocationId: obsLocation,
          foundCustodianId: obsCustodian,
          foundCondition: obsCondition,
          notes,
          scannedAt: new Date(),
          scannedById: user.id
        },
        include: {
          asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
        }
      });
    }

    await refreshCampaignCounts(id, tx);
    return row;
  });

  return serialize(result);
}

export async function closeCampaign(user: AuthUser, id: string) {
  const existing = await prisma.assetVerificationCampaign.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Verification campaign not found');
  if (existing.status !== 'open') throw httpError(400, 'Only open campaigns can be closed');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.assetVerificationResult.updateMany({
      where: { campaignId: id, status: 'expected' },
      data: { status: 'missing' }
    });
    await tx.assetVerificationCampaign.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date() }
    });
    return refreshCampaignCounts(id, tx);
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'AssetVerificationCampaign',
    entityId: id,
    summary: `Closed verification ${existing.campaignNumber}`
  });
  return serialize(updated);
}

export async function cancelCampaign(user: AuthUser, id: string) {
  const existing = await prisma.assetVerificationCampaign.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Verification campaign not found');
  if (existing.status === 'closed') throw httpError(400, 'Closed campaigns cannot be cancelled');
  const updated = await prisma.assetVerificationCampaign.update({
    where: { id },
    data: { status: 'cancelled' },
    include: campaignInclude
  });
  return serialize(updated);
}

/**
 * Resolve a mismatch/missing/unexpected result.
 * Only `correct_register` mutates FixedAsset (+ assignment history).
 */
export async function resolveResult(user: AuthUser, resultId: string, body: Record<string, any>) {
  const action = requireString(
    body.resolution_action || body.resolutionAction || body.action,
    'resolution_action'
  );
  if (!['accept_found', 'correct_register', 'ignore', 'mark_missing'].includes(action)) {
    throw httpError(400, 'Invalid resolution_action');
  }

  const existing = await prisma.assetVerificationResult.findFirst({
    where: { id: resultId, businessId: user.businessId },
    include: { campaign: true, asset: true }
  });
  if (!existing) throw httpError(404, 'Verification result not found');
  if (!['mismatch', 'missing', 'unexpected'].includes(existing.status)) {
    throw httpError(400, 'Only mismatch/missing/unexpected results can be resolved');
  }
  if (!['open', 'closed'].includes(existing.campaign.status)) {
    throw httpError(400, 'Campaign is not resolvable in this status');
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (action === 'correct_register' && existing.assetId) {
      const asset = existing.asset;
      if (!asset) throw httpError(400, 'Result has no asset to correct');
      const toBranch = existing.foundBranchId ?? asset.branchId;
      const toLocation = existing.foundLocationId ?? asset.locationId;
      const toCustodian = existing.foundCustodianId ?? asset.custodianEmployeeId;
      const toCondition = existing.foundCondition ?? asset.condition;

      const changed =
        (toBranch || null) !== (asset.branchId || null) ||
        (toLocation || null) !== (asset.locationId || null) ||
        (toCustodian || null) !== (asset.custodianEmployeeId || null) ||
        (toCondition || null) !== (asset.condition || null);

      if (changed) {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            branchId: toBranch,
            locationId: toLocation,
            custodianEmployeeId: toCustodian,
            condition: toCondition || asset.condition,
            version: { increment: 1 }
          }
        });
        await tx.assetAssignmentHistory.create({
          data: {
            id: shortId('aah'),
            businessId: user.businessId,
            assetId: asset.id,
            fromBranchId: asset.branchId,
            toBranchId: toBranch,
            fromLocationId: asset.locationId,
            toLocationId: toLocation,
            fromCustodianId: asset.custodianEmployeeId,
            toCustodianId: toCustodian,
            reason: `Verification resolve ${existing.campaign.campaignNumber}`,
            changedById: user.id
          }
        });
      }
    }

    const row = await tx.assetVerificationResult.update({
      where: { id: resultId },
      data: {
        status: action === 'mark_missing' ? 'missing' : 'resolved',
        resolutionAction: action,
        resolvedAt: new Date(),
        resolvedById: user.id,
        notes: body.notes || existing.notes
      },
      include: {
        asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
      }
    });
    await refreshCampaignCounts(existing.campaignId, tx);
    return row;
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'AssetVerificationResult',
    entityId: resultId,
    summary: `Resolved verification result via ${action}`
  });
  return serialize(updated);
}

export async function listResults(
  user: AuthUser,
  opts?: { campaign_id?: string; status?: string }
) {
  if (!opts?.campaign_id) throw httpError(400, 'campaign_id is required');
  const campaign = await prisma.assetVerificationCampaign.findFirst({
    where: { id: opts.campaign_id, businessId: user.businessId }
  });
  if (!campaign) throw httpError(404, 'Verification campaign not found');
  const rows = await prisma.assetVerificationResult.findMany({
    where: {
      businessId: user.businessId,
      campaignId: opts.campaign_id,
      ...(opts?.status ? { status: opts.status } : {})
    },
    include: {
      asset: { select: { id: true, code: true, name: true, barcode: true, serialNumber: true } }
    },
    orderBy: { createdAt: 'asc' },
    take: 500
  });
  return serialize(rows);
}
