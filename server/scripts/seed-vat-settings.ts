/**
 * Ensure vat_rate_percent business setting and backfill product.vatRate when still 0.
 *
 * Run: npm --prefix server run seed:vat
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;
const DEFAULT_VAT = '7.5';

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true, name: true } });
  for (const b of businesses) {
    await prisma.businessSetting.upsert({
      where: {
        businessId_settingKey: { businessId: b.id, settingKey: 'vat_rate_percent' }
      },
      create: {
        id: id('bst'),
        businessId: b.id,
        settingKey: 'vat_rate_percent',
        value: DEFAULT_VAT
      },
      update: {}
    });
    const updated = await prisma.product.updateMany({
      where: { businessId: b.id, vatRate: 0 },
      data: { vatRate: Number(DEFAULT_VAT) }
    });
    console.log(`${b.name}: vat setting ok; products backfilled=${updated.count}`);
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
