/**
 * Stamp JournalLine customer/supplier/sales-rep ids from header + current control accounts.
 * Idempotent. Use after schema push for partner line-balance reporting.
 *
 *   npm run backfill:journal-line-entities
 *   npm run backfill:journal-line-entities -- --dry
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dry = process.argv.includes('--dry');

const CUSTOMER_KEYS = ['accounts_receivable'];
const SUPPLIER_KEYS = ['accounts_payable'];
const SALES_REP_KEYS = [
  'cash_in_custody_sales_rep',
  'sales_rep_commission_payable',
  'sales_rep_receivable'
];

async function accountIdsFor(prisma: PrismaClient, businessId: string, keys: string[]) {
  const rows = await prisma.defaultAccountSetting.findMany({
    where: { businessId, settingKey: { in: keys } },
    select: { accountId: true }
  });
  return [...new Set(rows.map((r) => r.accountId))];
}

async function stamp(
  prisma: PrismaClient,
  opts: {
    businessId: string;
    businessName: string;
    label: string;
    headerCol: string;
    lineCol: string;
    accountIds: string[];
  }
) {
  if (!opts.accountIds.length) return 0;
  const placeholders = opts.accountIds.map(() => '?').join(',');
  if (dry) {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*) AS c
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE je.business_id = ?
         AND je.\`${opts.headerCol}\` IS NOT NULL
         AND jl.\`${opts.lineCol}\` IS NULL
         AND jl.account_id IN (${placeholders})`,
      opts.businessId,
      ...opts.accountIds
    );
    const n = Number(rows[0]?.c || 0);
    console.log(`  ${opts.businessName}: would stamp ${n} ${opts.label}`);
    return n;
  }
  const result = await prisma.$executeRawUnsafe(
    `UPDATE journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     SET jl.\`${opts.lineCol}\` = je.\`${opts.headerCol}\`
     WHERE je.business_id = ?
       AND je.\`${opts.headerCol}\` IS NOT NULL
       AND jl.\`${opts.lineCol}\` IS NULL
       AND jl.account_id IN (${placeholders})`,
    opts.businessId,
    ...opts.accountIds
  );
  const n = Number(result || 0);
  console.log(`  ${opts.businessName}: stamped ${n} ${opts.label}`);
  return n;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const businesses = await prisma.business.findMany({ select: { id: true, name: true } });
    let updated = 0;

    for (const biz of businesses) {
      const [arIds, apIds, repIds] = await Promise.all([
        accountIdsFor(prisma, biz.id, CUSTOMER_KEYS),
        accountIdsFor(prisma, biz.id, SUPPLIER_KEYS),
        accountIdsFor(prisma, biz.id, SALES_REP_KEYS)
      ]);

      updated += await stamp(prisma, {
        businessId: biz.id,
        businessName: biz.name,
        label: 'customer AR line(s)',
        headerCol: 'customer_id',
        lineCol: 'customer_id',
        accountIds: arIds
      });
      updated += await stamp(prisma, {
        businessId: biz.id,
        businessName: biz.name,
        label: 'supplier AP line(s)',
        headerCol: 'supplier_id',
        lineCol: 'supplier_id',
        accountIds: apIds
      });
      updated += await stamp(prisma, {
        businessId: biz.id,
        businessName: biz.name,
        label: 'sales-rep control line(s)',
        headerCol: 'sales_representative_id',
        lineCol: 'sales_representative_id',
        accountIds: repIds
      });
    }

    console.log(
      dry
        ? `\nDry run: ${updated} line(s) would be stamped.`
        : `\nDone: ${updated} line(s) stamped.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
