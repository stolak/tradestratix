/**
 * Link every SalesRep to an Employee (1:1).
 * Creates an Employee from the sales-rep profile when none is linked yet.
 *
 * Run: npx tsx scripts/backfill-sales-rep-employees.ts
 */
import { prisma } from '../src/utils/prisma.js';
import { shortId } from '../src/utils/helpers.js';

async function main() {
  const reps = await prisma.salesRep.findMany({
    orderBy: { createdAt: 'asc' }
  });

  let linked = 0;
  let created = 0;
  let skipped = 0;

  for (const rep of reps) {
    // After required migration, employeeId is always set; keep script idempotent for re-runs.
    if ((rep as { employeeId?: string | null }).employeeId) {
      skipped += 1;
      continue;
    }

    // Prefer existing employee with same user, code, or matching name in business
    let employee =
      (rep.userId
        ? await prisma.employee.findFirst({
            where: {
              businessId: rep.businessId,
              userId: rep.userId,
              salesRep: null
            }
          })
        : null) ||
      (rep.code
        ? await prisma.employee.findFirst({
            where: {
              businessId: rep.businessId,
              code: rep.code,
              salesRep: null
            }
          })
        : null) ||
      (await prisma.employee.findFirst({
        where: {
          businessId: rep.businessId,
          fullName: rep.name,
          salesRep: null
        }
      }));

    if (!employee) {
      const code =
        rep.code ||
        `REP-${rep.id.replace(/^rep-?/i, '').slice(0, 8).toUpperCase()}`;
      employee = await prisma.employee.create({
        data: {
          id: shortId('emp'),
          businessId: rep.businessId,
          branchId: rep.branchId,
          userId: rep.userId,
          code,
          fullName: rep.name,
          phone: rep.phone,
          email: rep.email,
          department: 'Sales',
          jobTitle: 'Sales Representative',
          status: rep.status === 'inactive' ? 'inactive' : 'active',
          createdById: rep.createdById
        }
      });
      created += 1;
    }

    await prisma.salesRep.update({
      where: { id: rep.id },
      data: {
        employeeId: employee.id,
        // Keep commercial profile aligned with HR record where blank
        userId: rep.userId || employee.userId,
        branchId: rep.branchId || employee.branchId,
        phone: rep.phone || employee.phone,
        email: rep.email || employee.email
      }
    });
    linked += 1;
    console.log(`Linked ${rep.id} (${rep.name}) → ${employee.id} (${employee.fullName})`);
  }

  console.log(
    `Done. linked=${linked}, employees_created=${created}, already_linked=${skipped}, total=${reps.length}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
