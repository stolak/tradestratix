import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';

export function toSnakeCaseKey(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export function serialize<T = unknown>(value: unknown): T {
  if (value === null || value === undefined) return value as T;
  if (Array.isArray(value)) return value.map((item) => serialize(item)) as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber() as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toSnakeCaseKey(k)] = serialize(v);
    }
    return out as T;
  }
  return value as T;
}

/** Round money for display / 2-decimal posting lines. Prefer Decimal for storage math. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function toDec(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(typeof n === 'number' ? roundMoney(n) : n);
}

/**
 * Next `PREFIX-000123` document number, continuing from the highest existing one
 * (not a row count, which collides once any record is deleted).
 * `delegate` is a Prisma model delegate (e.g. `tx.journalEntry`) scoped by `businessId`.
 */
export async function nextDocNumber(
  delegate: any,
  businessId: string,
  field: string,
  prefix: string,
  width: number
): Promise<string> {
  const stem = `${prefix}-`;
  const last = await delegate.findFirst({
    where: { businessId, [field]: { startsWith: stem } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true }
  });
  let n = last ? parseInt(String(last[field]).slice(stem.length), 10) || 0 : 0;
  for (;;) {
    n += 1;
    const candidate = `${stem}${String(n).padStart(width, '0')}`;
    const taken = await delegate.findFirst({
      where: { businessId, [field]: candidate },
      select: { [field]: true }
    });
    if (!taken) return candidate;
  }
}

export function shortId(prefix: string): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

export function uuidId(prefix: string): string {
  return `${prefix}-${uuidv4()}`;
}

export function omitPassword<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _pw, ...rest } = user;
  return rest;
}

export function httpError(status: number, message: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, `${field} is required`);
  }
  return value.trim();
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
