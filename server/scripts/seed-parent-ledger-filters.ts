/**
 * Ensure CoA filter subgroups exist, reparent leaves, and upsert
 * DefaultParentAccountSetting for every business.
 *
 * Run: npm --prefix server run seed:parent-filters
 *   or: npx tsx scripts/seed-parent-ledger-filters.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;

type CoaNode = {
  code: string;
  name: string;
  accountType: string;
  parentCode?: string | null;
};

/** Group headers required for useful ledger filters (safe to upsert on existing DBs). */
const FILTER_GROUPS: CoaNode[] = [
  { code: '1105', name: 'Cash & Bank', accountType: 'asset', parentCode: '1100' },
  { code: '1129', name: 'Receivables & Advances', accountType: 'asset', parentCode: '1100' },
  { code: '1138', name: 'Inventory', accountType: 'asset', parentCode: '1100' },
  { code: '2090', name: 'Trade Payables', accountType: 'liability', parentCode: '2000' },
  { code: '2050', name: 'Payroll Liabilities', accountType: 'liability', parentCode: '2000' },
  { code: '6050', name: 'Payroll Expenses', accountType: 'expense', parentCode: '6000' }
];

/** Move existing posting accounts under the filter groups. */
const REPARENT: { code: string; parentCode: string }[] = [
  { code: '1110', parentCode: '1105' },
  { code: '1115', parentCode: '1105' },
  { code: '1120', parentCode: '1105' },
  { code: '1125', parentCode: '1105' },
  { code: '1128', parentCode: '1105' },
  { code: '1130', parentCode: '1129' },
  { code: '1132', parentCode: '1129' },
  { code: '1134', parentCode: '1129' },
  { code: '1135', parentCode: '1129' },
  { code: '1136', parentCode: '1129' },
  { code: '1140', parentCode: '1138' },
  { code: '1145', parentCode: '1138' },
  { code: '1150', parentCode: '1138' },
  { code: '2100', parentCode: '2090' },
  { code: '2110', parentCode: '2090' },
  { code: '2120', parentCode: '2090' },
  { code: '2125', parentCode: '2090' },
  { code: '2130', parentCode: '2090' },
  { code: '2140', parentCode: '2090' },
  { code: '2300', parentCode: '2050' },
  { code: '2400', parentCode: '2050' },
  { code: '2500', parentCode: '2050' },
  { code: '6100', parentCode: '6050' },
  { code: '6150', parentCode: '6050' }
];

const PARENT_FILTERS: { key: string; code: string; description: string }[] = [
  { key: 'cash_ledgers', code: '1105', description: 'Cash & bank subtree for cash pickers' },
  { key: 'bank_ledgers', code: '1105', description: 'Cash & bank subtree for bank pickers' },
  { key: 'receivable_ledgers', code: '1129', description: 'Receivables & advances subtree' },
  { key: 'payable_ledgers', code: '2090', description: 'Trade payables subtree' },
  { key: 'inventory_ledgers', code: '1138', description: 'Inventory subtree' },
  { key: 'fixed_asset_ledgers', code: '1200', description: 'Fixed assets group' },
  { key: 'revenue_ledgers', code: '4000', description: 'Revenue root' },
  { key: 'cogs_ledgers', code: '5000', description: 'COGS root' },
  { key: 'expense_ledgers', code: '6000', description: 'Operating expenses root' },
  { key: 'liability_ledgers', code: '2000', description: 'Liabilities root' },
  { key: 'equity_ledgers', code: '3000', description: 'Equity root' },
  { key: 'payroll_expense_ledgers', code: '6050', description: 'Payroll expense subgroup' },
  { key: 'payroll_liability_ledgers', code: '2050', description: 'Payroll liability subgroup' }
];

async function ensureAccount(
  businessId: string,
  byCode: Map<string, { id: string; parentId: string | null }>,
  node: CoaNode
) {
  let row = byCode.get(node.code);
  if (!row) {
    const created = await prisma.account.create({
      data: {
        id: id('acc'),
        businessId,
        code: node.code,
        name: node.name,
        accountType: node.accountType,
        parentId: null,
        isSystem: true
      }
    });
    row = { id: created.id, parentId: created.parentId };
    byCode.set(node.code, row);
    console.log(`  + created ${node.code} ${node.name}`);
  } else {
    await prisma.account.update({
      where: { id: row.id },
      data: { name: node.name, accountType: node.accountType }
    });
  }
  return row;
}

async function seedBusiness(businessId: string, businessName: string) {
  console.log(`\nBusiness: ${businessName} (${businessId})`);

  const existing = await prisma.account.findMany({
    where: { businessId },
    select: { id: true, code: true, parentId: true }
  });
  const byCode = new Map(existing.map((a) => [a.code, { id: a.id, parentId: a.parentId }]));

  // Ensure roots used as parents exist (skip if CoA not seeded yet)
  const neededRoots = ['1100', '2000', '6000', '1200', '4000', '5000', '3000'];
  const missingRoot = neededRoots.filter((c) => !byCode.has(c));
  if (missingRoot.length) {
    console.log(`  skip — missing root accounts: ${missingRoot.join(', ')} (run full seed first)`);
    return { mapped: 0, skipped: true };
  }

  for (const g of FILTER_GROUPS) {
    await ensureAccount(businessId, byCode, g);
  }

  // Apply parent links for groups
  for (const g of FILTER_GROUPS) {
    const row = byCode.get(g.code);
    const parent = g.parentCode ? byCode.get(g.parentCode) : null;
    if (!row) continue;
    const nextParentId = parent?.id ?? null;
    if (row.parentId !== nextParentId) {
      await prisma.account.update({
        where: { id: row.id },
        data: { parentId: nextParentId }
      });
      row.parentId = nextParentId;
      console.log(`  ~ ${g.code} parent → ${g.parentCode || 'null'}`);
    }
  }

  // Reparent leaves under filter groups
  for (const r of REPARENT) {
    const row = byCode.get(r.code);
    const parent = byCode.get(r.parentCode);
    if (!row || !parent) continue;
    if (row.parentId !== parent.id) {
      await prisma.account.update({
        where: { id: row.id },
        data: { parentId: parent.id }
      });
      row.parentId = parent.id;
      console.log(`  ~ ${r.code} → under ${r.parentCode}`);
    }
  }

  let mapped = 0;
  for (const pf of PARENT_FILTERS) {
    const parent = byCode.get(pf.code);
    if (!parent) {
      console.log(`  ! skip filter ${pf.key} — missing account ${pf.code}`);
      continue;
    }
    await prisma.defaultParentAccountSetting.upsert({
      where: {
        businessId_settingKey: { businessId, settingKey: pf.key }
      },
      create: {
        id: id('dpas'),
        businessId,
        settingKey: pf.key,
        parentAccountId: parent.id,
        description: pf.description
      },
      update: {
        parentAccountId: parent.id,
        description: pf.description
      }
    });
    mapped += 1;
  }
  console.log(`  ✓ ${mapped} ledger filters mapped`);
  return { mapped, skipped: false };
}

async function main() {
  console.log('Seeding parent ledger filters…');
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!businesses.length) {
    console.log('No businesses found.');
    return;
  }

  let total = 0;
  for (const b of businesses) {
    const result = await seedBusiness(b.id, b.name);
    if (!result.skipped) total += result.mapped;
  }
  console.log(`\nDone. Upserted ${total} filter mapping(s) across ${businesses.length} business(es).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
