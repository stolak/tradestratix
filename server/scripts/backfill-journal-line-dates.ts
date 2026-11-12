/**
 * Add / backfill journal_entries.transaction_date and journal_lines date columns.
 * Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function columnExists(table: string, column: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    table,
    column
  );
  return Number(rows[0]?.cnt || 0) > 0;
}

async function ensureIndex(name: string, sql: string) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  added ${name}`);
  } catch (e: any) {
    if (!/Duplicate|exists/i.test(String(e?.message || e))) throw e;
    console.log(`  ${name} already present`);
  }
}

async function main() {
  console.log('Ensuring journal_entries.transaction_date…');
  if (!(await columnExists('journal_entries', 'transaction_date'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE journal_entries ADD COLUMN transaction_date DATETIME(3) NULL`
    );
    console.log('  added journal_entries.transaction_date');
  }
  const entryUpdated = await prisma.$executeRawUnsafe(`
    UPDATE journal_entries
    SET transaction_date = COALESCE(transaction_date, entry_date, created_at, UTC_TIMESTAMP(3))
  `);
  console.log(`  backfilled ${entryUpdated} journal entr(y/ies)`);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE journal_entries
      MODIFY COLUMN transaction_date DATETIME(3) NOT NULL
  `);
  await ensureIndex(
    'journal_entries_transaction_date_idx',
    `CREATE INDEX journal_entries_transaction_date_idx ON journal_entries (transaction_date)`
  );

  console.log('Ensuring journal_lines date columns…');

  if (!(await columnExists('journal_lines', 'transaction_date'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE journal_lines ADD COLUMN transaction_date DATETIME(3) NULL`
    );
    console.log('  added transaction_date');
  }
  if (!(await columnExists('journal_lines', 'created_at'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE journal_lines
         ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`
    );
    console.log('  added created_at');
  }
  if (!(await columnExists('journal_lines', 'updated_at'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE journal_lines
         ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
         ON UPDATE CURRENT_TIMESTAMP(3)`
    );
    console.log('  added updated_at');
  }

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE journal_lines jl
    INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
    SET
      jl.transaction_date = COALESCE(
        jl.transaction_date,
        je.transaction_date,
        je.entry_date,
        je.created_at,
        UTC_TIMESTAMP(3)
      ),
      jl.created_at = COALESCE(NULLIF(jl.created_at, '0000-00-00 00:00:00'), je.created_at, UTC_TIMESTAMP(3)),
      jl.updated_at = COALESCE(NULLIF(jl.updated_at, '0000-00-00 00:00:00'), je.updated_at, je.created_at, UTC_TIMESTAMP(3))
  `);
  console.log(`  backfilled ${updated} journal line(s) from parent entries`);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE journal_lines
      MODIFY COLUMN transaction_date DATETIME(3) NOT NULL
  `);

  await ensureIndex(
    'journal_lines_transaction_date_idx',
    `CREATE INDEX journal_lines_transaction_date_idx ON journal_lines (transaction_date)`
  );

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
