/**
 * SalesRep ↔ Employee linkage tests.
 * Run: npm run test:sales-rep-employees
 */
import { prisma } from '../src/utils/prisma.js';
import * as salesRepService from '../src/services/sales-rep.service.js';
import type { AuthUser } from '../src/types/express/index.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

async function main() {
  console.log('\nSalesRep ↔ Employee linkage tests\n');

  const business = await prisma.business.findFirst();
  if (!business) throw new Error('No business — run seed first');
  const owner = await prisma.user.findFirst({
    where: { businessId: business.id },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) throw new Error('No user');

  const membership = await prisma.userBranch.findFirst({
    where: { userId: owner.id, businessId: business.id, status: 'active' }
  });

  const user: AuthUser = {
    id: owner.id,
    businessId: business.id,
    username: owner.username,
    fullName: owner.fullName || owner.username,
    role: 'owner',
    defaultBranchId: owner.defaultBranchId,
    activeBranchId: membership?.branchId || owner.defaultBranchId,
    branchIds: membership ? [membership.branchId] : owner.defaultBranchId ? [owner.defaultBranchId] : []
  };

  console.log('Create sales rep auto-creates employee');
  const suffix = Date.now().toString(36).slice(-6);
  const created = await salesRepService.createSalesRep(user, {
    name: `Test Rep ${suffix}`,
    code: `TR-${suffix}`,
    commission_percent: 3
  });
  assert(!!created.employee_id, 'sales rep has employee_id');
  assert(created.employee?.full_name === created.name, 'employee name matches rep');

  const emp = await prisma.employee.findUnique({ where: { id: created.employee_id } });
  assert(!!emp, 'employee row exists');
  assert(emp?.jobTitle === 'Sales Representative', 'auto employee job title');

  console.log('\nLink existing employee as sales rep');
  const plainEmp = await prisma.employee.create({
    data: {
      id: `emp-test-${suffix}`,
      businessId: business.id,
      branchId: user.activeBranchId || null,
      code: `EMP-T-${suffix}`,
      fullName: `Plain Emp ${suffix}`,
      department: 'Sales',
      jobTitle: 'Account Manager',
      status: 'active',
      createdById: user.id
    }
  });
  const linked = await salesRepService.createSalesRep(user, {
    employee_id: plainEmp.id,
    commission_percent: 4
  });
  assert(linked.employee_id === plainEmp.id, 'linked to provided employee');
  assert(linked.name === plainEmp.fullName, 'name taken from employee');

  console.log('\nReject double-link');
  let rejected = false;
  try {
    await salesRepService.createSalesRep(user, {
      employee_id: plainEmp.id,
      commission_percent: 1
    });
  } catch (e: any) {
    rejected = String(e.message || '').toLowerCase().includes('already linked');
  }
  assert(rejected, 'cannot link same employee twice');

  console.log('\nExisting seeded reps');
  const reps = await prisma.salesRep.findMany({
    where: { businessId: business.id },
    select: { id: true, employeeId: true }
  });
  assert(reps.length > 0, 'business has sales reps');
  assert(
    reps.every((r) => !!r.employeeId),
    'every sales rep has employee_id'
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
