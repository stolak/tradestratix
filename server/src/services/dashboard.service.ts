import { prisma } from '../utils/prisma.js';
import { serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';

export async function getDashboardSummary(user: AuthUser) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: user.activeBranchId
  });
  const branchId = typeof scope.branchId === 'string' ? scope.branchId : undefined;

  const [
    branches,
    warehouses,
    users,
    accounts,
    products,
    lowStockHint,
    recentJournals,
    recentAudit
  ] = await Promise.all([
    prisma.branch.count({ where: { businessId: user.businessId, isActive: true } }),
    prisma.warehouse.count({
      where: { businessId: user.businessId, isActive: true, ...scope }
    }),
    prisma.user.count({ where: { businessId: user.businessId, status: 'active' } }),
    prisma.account.count({ where: { businessId: user.businessId, isActive: true } }),
    prisma.product.count({ where: { businessId: user.businessId, status: 'active' } }),
    prisma.product.count({ where: { businessId: user.businessId, status: 'active' } }),
    prisma.journalEntry.findMany({
      where: { businessId: user.businessId, ...scope },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { lines: true }
    }),
    prisma.auditLog.findMany({
      where: {
        businessId: user.businessId,
        ...(branchId ? { branchId } : {})
      },
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
    active_branch_id: branchId || user.activeBranchId || null,
    recent_journals: serialize(recentJournals),
    recent_audit: serialize(recentAudit)
  };
}
