/**
 * Move walk-in customer payment debits from till/cash/bank onto Cash in Custody
 * and stamp sales_representative_id from the invoice / payment journal header.
 *
 *   npx tsx scripts/reclass-walkin-to-custody.ts
 *   npx tsx scripts/reclass-walkin-to-custody.ts --dry
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const dry = process.argv.includes('--dry');

const p = new PrismaClient();

async function main() {
  const businesses = await p.business.findMany({ select: { id: true, name: true } });
  let fixed = 0;

  for (const biz of businesses) {
    const custody = await p.defaultAccountSetting.findFirst({
      where: { businessId: biz.id, settingKey: 'cash_in_custody_sales_rep' },
      select: { accountId: true }
    });
    if (!custody?.accountId) {
      console.log(`${biz.name}: no custody default — skip`);
      continue;
    }

    const walkIns = await p.customer.findMany({
      where: {
        businessId: biz.id,
        OR: [{ customerType: 'walk_in' }, { code: 'WALK-IN' }]
      },
      select: { id: true }
    });
    if (!walkIns.length) continue;
    const walkInIds = walkIns.map((c) => c.id);

    const payments = await p.customerPayment.findMany({
      where: {
        businessId: biz.id,
        customerId: { in: walkInIds },
        amount: { gt: 0 },
        journalEntryId: { not: null }
      },
      include: {
        allocations: { include: { invoice: { select: { salesRepId: true } } } }
      }
    });

    console.log(`${biz.name}: ${payments.length} walk-in payment(s)`);

    for (const pay of payments) {
      if (!pay.journalEntryId) continue;
      const je = await p.journalEntry.findFirst({
        where: { id: pay.journalEntryId, businessId: biz.id },
        include: { lines: true }
      });
      if (!je) continue;

      const debitLine = je.lines.find(
        (l) => Number(l.debit) > 0 && l.accountId !== custody.accountId
      );
      if (!debitLine) continue;

      const repId =
        je.salesRepresentativeId ||
        pay.allocations.map((a) => a.invoice?.salesRepId).find(Boolean) ||
        null;
      if (!repId) {
        console.warn(`  ${pay.paymentNumber}: no sales rep — left unchanged`);
        continue;
      }

      if (dry) {
        console.log(
          `  would move ${pay.paymentNumber} debit ${debitLine.debit} → custody, rep ${repId}`
        );
        fixed += 1;
        continue;
      }

      await p.$transaction(async (tx) => {
        await tx.journalLine.update({
          where: { id: debitLine.id },
          data: {
            accountId: custody.accountId,
            salesRepresentativeId: repId,
            description: `Walk-in custody ${pay.paymentNumber}`
          }
        });
        await tx.journalEntry.update({
          where: { id: je.id },
          data: { salesRepresentativeId: je.salesRepresentativeId || repId }
        });
        await tx.customerPayment.update({
          where: { id: pay.id },
          data: { accountId: custody.accountId, method: 'custody' }
        });
      });
      console.log(`  reclassed ${pay.paymentNumber} → custody / ${repId}`);
      fixed += 1;
    }
  }

  console.log(dry ? `Dry run: ${fixed}` : `Reclassed ${fixed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
