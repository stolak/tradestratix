/**
 * Smoke tests for journal entity attribution + default account resolver.
 * Run: npm run test:journal-entities
 */
import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../src/utils/prisma.js';
import {
  createJournal,
  reverseJournal,
  requireDefaultAccountIds,
  resolveDefaultAccounts,
  partnerLineBalances
} from '../src/services/accounting.service.js';
import type { AuthUser } from '../src/types/express/index.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

async function main() {
  console.log('Journal entity attribution tests\n');

  const business = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!business) throw new Error('No business — run seed first');

  const userRow = await prisma.user.findFirst({
    where: { businessId: business.id, role: 'business_owner' }
  });
  if (!userRow) throw new Error('No business_owner user');

  const branch = await prisma.branch.findFirst({
    where: { businessId: business.id, isActive: true }
  });
  const customer = await prisma.customer.findFirst({
    where: {
      businessId: business.id,
      customerType: { not: 'walk_in' },
      OR: [{ code: null }, { code: { not: 'WALK-IN' } }]
    }
  });
  const supplier = await prisma.supplier.findFirst({ where: { businessId: business.id } });
  const salesRep = await prisma.salesRep.findFirst({ where: { businessId: business.id } });
  const cash = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'cash' }
  });
  const revenue = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'sales_revenue' }
  });
  const ar = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'accounts_receivable' }
  });
  const ap = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'accounts_payable' }
  });
  const inventory = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'inventory' }
  });

  if (!branch || !customer || !supplier || !cash || !revenue || !ar || !ap || !inventory) {
    throw new Error('Missing seed data for accounts / partners');
  }

  const user: AuthUser = {
    id: userRow.id,
    businessId: business.id,
    username: userRow.username,
    fullName: userRow.fullName,
    role: userRow.role,
    permissions: ['accounting.post', 'accounting.view', 'accounting.reverse'],
    activeBranchId: branch.id,
    branchIds: [branch.id]
  };

  // 1. Default account resolver
  console.log('Default account resolver');
  const map = await requireDefaultAccountIds(business.id, [
    'cash',
    'sales_revenue',
    'accounts_receivable'
  ]);
  assert(Boolean(map.cash && map.sales_revenue && map.accounts_receivable), 'resolves required keys');

  let missingThrew = false;
  try {
    await resolveDefaultAccounts(business.id, ['__missing_key__']);
  } catch (e: any) {
    missingThrew =
      e?.status === 400 || String(e?.message || '').toLowerCase().includes('incomplete');
  }
  assert(missingThrew, 'throws when required mapping missing');

  // 2. Customer + rep attribution on sale-like journal
  console.log('\nCustomer / sales rep attribution');
  const saleKey = `test_sale_attr:${Date.now()}`;
  const saleJe = (await createJournal(user, {
    memo: 'Test customer sale attribution',
    branch_id: branch.id,
    customer_id: customer.id,
    sales_representative_id: salesRep?.id || undefined,
    source_type: 'test_sale',
    source_id: saleKey,
    idempotency_key: saleKey,
    post: true,
    lines: [
      { account_id: ar.accountId, debit: 100, description: 'AR' },
      { account_id: revenue.accountId, credit: 100, description: 'Revenue' }
    ]
  })) as any;
  assert(saleJe.customer_id === customer.id, 'sale journal has customer_id');
  if (salesRep) {
    assert(saleJe.sales_representative_id === salesRep.id, 'sale journal has sales_representative_id');
  } else {
    assert(saleJe.sales_representative_id == null, 'sale journal rep null when no seed rep');
  }
  assert(!saleJe.supplier_id, 'sale journal supplier remains null');
  const saleArLine = (saleJe.lines || []).find((l: any) => l.account_id === ar.accountId);
  const saleRevLine = (saleJe.lines || []).find((l: any) => l.account_id === revenue.accountId);
  assert(saleArLine?.customer_id === customer.id, 'AR line stamped with customer_id');
  assert(!saleRevLine?.customer_id, 'revenue line has no customer_id');

  // 3. Idempotency
  const again = (await createJournal(user, {
    memo: 'dup',
    branch_id: branch.id,
    customer_id: customer.id,
    source_type: 'test_sale',
    source_id: saleKey,
    idempotency_key: saleKey,
    post: true,
    lines: [
      { account_id: ar.accountId, debit: 100 },
      { account_id: revenue.accountId, credit: 100 }
    ]
  })) as any;
  assert(again.id === saleJe.id, 'idempotent re-post returns same journal');

  // 4. Supplier attribution
  console.log('\nSupplier attribution');
  const grnKey = `test_grn_attr:${Date.now()}`;
  const grnJe = (await createJournal(user, {
    memo: 'Test supplier GRN attribution',
    branch_id: branch.id,
    supplier_id: supplier.id,
    source_type: 'test_grn',
    source_id: grnKey,
    idempotency_key: grnKey,
    post: true,
    lines: [
      { account_id: inventory.accountId, debit: 50, description: 'Inventory' },
      { account_id: ap.accountId, credit: 50, description: 'AP' }
    ]
  })) as any;
  assert(grnJe.supplier_id === supplier.id, 'GRN journal has supplier_id');
  assert(!grnJe.customer_id, 'GRN journal customer remains null');
  const grnApLine = (grnJe.lines || []).find((l: any) => l.account_id === ap.accountId);
  const grnInvLine = (grnJe.lines || []).find((l: any) => l.account_id === inventory.accountId);
  assert(grnApLine?.supplier_id === supplier.id, 'AP line stamped with supplier_id');
  assert(!grnInvLine?.supplier_id, 'inventory line has no supplier_id');

  // 5. Cross-business entity rejection
  console.log('\nValidation');
  let crossRejected = false;
  try {
    await createJournal(user, {
      memo: 'bad customer',
      branch_id: branch.id,
      customer_id: 'cus-does-not-exist',
      post: true,
      lines: [
        { account_id: cash.accountId, debit: 10 },
        { account_id: revenue.accountId, credit: 10 }
      ]
    });
  } catch (e: any) {
    crossRejected = String(e?.message || '').toLowerCase().includes('customer');
  }
  assert(crossRejected, 'rejects invalid customer_id');

  // 6. Unbalanced rejection
  let unbalanced = false;
  try {
    await createJournal(user, {
      memo: 'unbalanced',
      branch_id: branch.id,
      post: true,
      lines: [
        { account_id: cash.accountId, debit: 10 },
        { account_id: revenue.accountId, credit: 5 }
      ]
    });
  } catch (e: any) {
    unbalanced = String(e?.message || '').toLowerCase().includes('unbalanced');
  }
  assert(unbalanced, 'rejects unbalanced journal');

  // 7. Reversal retains entity refs
  console.log('\nReversal retains attribution');
  const rev = (await reverseJournal(user, saleJe.id, 'Test reverse')) as any;
  assert(rev.customer_id === customer.id, 'reversal keeps customer_id');
  if (salesRep) {
    assert(rev.sales_representative_id === salesRep.id, 'reversal keeps sales_representative_id');
  }
  const revArLine = (rev.lines || []).find((l: any) => l.account_id === ar.accountId);
  assert(revArLine?.customer_id === customer.id, 'reversal AR line keeps customer_id');

  // 7b. Line-based partner balance (AR stamp present)
  const balMap = await partnerLineBalances(business.id, 'customer', customer.id);
  assert(typeof balMap.get(customer.id) === 'number', 'partnerLineBalances returns customer balance');

  // 8. Nullable entity journals still allowed (rent-like)
  console.log('\nNullable entity journals');
  const rentKey = `test_rent:${Date.now()}`;
  const expenseSetting = await prisma.defaultAccountSetting.findFirst({
    where: { businessId: business.id, settingKey: 'expense' }
  });
  if (expenseSetting) {
    const rent = (await createJournal(user, {
      memo: 'Rent — no partner',
      branch_id: branch.id,
      source_type: 'test_rent',
      source_id: rentKey,
      idempotency_key: rentKey,
      post: true,
      lines: [
        { account_id: expenseSetting.accountId, debit: 20 },
        { account_id: cash.accountId, credit: 20 }
      ]
    })) as any;
    assert(!rent.customer_id && !rent.supplier_id, 'non-partner journal leaves entities null');
  } else {
    assert(true, 'skip rent test (no expense mapping)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
