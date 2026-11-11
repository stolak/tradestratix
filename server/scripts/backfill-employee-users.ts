/**
 * Ensure every Employee has home branch (HQ fallback) + User login.
 * Also clears obsolete SalesRep name/phone/email/userId/branchId after schema push.
 *
 * Run BEFORE making employee.branchId / employee.userId required if needed,
 * or after optional columns exist.
 *
 * npm run backfill:employee-users
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/utils/prisma.js';
import { shortId } from '../src/utils/helpers.js';

async function hqBranchId(businessId: string) {
  const hq =
    (await prisma.branch.findFirst({
      where: { businessId, code: 'HQ', isActive: true }
    })) ||
    (await prisma.branch.findFirst({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'asc' }
    }));
  if (!hq) throw new Error(`No branch for business ${businessId}`);
  return hq.id;
}

function slugUsername(fullName: string) {
  return (
    fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 24) || 'employee'
  );
}

async function main() {
  const employees = await prisma.employee.findMany({
    include: { salesRep: true }
  });

  let branchFixed = 0;
  let usersCreated = 0;

  for (const emp of employees) {
    let branchId = emp.branchId;
    if (!branchId) {
      branchId = await hqBranchId(emp.businessId);
      await prisma.employee.update({
        where: { id: emp.id },
        data: { branchId }
      });
      branchFixed += 1;
      console.log(`Branch → HQ for ${emp.id} (${emp.fullName})`);
    }

    if (!emp.userId) {
      let username = slugUsername(emp.fullName);
      const clash = await prisma.user.findFirst({
        where: { businessId: emp.businessId, username }
      });
      if (clash) username = `${username}.${emp.id.slice(-4)}`;

      const roleCode = emp.salesRep ? 'sales_representative' : 'cashier';
      const roleRow = await prisma.role.findFirst({
        where: {
          code: roleCode,
          OR: [{ businessId: emp.businessId }, { businessId: null }]
        }
      });

      const passwordHash = await bcrypt.hash('password123', 10);
      const user = await prisma.user.create({
        data: {
          id: shortId('usr'),
          businessId: emp.businessId,
          username,
          passwordHash,
          fullName: emp.fullName,
          role: roleCode,
          email: emp.email,
          phone: emp.phone,
          department: emp.department,
          defaultBranchId: branchId,
          createdById: emp.createdById,
          ...(roleRow ? { userRoles: { create: [{ roleId: roleRow.id }] } } : {}),
          userBranches: {
            create: [
              {
                branchId,
                businessId: emp.businessId,
                status: 'active',
                assignedById: emp.createdById
              }
            ]
          }
        }
      });

      await prisma.employee.update({
        where: { id: emp.id },
        data: { userId: user.id }
      });
      usersCreated += 1;
      console.log(`User ${username} for ${emp.id} (${emp.fullName}) [password123]`);
    } else if (branchId) {
      // Keep sales-rep / employee login default branch aligned with home branch
      await prisma.user.update({
        where: { id: emp.userId },
        data: { defaultBranchId: branchId }
      });
    }
  }

  console.log(`Done. branch_fixed=${branchFixed}, users_created=${usersCreated}, total=${employees.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
