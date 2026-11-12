/**
 * One-off, idempotent migration for invoices confirmed before revenue-at-hand-over.
 *
 * Invoices posted under the old rules booked revenue/AR for the full value at posting. They are marked
 * `recognition_policy = on_posting` with recognised = total so hand-overs only relieve stock and book
 * COGS, never revenue again. Line base quantities and payment allocation AR splits are filled in.
 *
 *   npm run backfill:fulfilment            # apply
 *   npm run backfill:fulfilment -- --dry   # report only
 */
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/utils/prisma.js';
import { roundMoney, toDec } from '../src/utils/helpers.js';
import { convertToBaseQty } from '../src/services/inventory.service.js';

const dry = process.argv.includes('--dry');

async function main() {
  const legacy = await prisma.salesInvoice.findMany({
    where: {
      status: 'posted',
      recognitionPolicy: 'at_fulfilment',
      recognisedAmount: 0,
      journalEntryId: { not: null },
      fulfilments: { none: { recognisedAmount: { gt: 0 } } }
    },
    include: { items: { include: { product: { select: { baseUomId: true } } } } }
  });
  console.log(`${legacy.length} legacy posted invoice(s) to mark as on_posting${dry ? ' (dry run)' : ''}`);

  for (const inv of legacy) {
    const total = Number(inv.totalAmount);
    const subtotal = Number(inv.subtotal);
    if (dry) {
      console.log(`  ${inv.invoiceNumber}  total ${total}`);
      continue;
    }
    await prisma.$transaction(async (tx) => {
      let assigned = 0;
      for (const [idx, item] of inv.items.entries()) {
        const last = idx === inv.items.length - 1;
        const share = last
          ? roundMoney(total - assigned)
          : subtotal > 0
            ? roundMoney((Number(item.lineTotal) * total) / subtotal)
            : 0;
        assigned = roundMoney(assigned + share);
        await tx.salesInvoiceItem.update({
          where: { id: item.id },
          data: { recognisedAmount: toDec(share) }
        });
      }
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: { recognitionPolicy: 'on_posting', recognisedAmount: toDec(total) }
      });
      await tx.$executeRaw`
        UPDATE customer_payment_allocations
           SET ar_amount = amount
         WHERE invoice_id = ${inv.id} AND ar_amount = 0 AND deposit_amount = 0`;
    });
    console.log(`  ${inv.invoiceNumber}  marked on_posting (${total})`);
  }

  const missingBase = await prisma.salesInvoiceItem.findMany({
    where: { baseQuantity: null, invoice: { status: 'posted' } },
    include: { product: { select: { id: true, baseUomId: true } } }
  });
  console.log(`${missingBase.length} posted line(s) without a base quantity`);
  if (!dry) {
    for (const item of missingBase) {
      const base = await convertToBaseQty(
        prisma,
        item.productId,
        item.uomId || item.product.baseUomId,
        Number(item.quantity),
        item.product.baseUomId
      );
      await prisma.salesInvoiceItem.update({
        where: { id: item.id },
        data: { baseQuantity: toDec(Math.round(base * 10000) / 10000) }
      });
    }
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
