import { prisma } from '../utils/prisma.js';
import { roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function qtyNum(v: unknown): number {
  return Number(v ?? 0);
}

export async function getInsights(user: AuthUser, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const businessId = user.businessId;

  const warehouses = await prisma.warehouse.findMany({
    where: { businessId, ...scope },
    select: { id: true }
  });
  const warehouseIds = warehouses.map((w) => w.id);

  const [
    salesAgg,
    purchaseAgg,
    expenseAgg,
    openArAgg,
    openApAgg,
    products,
    expiryLots,
    lastPayroll,
    deliveryGroups,
    budgetCount
  ] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { businessId, status: 'posted', ...scope },
      _sum: { totalAmount: true },
      _count: true
    }),
    prisma.supplierBill.aggregate({
      where: { businessId, status: { not: 'void' }, ...scope },
      _sum: { totalAmount: true },
      _count: true
    }),
    prisma.expenseBill.aggregate({
      where: { businessId, status: 'posted', ...scope },
      _sum: { totalAmount: true },
      _count: true
    }),
    prisma.salesInvoice.aggregate({
      where: {
        businessId,
        ...scope,
        status: 'posted',
        paymentStatus: { in: ['open', 'partial'] },
        balance: { gt: 0 }
      },
      _sum: { balance: true },
      _count: true
    }),
    prisma.supplierBill.aggregate({
      where: {
        businessId,
        ...scope,
        status: { in: ['open', 'partial'] },
        balance: { gt: 0 }
      },
      _sum: { balance: true },
      _count: true
    }),
    prisma.product.findMany({
      where: { businessId, status: 'active' },
      select: {
        id: true,
        reorderLevel: true,
        stockLots: {
          where: warehouseIds.length ? { warehouseId: { in: warehouseIds } } : { warehouseId: { in: [] } },
          select: { quantityOnHand: true, quantityReserved: true }
        }
      }
    }),
    (async () => {
      const today = new Date();
      const horizon = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
      const todayStr = today.toISOString().slice(0, 10);
      return prisma.stockLot.count({
        where: {
          businessId,
          warehouseId: { in: warehouseIds },
          quantityOnHand: { gt: 0 },
          expiryDate: { not: null, gte: todayStr, lte: horizon }
        }
      });
    })(),
    prisma.payrollRun.findFirst({
      where: { businessId, ...scope },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        runNumber: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        payDate: true,
        totalGross: true,
        totalDeductions: true,
        totalNet: true,
        createdAt: true
      }
    }),
    prisma.deliveryOrder.groupBy({
      by: ['status'],
      where: { businessId, ...scope },
      _count: { _all: true }
    }),
    prisma.budget.count({ where: { businessId, ...scope } })
  ]);

  let lowStockCount = 0;
  for (const p of products) {
    const available = p.stockLots.reduce(
      (s, l) => s + qtyNum(l.quantityOnHand) - qtyNum(l.quantityReserved),
      0
    );
    if (available <= qtyNum(p.reorderLevel)) lowStockCount += 1;
  }

  const deliveriesByStatus: Record<string, number> = {};
  for (const g of deliveryGroups) {
    deliveriesByStatus[g.status] = g._count._all;
  }

  return {
    sales: {
      count: salesAgg._count,
      total_amount: roundMoney(Number(salesAgg._sum.totalAmount ?? 0))
    },
    purchases: {
      count: purchaseAgg._count,
      total_amount: roundMoney(Number(purchaseAgg._sum.totalAmount ?? 0))
    },
    expenses: {
      count: expenseAgg._count,
      total_amount: roundMoney(Number(expenseAgg._sum.totalAmount ?? 0))
    },
    open_ar: {
      count: openArAgg._count,
      balance: roundMoney(Number(openArAgg._sum.balance ?? 0))
    },
    open_ap: {
      count: openApAgg._count,
      balance: roundMoney(Number(openApAgg._sum.balance ?? 0))
    },
    low_stock_count: lowStockCount,
    upcoming_expiry_lots_90d: expiryLots,
    payroll_last_run: lastPayroll ? serialize(lastPayroll) : null,
    deliveries_by_status: deliveriesByStatus,
    budget_count: budgetCount
  };
}
