import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const PERMS = [
  { code: 'assets.transfer.view', name: 'View asset transfers', module: 'assets', action: 'transfer.view' },
  { code: 'assets.transfer.create', name: 'Create asset transfers', module: 'assets', action: 'transfer.create' },
  { code: 'assets.transfer.approve', name: 'Approve asset transfers', module: 'assets', action: 'transfer.approve' },
  { code: 'assets.transfer.dispatch', name: 'Dispatch asset transfers', module: 'assets', action: 'transfer.dispatch' },
  { code: 'assets.transfer.receive', name: 'Receive asset transfers', module: 'assets', action: 'transfer.receive' },
  { code: 'assets.maintenance.view', name: 'View asset maintenance', module: 'assets', action: 'maintenance.view' },
  { code: 'assets.maintenance.create', name: 'Create maintenance requests', module: 'assets', action: 'maintenance.create' },
  { code: 'assets.maintenance.manage', name: 'Manage work orders', module: 'assets', action: 'maintenance.manage' },
  { code: 'assets.maintenance.approve', name: 'Approve maintenance', module: 'assets', action: 'maintenance.approve' }
];

async function main() {
  const permIds: string[] = [];
  for (const p of PERMS) {
    let row = await prisma.permission.findUnique({ where: { code: p.code } });
    if (!row) {
      row = await prisma.permission.create({
        data: {
          id: `perm-${uuidv4().slice(0, 8)}`,
          code: p.code,
          name: p.name,
          module: p.module,
          action: p.action,
          description: p.name,
          sortOrder: 0
        }
      });
      console.log('created', p.code);
    } else {
      console.log('exists', p.code);
    }
    permIds.push(row.id);
  }

  const roles = await prisma.role.findMany({
    where: {
      code: {
        in: [
          'business_owner',
          'managing_director',
          'accountant',
          'finance_manager',
          'branch_manager',
          'warehouse_manager'
        ]
      }
    }
  });
  for (const role of roles) {
    for (const permissionId of permIds) {
      const existing = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId }
      });
      if (existing) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId } });
    }
    console.log('granted to', role.code);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
