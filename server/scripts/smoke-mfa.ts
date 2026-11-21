import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  DEMO_MFA_CODE,
  consumeMfaChallenge,
  startMfaChallenge,
  userRequiresMfa
} from '../src/services/mfa.service.js';

const prisma = new PrismaClient();

async function main() {
  const biz = await prisma.business.findFirst();
  if (!biz) throw new Error('no business');

  await prisma.businessSetting.upsert({
    where: {
      businessId_settingKey: { businessId: biz.id, settingKey: 'mfa_required_roles' }
    },
    create: {
      id: `bst-mfa-${Date.now().toString(36)}`,
      businessId: biz.id,
      settingKey: 'mfa_required_roles',
      value: JSON.stringify([
        'business_owner',
        'managing_director',
        'finance_manager',
        'accountant',
        'payroll_officer',
        'hr_manager',
        'auditor'
      ])
    },
    update: {}
  });

  const owner = await prisma.user.findFirst({ where: { username: 'owner' } });
  if (!owner) throw new Error('no owner user');

  const requires = await userRequiresMfa(owner.businessId, owner.id, owner.role);
  const challenge = await startMfaChallenge({
    businessId: owner.businessId,
    userId: owner.id,
    username: owner.username,
    email: owner.email
  });
  const verified = await consumeMfaChallenge(challenge.mfa_token, DEMO_MFA_CODE);

  console.log(
    JSON.stringify({
      requires,
      demo_code: challenge.demo_code,
      verified: verified.userId === owner.id
    })
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
