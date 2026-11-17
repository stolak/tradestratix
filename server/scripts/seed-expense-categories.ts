/**
 * Seed common ExpenseCategory rows for every business (idempotent by name).
 *
 * Run: npm --prefix server run seed:expense-categories
 *   or: npx tsx scripts/seed-expense-categories.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;

const CATEGORIES: {
  name: string;
  code: string;
  accountCode: string;
  sortOrder: number;
  description?: string;
}[] = [
  {
    name: 'Rent',
    code: 'RENT',
    accountCode: '6200',
    sortOrder: 10,
    description: 'Facility rent and leases'
  },
  {
    name: 'Payroll',
    code: 'PAY',
    accountCode: '6100',
    sortOrder: 20,
    description: 'Salaries and wages'
  },
  {
    name: 'Commissions',
    code: 'COMM',
    accountCode: '6150',
    sortOrder: 30,
    description: 'Sales rep commissions'
  },
  {
    name: 'Depreciation',
    code: 'DEP',
    accountCode: '6300',
    sortOrder: 40,
    description: 'Asset depreciation'
  },
  {
    name: 'General',
    code: 'GEN',
    accountCode: '6400',
    sortOrder: 50,
    description: 'General operating expenses'
  },
  {
    name: 'Inventory adjustment',
    code: 'INVADJ',
    accountCode: '6500',
    sortOrder: 60,
    description: 'Inventory count adjustments'
  }
];

async function seedBusiness(businessId: string, businessName: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId },
    select: { id: true, code: true }
  });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const ec of CATEGORIES) {
    const accountId = byCode.get(ec.accountCode);
    if (!accountId) {
      skipped += 1;
      console.log(`  skip ${ec.name}: account ${ec.accountCode} missing`);
      continue;
    }

    const existing = await prisma.expenseCategory.findFirst({
      where: { businessId, name: ec.name }
    });

    if (existing) {
      await prisma.expenseCategory.update({
        where: { id: existing.id },
        data: {
          code: ec.code,
          accountId,
          sortOrder: ec.sortOrder,
          description: ec.description || null,
          isActive: true
        }
      });
      updated += 1;
    } else {
      await prisma.expenseCategory.create({
        data: {
          id: id('exc'),
          businessId,
          name: ec.name,
          code: ec.code,
          accountId,
          sortOrder: ec.sortOrder,
          description: ec.description || null,
          isActive: true
        }
      });
      created += 1;
    }
  }

  console.log(
    `  ${businessName}: created=${created} updated=${updated} skipped=${skipped}`
  );
}

async function main() {
  console.log('Seeding expense categories...');
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  });
  if (!businesses.length) {
    console.log('No businesses found.');
    return;
  }
  for (const b of businesses) {
    await seedBusiness(b.id, b.name);
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
