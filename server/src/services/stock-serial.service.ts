import { Prisma } from '@prisma/client';
import { httpError, shortId, toDec } from '../utils/helpers.js';

type DbClient = Prisma.TransactionClient | typeof import('../utils/prisma.js').prisma;

export type SerialStatus =
  | 'available'
  | 'reserved'
  | 'in_transit'
  | 'sold'
  | 'written_off'
  | 'quarantine';

export function normalizeSerialList(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : raw.split(/[\n,]+/);
          } catch {
            return raw.split(/[\n,]+/);
          }
        })()
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const s = String(item || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) {
      throw httpError(400, `Duplicate serial number in request: ${s}`);
    }
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function assertWholeSerialQty(qty: number, label = 'Quantity') {
  if (!(qty > 0) || Math.abs(qty - Math.round(qty)) > 1e-9) {
    throw httpError(400, `${label} must be a whole number for serial-tracked products`);
  }
}

export function serializeSerialNumbers(serials: string[]): string | null {
  return serials.length ? JSON.stringify(serials) : null;
}

export function parseSerialNumbersJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return normalizeSerialList(raw);
}

/** Create available serials on receive into a lot/warehouse. */
export async function receiveSerials(
  client: DbClient,
  opts: {
    businessId: string;
    productId: string;
    variantId: string;
    warehouseId: string;
    lotId: string;
    serialNumbers: string[];
    unitCost?: number | null;
  }
) {
  const serials = opts.serialNumbers.map((s) => s.trim()).filter(Boolean);
  if (!serials.length) throw httpError(400, 'serial_numbers is required for serial-tracked products');

  const existing = await client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      productId: opts.productId,
      serialNumber: { in: serials }
    },
    select: { serialNumber: true, status: true }
  });
  if (existing.length) {
    throw httpError(
      409,
      `Serial already on file: ${existing.map((e) => e.serialNumber).join(', ')}`
    );
  }

  const now = new Date();
  await client.stockSerial.createMany({
    data: serials.map((serialNumber) => ({
      id: shortId('ssn'),
      businessId: opts.businessId,
      productId: opts.productId,
      variantId: opts.variantId,
      warehouseId: opts.warehouseId,
      lotId: opts.lotId,
      serialNumber,
      status: 'available',
      unitCost: opts.unitCost != null ? toDec(opts.unitCost) : null,
      receivedAt: now
    }))
  });
  return serials;
}

/**
 * Reserve explicitly chosen available serials onto a sales reservation.
 * Serials are never auto-picked — the caller must supply the exact list.
 */
export async function reserveSerialsForLot(
  client: DbClient,
  opts: {
    businessId: string;
    lotId: string;
    reservationId: string;
    qty: number;
    serialNumbers: string[];
    productName?: string;
  }
) {
  assertWholeSerialQty(opts.qty, 'Reserved quantity');
  const need = Math.round(opts.qty);
  const wanted = normalizeSerialList(opts.serialNumbers);
  if (wanted.length !== need) {
    throw httpError(
      400,
      `Select exactly ${need} serial number(s) for ${opts.productName || 'product'} (got ${wanted.length})`
    );
  }
  const available = await client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      lotId: opts.lotId,
      serialNumber: { in: wanted },
      status: 'available'
    }
  });
  if (available.length !== wanted.length) {
    const have = new Set(available.map((s) => s.serialNumber.toLowerCase()));
    const missing = wanted.filter((w) => !have.has(w.toLowerCase()));
    throw httpError(
      400,
      `Serial not available on this lot for ${opts.productName || 'product'}: ${missing.join(', ')}`
    );
  }
  await client.stockSerial.updateMany({
    where: { id: { in: available.map((s) => s.id) } },
    data: { status: 'reserved', reservationId: opts.reservationId }
  });
  return available.map((s) => s.serialNumber);
}

/** Issue reserved serials for a reservation (or explicit list). Marks sold. */
export async function issueSerials(
  client: DbClient,
  opts: {
    businessId: string;
    qty: number;
    reservationId?: string | null;
    lotId?: string | null;
    serialNumbers?: string[] | null;
    referenceType: string;
    referenceId: string;
  }
) {
  assertWholeSerialQty(opts.qty, 'Issue quantity');
  const need = Math.round(opts.qty);
  let rows: { id: string; serialNumber: string }[] = [];

  if (opts.serialNumbers?.length) {
    const wanted = normalizeSerialList(opts.serialNumbers);
    if (wanted.length !== need) {
      throw httpError(400, `Expected ${need} serial number(s), got ${wanted.length}`);
    }
    const found = await client.stockSerial.findMany({
      where: {
        businessId: opts.businessId,
        serialNumber: { in: wanted },
        ...(opts.lotId ? { lotId: opts.lotId } : {}),
        status: { in: ['reserved', 'available'] }
      }
    });
    if (found.length !== wanted.length) {
      const have = new Set(found.map((f) => f.serialNumber.toLowerCase()));
      const missing = wanted.filter((w) => !have.has(w.toLowerCase()));
      throw httpError(400, `Serial not available to issue: ${missing.join(', ')}`);
    }
    rows = found;
  } else if (opts.reservationId) {
    rows = await client.stockSerial.findMany({
      where: {
        businessId: opts.businessId,
        reservationId: opts.reservationId,
        status: 'reserved'
      },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      take: need
    });
    if (rows.length < need) {
      throw httpError(
        400,
        `Reservation is missing serials (need ${need}, found ${rows.length})`
      );
    }
  } else {
    throw httpError(400, 'serial_numbers is required to issue serial-tracked stock');
  }

  const now = new Date();
  await client.stockSerial.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: {
      status: 'sold',
      reservationId: null,
      issuedAt: now,
      issuedReferenceType: opts.referenceType,
      issuedReferenceId: opts.referenceId
    }
  });
  return rows.map((r) => r.serialNumber);
}

