/**
 * Backfill JournalEntry customer/supplier/salesRepresentative from source documents.
 * Only fills null fields where the source relationship is unambiguous.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  let updated = 0;

  const sales = await prisma.journalEntry.findMany({
    where: {
      sourceType: { in: ['sales_invoice', 'sales_cogs'] },
      OR: [{ customerId: null }, { salesRepresentativeId: null }]
    },
    select: { id: true, sourceId: true, customerId: true, salesRepresentativeId: true }
  });
  for (const je of sales) {
    if (!je.sourceId) continue;
    const inv = await prisma.salesInvoice.findUnique({
      where: { id: je.sourceId },
      select: { customerId: true, salesRepId: true, businessId: true }
    });
    if (!inv) continue;
    const data: { customerId?: string; salesRepresentativeId?: string | null } = {};
    if (!je.customerId) data.customerId = inv.customerId;
    if (!je.salesRepresentativeId && inv.salesRepId) data.salesRepresentativeId = inv.salesRepId;
    if (!Object.keys(data).length) continue;
    await prisma.journalEntry.update({ where: { id: je.id }, data });
    updated += 1;
  }

  const payments = await prisma.journalEntry.findMany({
    where: { sourceType: 'customer_payment', customerId: null },
    select: { id: true, sourceId: true }
  });
  for (const je of payments) {
    if (!je.sourceId) continue;
    const pay = await prisma.customerPayment.findUnique({
      where: { id: je.sourceId },
      select: { customerId: true }
    });
    if (!pay) continue;
    await prisma.journalEntry.update({
      where: { id: je.id },
      data: { customerId: pay.customerId }
    });
    updated += 1;
  }

  const grns = await prisma.journalEntry.findMany({
    where: { sourceType: 'grn', supplierId: null },
    select: { id: true, sourceId: true }
  });
  for (const je of grns) {
    if (!je.sourceId) continue;
    const grn = await prisma.goodsReceiptNote.findUnique({
      where: { id: je.sourceId },
      select: { supplierId: true }
    });
    if (!grn?.supplierId) continue;
    await prisma.journalEntry.update({
      where: { id: je.id },
      data: { supplierId: grn.supplierId }
    });
    updated += 1;
  }

  const supplierPays = await prisma.journalEntry.findMany({
    where: { sourceType: 'supplier_payment', supplierId: null },
    select: { id: true, sourceId: true }
  });
  for (const je of supplierPays) {
    if (!je.sourceId) continue;
    const pay = await prisma.supplierPayment.findUnique({
      where: { id: je.sourceId },
      select: { supplierId: true }
    });
    if (!pay) continue;
    await prisma.journalEntry.update({
      where: { id: je.id },
      data: { supplierId: pay.supplierId }
    });
    updated += 1;
  }

  console.log(`Backfilled entity attribution on ${updated} journal entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
