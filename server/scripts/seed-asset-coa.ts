/**
 * Ensure Phase 2 asset default-account CoA leaves + DefaultAccountSetting
 * mappings exist for every business (safe upsert).
 *
 * Run: npm --prefix server run seed:asset-coa
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (prefix: string) => `${prefix}-${uuidv4().slice(0, 8)}`;

type Leaf = {
  code: string;
  name: string;
  accountType: string;
  key: string;
  parentCode: string;
};

const ASSET_LEAVES: Leaf[] = [
  {
    code: '1215',
    name: 'Capital Work in Progress',
    accountType: 'asset',
    key: 'asset_cip',
    parentCode: '1200'
  },
  {
    code: '1230',
    name: 'Accumulated Impairment',
    accountType: 'asset',
    key: 'accumulated_impairment',
    parentCode: '1200'
  },
  {
    code: '2105',
    name: 'Asset Acquisition Payable',
    accountType: 'liability',
    key: 'asset_acquisition_payable',
    parentCode: '2090'
  },
  {
    code: '4300',
    name: 'Gain on Asset Disposal',
    accountType: 'revenue',
    key: 'asset_disposal_gain',
    parentCode: '4000'
  },
  {
    code: '6310',
    name: 'Impairment Loss',
    accountType: 'expense',
    key: 'impairment_expense',
    parentCode: '6000'
  },
  {
    code: '6320',
    name: 'Loss on Asset Disposal',
    accountType: 'expense',
    key: 'asset_disposal_loss',
    parentCode: '6000'
  },
  {
    code: '3205',
    name: 'Asset Revaluation Surplus',
    accountType: 'equity',
    key: 'asset_revaluation_surplus',
    parentCode: '3000'
  }
];

async function seedBusiness(businessId: string, businessName: string) {
  console.log(`\nBusiness: ${businessName}`);
  const existing = await prisma.account.findMany({
    where: { businessId },
    select: { id: true, code: true, parentId: true }
  });
  const byCode = new Map(existing.map((a) => [a.code, a]));

  let created = 0;
  let mapped = 0;

  for (const leaf of ASSET_LEAVES) {
    const parent = byCode.get(leaf.parentCode);
    if (!parent) {
      console.log(`  ! skip ${leaf.code} — missing parent ${leaf.parentCode}`);
      continue;
    }

    let acc = byCode.get(leaf.code);
    if (!acc) {
      const createdAcc = await prisma.account.create({
        data: {
          id: id('acc'),
          businessId,
          code: leaf.code,
          name: leaf.name,
          accountType: leaf.accountType,
          parentId: parent.id,
          isSystem: true
        }
      });
      acc = { id: createdAcc.id, code: createdAcc.code, parentId: createdAcc.parentId };
      byCode.set(leaf.code, acc);
      created += 1;
      console.log(`  + ${leaf.code} ${leaf.name}`);
    } else if (acc.parentId !== parent.id) {
      await prisma.account.update({
        where: { id: acc.id },
        data: { parentId: parent.id, name: leaf.name, accountType: leaf.accountType }
      });
      acc.parentId = parent.id;
      console.log(`  ~ ${leaf.code} reparented under ${leaf.parentCode}`);
    }

    await prisma.defaultAccountSetting.upsert({
      where: {
        businessId_settingKey: { businessId, settingKey: leaf.key }
      },
      create: {
        id: id('das'),
        businessId,
        settingKey: leaf.key,
        accountId: acc.id
      },
      update: { accountId: acc.id }
    });
    mapped += 1;
  }

  console.log(`  ✓ ${mapped} default keys mapped (${created} accounts created)`);
  return { created, mapped };
}

async function main() {
  console.log('Seeding asset CoA defaults…');
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!businesses.length) {
    console.log('No businesses found.');
    return;
  }

  let totalMapped = 0;
  for (const b of businesses) {
    const r = await seedBusiness(b.id, b.name);
    totalMapped += r.mapped;
  }
  console.log(`\nDone. ${totalMapped} mapping(s) across ${businesses.length} business(es).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
