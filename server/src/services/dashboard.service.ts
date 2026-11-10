import { prisma } from '../utils/prisma.js';
import { serialize } from '../utils/helpers.js';

export async function getDashboardSummary(businessId: string) {
  const [branches, warehouses, users, accounts, products, lowStockHint, recentJournals, recentAudit] =
    await Promise.all([
      prisma.branch.count({ where: { businessId, isActive: true } }),
      prisma.warehouse.count({ where: { businessId, isActive: true } }),
      prisma.user.count({ where: { businessId, status: 'active' } }),
      prisma.account.count({ where: { businessId, isActive: true } }),
      prisma.product.count({ where: { businessId, status: 'active' } }),
      prisma.product.count({ where: { businessId, status: 'active' } }),
      prisma.journalEntry.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { lines: true }
      }),
      prisma.auditLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 8
      })
    ]);

  return {
    counts: {
      branches,
      warehouses,
      users,
      accounts,
      products,
      catalogue_items: lowStockHint
    },
    recent_journals: serialize(recentJournals),
    recent_audit: serialize(recentAudit)
  };
}
