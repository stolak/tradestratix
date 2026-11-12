import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { userHasAnyPermission } from './permission.service.js';
import * as branchAccess from './branch-access.service.js';

type Tx = Prisma.TransactionClient;

export const PICKUP_CODE_DAYS_SETTING = 'sales.pickup_code_days';
export const REQUIRE_PICKUP_CODE_SETTING = 'sales.require_pickup_code';
export const MAX_PICKUP_CODE_FAILURES = 5;

async function setting(client: Tx | typeof prisma, businessId: string, key: string) {
  const row = await client.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey: key } }
  });
  return row?.value ?? null;
}

/** Collection requires the customer's pickup code unless the business switched it off. */
export async function pickupCodeRequired(businessId: string, client: Tx | typeof prisma = prisma) {
  const v = await setting(client, businessId, REQUIRE_PICKUP_CODE_SETTING);
  return v == null ? true : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
}

/**
 * Issue (or reissue) the 6-digit code the customer quotes at collection. Expires after
 * `sales.pickup_code_days` days, or with the reservation when that setting is 0 / unset.
 */
export async function issuePickupCode(tx: Tx, businessId: string, invoiceId: string) {
  const inv = await tx.salesInvoice.findFirstOrThrow({ where: { id: invoiceId, businessId } });
  const days = Number(await setting(tx, businessId, PICKUP_CODE_DAYS_SETTING));
  let expiresAt: Date | null = inv.reservationExpiresAt;
  if (Number.isFinite(days) && days > 0) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.floor(days));
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await tx.salesInvoice.update({
    where: { id: invoiceId },
    data: { pickupCode: code, pickupCodeIssuedAt: new Date(), pickupCodeExpiresAt: expiresAt, pickupCodeFailures: 0 }
  });
  return { code, expiresAt };
}

export type CollectionCheck = {
  pickupCode?: string | null;
  overrideReason?: string | null;
  collectorName?: string | null;
  fulfilmentId?: string | null;
};

/**
 * Verify the collector before goods are released. A wrong code is recorded and counts towards the
 * lock-out; a supervisor with fulfilment.override_pickup_code can release without it (reason required).
 * Failures are written outside the release transaction so they persist when the release is rejected.
 */
export async function verifyCollection(user: AuthUser, invoiceId: string, check: CollectionCheck) {
  const inv = await prisma.salesInvoice.findFirst({ where: { id: invoiceId, businessId: user.businessId } });
  if (!inv) throw httpError(404, 'Invoice not found');
  const log = (result: string, reason?: string | null) =>
    prisma.pickupVerification.create({
      data: {
        id: shortId('pkv'),
        businessId: user.businessId,
        invoiceId,
        fulfilmentId: check.fulfilmentId || null,
        result,
        collectorName: check.collectorName || null,
        reason: reason || null,
        userId: user.id
      }
    });

  const overrideReason = String(check.overrideReason || '').trim();
  if (overrideReason) {
    if (!(await userHasAnyPermission(user.id, ['fulfilment.override_pickup_code']))) {
      throw httpError(403, 'You do not have permission to release without the pickup code (fulfilment.override_pickup_code)');
    }
    await log('override', overrideReason);
    return 'override' as const;
  }

  if (!inv.pickupCode || !(await pickupCodeRequired(user.businessId))) {
    await log('success', inv.pickupCode ? 'code not required by policy' : 'no code issued');
    return 'none' as const;
  }
  if (inv.pickupCodeFailures >= MAX_PICKUP_CODE_FAILURES) {
    await log('locked');
    throw httpError(423, 'Pickup code locked after repeated wrong entries. Ask the selling branch to reissue it.');
  }
  if (inv.pickupCodeExpiresAt && inv.pickupCodeExpiresAt < new Date()) {
    await log('failed', 'expired');
    throw httpError(400, 'The pickup code has expired. Ask the selling branch to reissue it.');
  }
  const entered = String(check.pickupCode || '').replace(/\s+/g, '');
  if (!entered) throw httpError(400, 'Enter the pickup code the customer received');
  if (entered !== inv.pickupCode) {
    const failures = inv.pickupCodeFailures + 1;
    await prisma.salesInvoice.update({ where: { id: invoiceId }, data: { pickupCodeFailures: failures } });
    await log(failures >= MAX_PICKUP_CODE_FAILURES ? 'locked' : 'failed', 'wrong code');
    throw httpError(
      400,
      failures >= MAX_PICKUP_CODE_FAILURES
        ? 'Wrong pickup code. The code is now locked; ask the selling branch to reissue it.'
        : `Wrong pickup code (${MAX_PICKUP_CODE_FAILURES - failures} attempt(s) left).`
    );
  }
  if (inv.pickupCodeFailures) {
    await prisma.salesInvoice.update({ where: { id: invoiceId }, data: { pickupCodeFailures: 0 } });
  }
  await log('success');
  return 'code' as const;
}

/** Reissue a pickup code (lost, expired or locked). Staff of the selling or revenue branch only. */
export async function reissuePickupCode(user: AuthUser, invoiceId: string, body: Record<string, any> = {}) {
  const reason = requireString(body.reason || 'reissued', 'reason');
  const inv = await prisma.salesInvoice.findFirst({ where: { id: invoiceId, businessId: user.businessId } });
  if (!inv) throw httpError(404, 'Invoice not found');
  if (inv.status !== 'posted' || inv.fulfilmentMode !== 'pickup') {
    throw httpError(400, 'Pickup codes exist only on confirmed pickup orders');
  }
  if (inv.fulfilmentStatus === 'fulfilled') throw httpError(400, 'This order has been fully collected');
  const branches = [inv.sellingBranchId, inv.branchId].filter((b): b is string => Boolean(b));
  if (!branchAccess.canAccessAllBranches(user)) {
    const mine = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
    if (!branches.some((b) => mine.includes(b))) {
      throw httpError(403, 'Only the selling or revenue branch can reissue the pickup code');
    }
  }
  const issued = await prisma.$transaction((tx) => issuePickupCode(tx, user.businessId, invoiceId));
  await writeAudit({
    user,
    action: 'reissue_pickup_code',
    module: 'sales',
    entityType: 'SalesInvoice',
    entityId: invoiceId,
    summary: `Reissued pickup code for ${inv.invoiceNumber}: ${reason}`
  });
  return serialize({ pickup_code: issued.code, pickup_code_expires_at: issued.expiresAt });
}
