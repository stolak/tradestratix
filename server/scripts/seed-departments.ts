import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  const seedDepartments = [
    { code: 'HR', name: 'Human Resources', sortOrder: 1 },
    { code: 'FIN', name: 'Finance', sortOrder: 2 },
    { code: 'SAL', name: 'Sales', sortOrder: 3 },
    { code: 'OPS', name: 'Operations', sortOrder: 4 },
    { code: 'WH', name: 'Warehouse', sortOrder: 5 }
  ];

  for (const biz of businesses) {
    for (const dep of seedDepartments) {
      const existing = await prisma.department.findFirst({
        where: { businessId: biz.id, name: dep.name }
      });
      if (existing) continue;
      await prisma.department.create({
        data: {
          id: `dep-${randomUUID().slice(0, 8)}`,
          businessId: biz.id,
          code: dep.code,
          name: dep.name,
          sortOrder: dep.sortOrder,
          isActive: true
        }
      });
    }
  }
  console.log('departments_seeded', businesses.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
