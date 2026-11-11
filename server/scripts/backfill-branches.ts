/**
 * Backfill branch FKs and UserBranch membership rows after multi-branch schema.
 * Run: npx tsx scripts/backfill-branches.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;

async function ensureBranch(businessId: string) {
  let branch = await prisma.branch.findFirst({
    where: { businessId, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) {
    branch = await prisma.branch.findFirst({ where: { businessId } });
  }
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        id: id('br'),
        businessId,
        name: 'Head Office',
        code: 'HQ',
        isActive: true
      }
    });
  } else if (!branch.isActive) {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: { isActive: true }
    });
  }
  return branch;
}

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  for (const biz of businesses) {
    const branch = await ensureBranch(biz.id);
    const warehouses = await prisma.warehouse.findMany({
      where: { businessId: biz.id },
      select: { id: true, branchId: true }
    });
    const whBranch = new Map(warehouses.map((w) => [w.id, w.branchId]));

    // User memberships
    const users = await prisma.user.findMany({ where: { businessId: biz.id } });
    for (const u of users) {
      const target = u.defaultBranchId || branch.id;
      if (!u.defaultBranchId) {
        await prisma.user.update({
          where: { id: u.id },
          data: { defaultBranchId: target }
        });
      }
      await prisma.userBranch.upsert({
        where: { userId_branchId: { userId: u.id, branchId: target } },
        create: {
          userId: u.id,
          businessId: biz.id,
          branchId: target,
          status: 'active',
          roleCode: u.role
        },
        update: { status: 'active', businessId: biz.id }
      });
    }

    // Helper: set branchId from warehouse or default
    const fromWh = (warehouseId: string | null | undefined) =>
      (warehouseId && whBranch.get(warehouseId)) || branch.id;

    await prisma.purchaseOrder.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    for (const po of await prisma.purchaseOrder.findMany({
      where: { businessId: biz.id },
      select: { id: true, warehouseId: true, branchId: true }
    })) {
      const bid = fromWh(po.warehouseId);
      if (po.branchId !== bid) {
        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { branchId: bid } });
      }
    }

    await prisma.goodsReceiptNote.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    for (const grn of await prisma.goodsReceiptNote.findMany({
      where: { businessId: biz.id },
      select: { id: true, warehouseId: true, branchId: true }
    })) {
      const bid = fromWh(grn.warehouseId);
      if (grn.branchId !== bid) {
        await prisma.goodsReceiptNote.update({
          where: { id: grn.id },
          data: { branchId: bid }
        });
      }
    }
    await prisma.supplierBill.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.supplierPayment.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.salesInvoice.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    for (const inv of await prisma.salesInvoice.findMany({
      where: { businessId: biz.id },
      select: { id: true, warehouseId: true }
    })) {
      await prisma.salesInvoice.update({
        where: { id: inv.id },
        data: { branchId: fromWh(inv.warehouseId) }
      });
    }
    await prisma.customerPayment.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.salesCommission.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.expenseBill.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.bankAccount.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.bankTransaction.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.journalEntry.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.payrollRun.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.budget.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.fixedAsset.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.employee.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });
    await prisma.deliveryOrder.updateMany({
      where: { businessId: biz.id, branchId: null },
      data: { branchId: branch.id }
    });

    for (const sm of await prisma.stockMovement.findMany({
      where: { businessId: biz.id, branchId: null },
      select: { id: true, warehouseId: true }
    })) {
      await prisma.stockMovement.update({
        where: { id: sm.id },
        data: { branchId: fromWh(sm.warehouseId) }
      });
    }

    for (const tr of await prisma.stockTransfer.findMany({
      where: { businessId: biz.id },
      select: { id: true, fromWarehouseId: true, toWarehouseId: true }
    })) {
      await prisma.stockTransfer.update({
        where: { id: tr.id },
        data: {
          fromBranchId: fromWh(tr.fromWarehouseId),
          toBranchId: fromWh(tr.toWarehouseId)
        }
      });
    }

    console.log(`Backfilled business ${biz.id} → default branch ${branch.code}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
