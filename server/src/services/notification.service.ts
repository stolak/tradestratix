import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';

export type CreateNotificationInput = {
  businessId: string;
  userId?: string | null;
  title: string;
  body: string;
  module?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

/** Helper for other modules to push in-app notifications. */
export async function createNotification(input: CreateNotificationInput) {
  const row = await prisma.appNotification.create({
    data: {
      id: shortId('ntf'),
      businessId: input.businessId,
      userId: input.userId ?? null,
      title: requireString(input.title, 'title'),
      body: requireString(input.body, 'body'),
      module: input.module ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      isRead: false
    }
  });
  return serialize(row);
}

export async function listNotifications(
  user: AuthUser,
  opts?: { unread_only?: boolean; limit?: number }
) {
  const rows = await prisma.appNotification.findMany({
    where: {
      businessId: user.businessId,
      OR: [{ userId: user.id }, { userId: null }],
      ...(opts?.unread_only ? { isRead: false } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 100
  });
  return serialize(rows);
}

export async function markRead(user: AuthUser, id: string) {
  const row = await prisma.appNotification.findFirst({
    where: {
      id,
      businessId: user.businessId,
      OR: [{ userId: user.id }, { userId: null }]
    }
  });
  if (!row) throw httpError(404, 'Notification not found');

  const updated = await prisma.appNotification.update({
    where: { id },
    data: { isRead: true }
  });
  return serialize(updated);
}

export async function markAllRead(user: AuthUser) {
  const result = await prisma.appNotification.updateMany({
    where: {
      businessId: user.businessId,
      isRead: false,
      OR: [{ userId: user.id }, { userId: null }]
    },
    data: { isRead: true }
  });
  return { updated: result.count };
}

export async function unreadCount(user: AuthUser) {
  return prisma.appNotification.count({
    where: {
      businessId: user.businessId,
      isRead: false,
      OR: [{ userId: user.id }, { userId: null }]
    }
  });
}
