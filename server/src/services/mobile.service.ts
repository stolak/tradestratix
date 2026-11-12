import { prisma } from '../utils/prisma.js';
import { roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { unreadCount } from './notification.service.js';
import { markDelivered } from './logistics.service.js';

export async function getHome(user: AuthUser) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const [todaySales, openDeliveries, unread] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: {
        businessId: user.businessId,
        status: 'posted',
        invoiceDate: { gte: start, lte: end }
      },
      _sum: { recognisedAmount: true },
      _count: true
    }),
    prisma.deliveryOrder.count({
      where: {
        businessId: user.businessId,
        status: { in: ['draft', 'scheduled', 'dispatched'] }
      }
    }),
    unreadCount(user)
  ]);

  return {
    today_sales: {
      count: todaySales._count,
      amount: roundMoney(Number(todaySales._sum.recognisedAmount ?? 0))
    },
    open_deliveries: openDeliveries,
    unread_notifications: unread
  };
}

export async function listOpenDeliveries(businessId: string) {
  const rows = await prisma.deliveryOrder.findMany({
    where: {
      businessId,
      status: { in: ['scheduled', 'dispatched'] }
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, addressLine1: true, city: true } },
      warehouse: { select: { id: true, name: true, code: true } },
      vehicle: { select: { id: true, name: true, plateNumber: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } }
        }
      }
    },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'desc' }]
  });
  return serialize(rows);
}

export async function deliverMobile(user: AuthUser, id: string, body: Record<string, any> = {}) {
  return markDelivered(user, id, body);
}
