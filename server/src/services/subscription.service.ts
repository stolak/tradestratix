import { prisma } from '../utils/prisma.js';
import { httpError, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export async function listPlans() {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { monthlyPrice: 'asc' }
  });
  return serialize(
    plans.map((p) => ({
      ...p,
      modules: (() => {
        try {
          return JSON.parse(p.modulesJson);
        } catch {
          return [];
        }
      })()
    }))
  );
}

export async function getCurrentSubscription(businessId: string) {
  const sub = await prisma.businessSubscription.findFirst({
    where: { businessId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  if (!sub) return null;
  return serialize({
    ...sub,
    plan: {
      ...sub.plan,
      modules: (() => {
        try {
          return JSON.parse(sub.plan.modulesJson);
        } catch {
          return [];
        }
      })()
    }
  });
}

export async function listBusinessSubscriptions(businessId: string) {
  const rows = await prisma.businessSubscription.findMany({
    where: { businessId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function updateSubscriptionStatus(
  user: AuthUser,
  id: string,
  status: string
) {
  if (user.role !== 'business_owner') {
    throw httpError(403, 'Only business owners can update subscription status');
  }
  const allowed = ['trial', 'active', 'past_due', 'cancelled', 'expired'];
  if (!allowed.includes(status)) {
    throw httpError(400, `status must be one of: ${allowed.join(', ')}`);
  }

  const existing = await prisma.businessSubscription.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Subscription not found');

  const updated = await prisma.businessSubscription.update({
    where: { id },
    data: { status },
    include: { plan: true }
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'subscriptions',
    entityType: 'BusinessSubscription',
    entityId: updated.id,
    summary: `Subscription status set to ${status}`
  });

  return serialize(updated);
}
