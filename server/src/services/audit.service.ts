import { prisma } from '../utils/prisma.js';
import { shortId, serialize, toSnakeCaseKey } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';

export type AuditChangeMap = Record<string, { from: unknown; to: unknown }>;

const DEFAULT_OMIT = new Set([
  'id',
  'businessId',
  'business_id',
  'createdAt',
  'created_at',
  'updatedAt',
  'updated_at',
  'createdById',
  'created_by_id',
  'updatedById',
  'updated_by_id',
  'passwordHash',
  'password_hash'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNestedRecord(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Date) return false;
  if (typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return false;
  }
  return typeof value === 'object';
}

function normalizeAuditValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.parse(JSON.stringify(serialize(value)));
    } catch {
      return String(value);
    }
  }
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build a field-level before→after map. Skips ids/timestamps/password hashes
 * and nested relation objects by default.
 */
export function auditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts?: { fields?: string[]; omit?: string[]; includeNested?: boolean }
): AuditChangeMap {
  const beforeRow = before || {};
  const afterRow = after || {};
  const omit = new Set([...(opts?.omit || []), ...DEFAULT_OMIT]);
  const keys = opts?.fields?.length
    ? opts.fields
    : [...new Set([...Object.keys(beforeRow), ...Object.keys(afterRow)])];

  const changes: AuditChangeMap = {};
  for (const key of keys) {
    if (omit.has(key) || omit.has(toSnakeCaseKey(key))) continue;
    const rawFrom = beforeRow[key];
    const rawTo = afterRow[key];
    if (!opts?.includeNested && (isNestedRecord(rawFrom) || isNestedRecord(rawTo))) {
      continue;
    }
    const from = normalizeAuditValue(rawFrom);
    const to = normalizeAuditValue(rawTo);
    if (valuesEqual(from, to)) continue;
    changes[toSnakeCaseKey(key)] = { from, to };
  }
  return changes;
}

function parseJsonField(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function presentAuditRow(row: Record<string, unknown>) {
  const out = serialize(row) as Record<string, unknown>;
  out.changes = parseJsonField(row.changes as string | null | undefined);
  out.metadata = parseJsonField(row.metadata as string | null | undefined);
  return out;
}

export async function writeAudit(params: {
  businessId?: string | null;
  user?: AuthUser | null;
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  /** Explicit field diffs. Prefer this or before+after for updates. */
  changes?: AuditChangeMap;
  /** Snapshot before update — used with `after` to compute `changes`. */
  before?: Record<string, unknown> | null;
  /** Snapshot after update — used with `before` to compute `changes`. */
  after?: Record<string, unknown> | null;
  metadata?: unknown;
  ipAddress?: string;
}) {
  let changes: AuditChangeMap = { ...(params.changes || {}) };
  if (params.before || params.after) {
    changes = {
      ...auditDiff(
        params.before as Record<string, unknown> | undefined,
        params.after as Record<string, unknown> | undefined
      ),
      ...changes
    };
  }

  const row = await prisma.auditLog.create({
    data: {
      id: shortId('aud'),
      businessId: params.businessId ?? params.user?.businessId ?? null,
      branchId: params.user?.activeBranchId ?? null,
      userId: params.user?.id ?? null,
      action: params.action,
      module: params.module,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      summary: params.summary ?? null,
      changes: changes && Object.keys(changes).length ? JSON.stringify(changes) : null,
      metadata: params.metadata != null ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress ?? null
    }
  });
  return presentAuditRow(row as unknown as Record<string, unknown>);
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
  return logs.map((row) => presentAuditRow(row as unknown as Record<string, unknown>));
}
