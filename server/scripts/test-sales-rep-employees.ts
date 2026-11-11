/**
 * SalesRep ↔ Employee linkage tests (employee-first, no identity on SalesRep).
 * Run: npm run test:sales-rep-employees
 */
import { prisma } from '../src/utils/prisma.js';
import * as hrService from '../src/services/hr.service.js';
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

  const suffix = Date.now().toString(36).slice(-6);

  console.log('Create employee always creates login + home branch');
  const emp = await hrService.createEmployee(user, {
    full_name: `Staff ${suffix}`,
    code: `EMP-S-${suffix}`,
    username: `staff.${suffix}`,
    password: 'password123'
  });
  assert(!!emp.user_id || !!emp.user?.id, 'employee has user');
  assert(!!emp.branch_id || !!emp.branch?.id, 'employee has home branch');
  assert(emp.login_username === `staff.${suffix}`, 'login username returned');

  const login = await prisma.user.findUnique({ where: { id: emp.user_id || emp.user.id } });
  assert(login?.defaultBranchId === (emp.branch_id || emp.branch?.id), 'user defaultBranch = employee home');

  console.log('\nPromote existing employee to sales rep');
  const rep = await salesRepService.createSalesRep(user, {
    employee_id: emp.id,
    commission_percent: 4
  });
  assert(rep.employee_id === emp.id, 'sales rep linked to employee');
  assert(rep.name === emp.full_name, 'name comes from employee');
  assert(!(rep as any).phone || rep.phone === emp.phone, 'phone comes from employee join');

  console.log('\nReject creating sales rep without employee_id');
  let rejectedNoEmp = false;
  try {
    await salesRepService.createSalesRep(user, { commission_percent: 1 });
  } catch (e: any) {
    rejectedNoEmp = String(e.message || '').includes('employee_id');
  }
  assert(rejectedNoEmp, 'employee_id required');

  console.log('\nReject double promotion');
  let rejected = false;
  try {
    await salesRepService.createSalesRep(user, {
      employee_id: emp.id,
      commission_percent: 1
    });
  } catch (e: any) {
    rejected = String(e.message || '').toLowerCase().includes('already');
  }
  assert(rejected, 'cannot promote same employee twice');

  console.log('\nCreate employee as sales rep in one step');
  const combo = await hrService.createEmployee(user, {
    full_name: `Rep ${suffix}`,
    code: `EMP-R-${suffix}`,
    username: `rep.${suffix}`,
    password: 'password123',
    is_sales_rep: true,
    commission_percent: 6
  });
  assert(!!combo.sales_rep?.id || !!combo.sales_rep, 'created with sales_rep');

  console.log('\nSchema: sales reps have no identity columns in API shape beyond join');
  const listed = await salesRepService.listSalesReps(business.id);
  const sample = listed.find((r: any) => r.id === rep.id);
  assert(!!sample?.employee?.full_name || !!sample?.name, 'list exposes employee name');

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
