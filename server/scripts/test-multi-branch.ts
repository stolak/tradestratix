/**
 * Automated multi-branch rule checks.
 * Run: npx tsx scripts/test-multi-branch.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const id = (p: string) => `${p}-${uuidv4().slice(0, 8)}`;
const API = `http://127.0.0.1:${process.env.PORT || 5009}/api/v1`;

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

async function api(
  path: string,
  opts: { method?: string; token?: string; branchId?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.branchId) headers['X-Branch-Id'] = opts.branchId;
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('Multi-branch tests\n');

  // 1) New company gets default branch
  console.log('1. Default branch on company');
  const bizId = id('biz');
  await prisma.business.create({
    data: { id: bizId, name: `Branch Test Co ${bizId}`, businessType: 'hybrid' }
  });
  // simulate ensureDefaultBranch
  const { ensureDefaultBranch, ensureUserMembership, countActiveBranches } = await import(
    '../src/services/branch-access.service.js'
  );
  const def = await ensureDefaultBranch(bizId);
  assert(!!def?.id, 'ensureDefaultBranch creates/returns a branch');
  assert((await countActiveBranches(bizId)) >= 1, 'company has at least one active branch');

  // 2) Cannot leave without active branch
  console.log('2. Cannot deactivate last active branch');
  const { deactivateBranch } = await import('../src/services/branch.service.js');
  const ownerHash = await bcrypt.hash('password123', 8);
  const ownerId = id('usr');
  await prisma.user.create({
    data: {
      id: ownerId,
      businessId: bizId,
      username: `owner_${ownerId.slice(-6)}`,
      passwordHash: ownerHash,
      fullName: 'Test Owner',
      role: 'business_owner',
      defaultBranchId: def.id,
      userBranches: {
        create: [{ businessId: bizId, branchId: def.id, status: 'active', roleCode: 'business_owner' }]
      }
    }
  });
  const fakeUser = {
    id: ownerId,
    businessId: bizId,
    username: 'x',
    fullName: 'x',
    role: 'business_owner',
    defaultBranchId: def.id,
    activeBranchId: def.id,
    branchIds: [def.id],
    permissions: [] as string[]
  };
  let blocked = false;
  try {
    await deactivateBranch(fakeUser as any, def.id);
  } catch (e: any) {
    blocked = e?.status === 409;
  }
  assert(blocked, 'deactivating only active branch is rejected');

  // 3) Multi membership
  console.log('3. Multi-branch membership');
  const br2 = await prisma.branch.create({
    data: { id: id('br'), businessId: bizId, name: 'Second', code: 'B2' }
  });
  await ensureUserMembership(bizId, ownerId, br2.id, ownerId);
  const mems = await prisma.userBranch.count({
    where: { userId: ownerId, status: 'active' }
  });
  assert(mems >= 2, 'user can belong to multiple branches');

  // API tests (require running server)
  console.log('4. API switch / isolation (requires API on PORT)');
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'owner', password: 'password123' }
  });
  if (login.status !== 200) {
    console.log('  ! Skipping API tests — login failed (is the server running?)');
  } else {
    const token = login.data.token as string;
    const branches = (login.data.branches || []) as any[];
    assert(Array.isArray(branches) && branches.length >= 1, 'login returns authorised branches');
    assert(!!login.data.active_branch_id, 'login returns active_branch_id');

    const hq = branches.find((b) => b.code === 'HQ') || branches[0];
    const other = branches.find((b) => b.id !== hq.id);

    if (other) {
      const sw = await api('/auth/switch-branch', {
        method: 'POST',
        token,
        branchId: hq.id,
        body: { branch_id: other.id }
      });
      assert(sw.status === 200 && sw.data.active_branch_id === other.id, 'can switch to authorised branch');
      const token2 = sw.data.token as string;

      // Create a limited user with only HQ membership
      const limUser = id('usr');
      const limName = `lim_${limUser.slice(-6)}`;
      await prisma.user.create({
        data: {
          id: limUser,
          businessId: login.data.user.business_id || login.data.business?.id,
          username: limName,
          passwordHash: ownerHash,
          fullName: 'Limited',
          role: 'cashier',
          defaultBranchId: hq.id,
          userBranches: {
            create: [
              {
                businessId: login.data.business?.id || login.data.user.business_id,
                branchId: hq.id,
                status: 'active'
              }
            ]
          }
        }
      });
      // Grant cashier some view? business_owner path — use cashier without permissions; login still works
      // Actually cashier needs auth - login works. Switch to other should 403.
      const limLogin = await api('/auth/login', {
        method: 'POST',
        body: { username: limName, password: 'password123' }
      });
      if (limLogin.status === 200) {
        const bad = await api('/auth/switch-branch', {
          method: 'POST',
          token: limLogin.data.token,
          body: { branch_id: other.id }
        });
        assert(bad.status === 403, 'cannot switch to unauthorised branch');

        // Manipulate header to other branch on a list endpoint
        const sneak = await api('/sales/invoices', {
          token: limLogin.data.token,
          branchId: other.id
        });
        assert(sneak.status === 403, 'API rejects unauthorised X-Branch-Id');

        // Revoke membership
        await prisma.userBranch.update({
          where: { userId_branchId: { userId: limUser, branchId: hq.id } },
          data: { status: 'revoked' }
        });
        const afterRevoke = await api('/auth/me', { token: limLogin.data.token, branchId: hq.id });
        assert(afterRevoke.status === 403, 'revoked membership denies further access');
      } else {
        console.log('  ! limited user login failed — skip isolation asserts');
      }

      void token2;
    } else {
      console.log('  ! Only one demo branch — seed BR2 for fuller switch tests');
    }

    // Transaction gets branch
    const me = await api('/auth/me', { token });
    const active = me.data.active_branch_id || login.data.active_branch_id;
    const journals = await api('/accounting/journals', { token, branchId: active });
    assert(journals.status === 200, 'branch-scoped journals list works');
  }

  // Cleanup test business trees lightly
  await prisma.userBranch.deleteMany({ where: { businessId: bizId } });
  await prisma.user.deleteMany({ where: { businessId: bizId } });
  await prisma.branch.deleteMany({ where: { businessId: bizId } });
  await prisma.business.delete({ where: { id: bizId } }).catch(() => undefined);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
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