/**
 * Hold explicitly chosen available serials for transfer (in_transit).
 * Serials are never auto-picked — the caller must supply the exact list.
 */
export async function holdSerialsForTransfer(
  client: DbClient,
  opts: {
    businessId: string;
    lotId: string;
    qty: number;
    serialNumbers: string[];
    productName?: string;
  }
) {
  assertWholeSerialQty(opts.qty, 'Transfer quantity');
  const need = Math.round(opts.qty);
  const wanted = normalizeSerialList(opts.serialNumbers);
  if (!wanted.length) {
    throw httpError(
      400,
      `Select ${need} serial number(s) to transfer for ${opts.productName || 'product'}`
    );
  }
  if (wanted.length !== need) {
    throw httpError(
      400,
      `Select exactly ${need} serial number(s) for transfer of ${opts.productName || 'product'} (got ${wanted.length})`
    );
  }
  const rows = await client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      lotId: opts.lotId,
      serialNumber: { in: wanted },
      status: 'available'
    }
  });
  if (rows.length !== wanted.length) {
    const have = new Set(rows.map((s) => s.serialNumber.toLowerCase()));
    const missing = wanted.filter((w) => !have.has(w.toLowerCase()));
    throw httpError(400, `Serial not available for transfer: ${missing.join(', ')}`);
  }

  await client.stockSerial.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: 'in_transit' }
  });
  return rows.map((r) => r.serialNumber);
}

/** Available serials for issue / transfer / pick UIs. */
export async function listAvailableSerials(
  client: DbClient,
  opts: {
    businessId: string;
    productId?: string;
    warehouseId?: string;
    lotId?: string;
    variantId?: string;
    take?: number;
  }
) {
  return client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      status: 'available',
      ...(opts.productId ? { productId: opts.productId } : {}),
      ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      ...(opts.lotId ? { lotId: opts.lotId } : {}),
      ...(opts.variantId ? { variantId: opts.variantId } : {})
    },
    select: {
      id: true,
      serialNumber: true,
      productId: true,
      variantId: true,
      warehouseId: true,
      lotId: true,
      receivedAt: true,
      lot: { select: { id: true, batchNumber: true, expiryDate: true } }
    },
    orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    take: opts.take ?? 500
  });
}

/** Complete transfer: move in_transit serials to destination warehouse/lot as available. */
export async function receiveTransferSerials(
  client: DbClient,
  opts: {
    businessId: string;
    serialNumbers: string[];
    toWarehouseId: string;
    toLotId: string;
  }
) {
  const serials = normalizeSerialList(opts.serialNumbers);
  if (!serials.length) return;
  const rows = await client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      serialNumber: { in: serials },
      status: 'in_transit'
    }
  });
  if (rows.length !== serials.length) {
    throw httpError(400, 'Transfer serials are missing or not in transit');
  }
  await client.stockSerial.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: {
      status: 'available',
      warehouseId: opts.toWarehouseId,
      lotId: opts.toLotId,
      reservationId: null
    }
  });
}

/** Restock sold serials from a sale back to available at the return warehouse/lot. */
export async function restockSoldSerials(
  client: DbClient,
  opts: {
    businessId: string;
    productId: string;
    variantId: string | null;
    invoiceId: string;
    qty: number;
    warehouseId: string;
    lotId: string;
  }
) {
  assertWholeSerialQty(opts.qty, 'Return quantity');
  const need = Math.round(opts.qty);
  const sold = await client.stockSerial.findMany({
    where: {
      businessId: opts.businessId,
      productId: opts.productId,
      ...(opts.variantId ? { variantId: opts.variantId } : {}),
      status: 'sold',
      issuedReferenceType: 'sales_invoice',
      issuedReferenceId: opts.invoiceId
    },
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    take: need
  });
  if (sold.length < need) {
    throw httpError(
      400,
      `Cannot restock serials: need ${need} sold units from this invoice, found ${sold.length}`
    );
  }
  await client.stockSerial.updateMany({
    where: { id: { in: sold.map((s) => s.id) } },
    data: {
      status: 'available',
      warehouseId: opts.warehouseId,
      lotId: opts.lotId,
      reservationId: null,
      issuedAt: null,
      issuedReferenceType: null,
      issuedReferenceId: null
    }
  });
  return sold.map((s) => s.serialNumber);
}

/** Release reserved serials back to available (cancel / unreserve). */
export async function releaseReservedSerials(client: DbClient, reservationIds: string[]) {
  if (!reservationIds.length) return;
  await client.stockSerial.updateMany({
    where: { reservationId: { in: reservationIds }, status: 'reserved' },
    data: { status: 'available', reservationId: null }
  });
}
