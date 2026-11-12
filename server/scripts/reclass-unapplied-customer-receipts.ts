/**
 * Reclass legacy "Unapplied Customer Receipts" credit lines onto Accounts Receivable
 * and stamp customer_id from the journal entry header.
 *
 * Customer surplus now lives on AR as a credit balance — no separate liability.
 *
 *   npx tsx scripts/reclass-unapplied-customer-receipts.ts
 *   npx tsx scripts/reclass-unapplied-customer-receipts.ts --dry
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dry = process.argv.includes('--dry');

async function main() {
  const prisma = new PrismaClient();
  try {
    const businesses = await prisma.business.findMany({ select: { id: true, name: true } });
    let total = 0;

    for (const biz of businesses) {
      const unapplied = await prisma.defaultAccountSetting.findFirst({
        where: { businessId: biz.id, settingKey: 'unapplied_customer_receipts' },
        select: { accountId: true }
      });
      const ar = await prisma.defaultAccountSetting.findFirst({
        where: { businessId: biz.id, settingKey: 'accounts_receivable' },
        select: { accountId: true }
      });
      if (!unapplied?.accountId || !ar?.accountId) {
        console.log(`${biz.name}: skip (missing unapplied or AR default)`);
        continue;
      }
      if (unapplied.accountId === ar.accountId) {
        console.log(`${biz.name}: skip (unapplied already mapped to AR)`);
        continue;
      }

      const lines = await prisma.$queryRawUnsafe<
        Array<{ id: string; journal_entry_id: string; customer_id: string | null; credit: unknown }>
      >(
        `SELECT jl.id, jl.journal_entry_id, je.customer_id, jl.credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.business_id = ?
           AND jl.account_id = ?
           AND jl.credit > 0
           AND je.status IN ('posted', 'reversed')`,
        biz.id,
        unapplied.accountId
      );

      console.log(`${biz.name}: ${lines.length} unapplied credit line(s)`);
      if (!lines.length) continue;

      for (const line of lines) {
        if (!line.customer_id) {
          console.warn(`  ${line.id}: no header customer_id — left unchanged`);
          continue;
        }
        if (dry) {
          console.log(
            `  would reclass ${line.id} credit ${line.credit} → AR, customer ${line.customer_id}`
          );
          total += 1;
          continue;
        }
        await prisma.$executeRawUnsafe(
          `UPDATE journal_lines
           SET account_id = ?,
               customer_id = ?,
               description = REPLACE(REPLACE(description, 'Unapplied credit', 'Customer credit'), 'unapplied credit', 'customer credit')
           WHERE id = ?`,
          ar.accountId,
          line.customer_id,
          line.id
        );
        console.log(`  reclassed ${line.id} → AR / ${line.customer_id}`);
        total += 1;
      }
    }

    console.log(dry ? `Dry run: would reclass ${total} line(s)` : `Reclassed ${total} line(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
