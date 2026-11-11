import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function trySql(sql: string) {
  try {
    await p.$executeRawUnsafe(sql);
    console.log('OK:', sql.slice(0, 80));
  } catch (e: any) {
    console.log('SKIP:', e?.message?.slice(0, 120) || e);
  }
}

async function main() {
  await trySql('ALTER TABLE user_branches ADD COLUMN business_id VARCHAR(191) NULL');
  await trySql('ALTER TABLE user_branches ADD COLUMN role_code VARCHAR(191) NULL');
  await trySql(
    "ALTER TABLE user_branches ADD COLUMN status VARCHAR(191) NOT NULL DEFAULT 'active'"
  );
  await trySql(
    'ALTER TABLE user_branches ADD COLUMN assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)'
  );
  await trySql('ALTER TABLE user_branches ADD COLUMN assigned_by_id VARCHAR(191) NULL');
  await trySql(`
    UPDATE user_branches ub
    JOIN users u ON u.id = ub.user_id
    SET ub.business_id = u.business_id
    WHERE ub.business_id IS NULL
  `);
  await trySql('ALTER TABLE user_branches MODIFY business_id VARCHAR(191) NOT NULL');
  await trySql(
    'CREATE INDEX user_branches_business_id_user_id_idx ON user_branches(business_id, user_id)'
  );
  await trySql(
    'CREATE INDEX user_branches_branch_id_status_idx ON user_branches(branch_id, status)'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
