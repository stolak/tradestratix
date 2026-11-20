import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

export async function listLocations(user: AuthUser, opts?: { branchId?: string; activeOnly?: boolean }) {
  // Unassigned (null branch) locations are shared master data — always include them.
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: !opts?.branchId
  });
  const rows = await prisma.assetLocation.findMany({
    where: {
      businessId: user.businessId,
      OR: [{ branchId: scope.branchId as any }, { branchId: null }],
      ...(opts?.activeOnly ? { isActive: true } : {})
    },
    include: { branch: true },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createLocation(user: AuthUser, body: Record<string, any>) {
  const code = requireString(body.code, 'code').toUpperCase();
  const name = requireString(body.name, 'name');
  let branchId: string | null = body.branch_id || body.branchId || null;
  if (branchId) {
    branchId = await branchAccess.resolveWriteBranchId(user, branchId);
  }

  const exists = await prisma.assetLocation.findFirst({
    where: { businessId: user.businessId, code }
  });
  if (exists) throw httpError(400, 'Location code already exists');

  const row = await prisma.assetLocation.create({
    data: {
      id: shortId('aloc'),
      businessId: user.businessId,
      branchId,
      code,
      name,
      description: body.description || null,
      createdById: user.id
    },
    include: { branch: true }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'assets',
    entityType: 'AssetLocation',
    entityId: row.id,
    summary: `Created asset location ${code}`
  });
  return serialize(row);
}

export async function updateLocation(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.assetLocation.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Asset location not found');

  let code = existing.code;
  if (body.code != null) {
    code = String(body.code).trim().toUpperCase();
    const clash = await prisma.assetLocation.findFirst({
      where: { businessId: user.businessId, code, NOT: { id } }
    });
    if (clash) throw httpError(400, 'Location code already exists');
  }

  let branchId = existing.branchId;
  if (body.branch_id !== undefined || body.branchId !== undefined) {
    const raw = body.branch_id ?? body.branchId;
    branchId = raw ? await branchAccess.resolveWriteBranchId(user, raw) : null;
  }

  const row = await prisma.assetLocation.update({
    where: { id },
    data: {
      code,
      name: body.name != null ? String(body.name).trim() : undefined,
      description: body.description !== undefined ? body.description || null : undefined,
      branchId,
      isActive:
        body.is_active != null || body.isActive != null
          ? Boolean(body.is_active ?? body.isActive)
          : undefined
    },
    include: { branch: true }
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'assets',
    entityType: 'AssetLocation',
    entityId: id,
    summary: `Updated asset location ${row.code}`
  });
  return serialize(row);
}
