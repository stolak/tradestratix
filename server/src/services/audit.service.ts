import { prisma } from '../utils/prisma.js';
import { shortId, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';

export async function writeAudit(params: {
  businessId?: string | null;
  user?: AuthUser | null;
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: unknown;
  ipAddress?: string;
}) {
  const row = await prisma.auditLog.create({
    data: {
      id: shortId('aud'),
      businessId: params.businessId ?? params.user?.businessId ?? null,
      userId: params.user?.id ?? null,
      action: params.action,
      module: params.module,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      summary: params.summary ?? null,
      metadata: params.metadata != null ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress ?? null
    }
  });
  return serialize(row);
}

export async function listAuditLogs(businessId: string, opts?: { limit?: number; module?: string }) {
  const logs = await prisma.auditLog.findMany({
    where: {
      businessId,
      ...(opts?.module ? { module: opts.module } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 100
  });
  return serialize(logs);
}
