import { prisma } from '../utils/prisma.js';
import { httpError, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import { authorisedWarehouseIds } from './fulfilment.service.js';
import { deleteProofObject, uploadProofObject } from '../utils/s3.js';

const KINDS = new Set(['collection', 'delivery', 'discrepancy', 'other']);

async function assertCanAccessTask(user: AuthUser, fulfilmentId: string) {
  const task = await prisma.salesFulfilment.findFirst({
    where: { id: fulfilmentId, businessId: user.businessId },
    select: { id: true, warehouseId: true, branchId: true, status: true, proofReference: true }
  });
  if (!task) throw httpError(404, 'Fulfilment not found');
  const allowed = await authorisedWarehouseIds(user);
  if (!allowed.has(task.warehouseId) && !branchAccess.canAccessAllBranches(user)) {
    throw httpError(403, 'You do not have access to that warehouse');
  }
  return task;
}

export async function listProofs(user: AuthUser, fulfilmentId: string) {
  await assertCanAccessTask(user, fulfilmentId);
  const rows = await prisma.fulfilmentProof.findMany({
    where: { businessId: user.businessId, fulfilmentId },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

/**
 * Upload one proof file (image/PDF) for a fulfilment task to S3 and store the metadata.
 * Also sets SalesFulfilment.proofReference / DeliveryOrder.podReference to the first URL when empty.
 */
export async function uploadProof(
  user: AuthUser,
  fulfilmentId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  body: Record<string, any> = {}
) {
  if (!file?.buffer?.length) throw httpError(400, 'file is required');
  const task = await assertCanAccessTask(user, fulfilmentId);
  const kind = String(body.kind || (task.status === 'dispatched' || task.status === 'delivered' ? 'delivery' : 'collection')).toLowerCase();
  if (!KINDS.has(kind)) throw httpError(400, 'kind must be collection, delivery, discrepancy or other');

  const uploaded = await uploadProofObject({
    businessId: user.businessId,
    fulfilmentId,
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    kind
  });

  const id = shortId('fpf');
  const row = await prisma.$transaction(async (tx) => {
    const proof = await tx.fulfilmentProof.create({
      data: {
        id,
        businessId: user.businessId,
        fulfilmentId,
        kind,
        fileName: file.originalname || uploaded.key.split('/').pop() || 'proof',
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey: uploaded.key,
        url: uploaded.url,
        uploadedById: user.id
      }
    });

    const ful = await tx.salesFulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    if (!ful.proofReference) {
      await tx.salesFulfilment.update({
        where: { id: fulfilmentId },
        data: { proofReference: uploaded.url }
      });
    }
    if (kind === 'delivery') {
      const del = await tx.deliveryOrder.findFirst({ where: { fulfilmentId } });
      if (del && !del.podReference) {
        await tx.deliveryOrder.update({
          where: { id: del.id },
          data: { podReference: uploaded.url }
        });
      }
    }
    return proof;
  });

  await writeAudit({
    user,
    action: 'upload',
    module: 'fulfilment',
    entityType: 'FulfilmentProof',
    entityId: row.id,
    summary: `Uploaded ${kind} proof for fulfilment ${fulfilmentId}`
  });

  return serialize(row);
}

export async function deleteProof(user: AuthUser, fulfilmentId: string, proofId: string) {
  await assertCanAccessTask(user, fulfilmentId);
  const proof = await prisma.fulfilmentProof.findFirst({
    where: { id: proofId, fulfilmentId, businessId: user.businessId }
  });
  if (!proof) throw httpError(404, 'Proof not found');

  await prisma.fulfilmentProof.delete({ where: { id: proof.id } });
  try {
    await deleteProofObject(proof.storageKey);
  } catch {
    // Object may already be gone; DB row is removed.
  }

  const remaining = await prisma.fulfilmentProof.findFirst({
    where: { fulfilmentId },
    orderBy: { createdAt: 'asc' }
  });
  await prisma.salesFulfilment.update({
    where: { id: fulfilmentId },
    data: { proofReference: remaining?.url || null }
  });
  const del = await prisma.deliveryOrder.findFirst({ where: { fulfilmentId } });
  if (del) {
    await prisma.deliveryOrder.update({
      where: { id: del.id },
      data: { podReference: remaining?.kind === 'delivery' ? remaining.url : del.podReference }
    });
  }

  await writeAudit({
    user,
    action: 'delete',
    module: 'fulfilment',
    entityType: 'FulfilmentProof',
    entityId: proofId,
    summary: `Deleted proof ${proofId} from fulfilment ${fulfilmentId}`
  });

  return { deleted: true, id: proofId };
}
