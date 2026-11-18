/**
 * Asset Management Phase 2 acquisition/capitalisation smoke checks.
 * Run: npx tsx scripts/test-assets-phase2.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
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

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('Asset Phase 2 tests\n');

  console.log('1. Schema tables');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('asset_acquisitions','asset_cost_additions','asset_capitalisations')`
  );
  const names = new Set(tables.map((r) => r.t));
  assert(names.has('asset_acquisitions'), 'asset_acquisitions');
  assert(names.has('asset_cost_additions'), 'asset_cost_additions');
  assert(names.has('asset_capitalisations'), 'asset_capitalisations');

  console.log('2. Workflow API');
  const owner = await prisma.user.findFirst({
    where: { role: 'business_owner', status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) {
    console.log('  ⚠ skip API — no business_owner');
  } else {
    const password = process.env.TEST_OWNER_PASSWORD || 'password123';
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: owner.username, password }
    });
    if (login.status !== 200 || !login.data?.token) {
      console.log(`  ⚠ skip API — login failed for ${owner.username} (${login.status})`);
    } else {
      const token = login.data.token as string;
      const cat = await api('/assets/categories', { token });
      const categoryId = Array.isArray(cat.data) ? cat.data[0]?.id : undefined;

      const created = await api('/assets/acquisitions', {
        method: 'POST',
        token,
        body: {
          asset_name: `Phase2 Test Asset ${Date.now()}`,
          purchase_cost: 500000,
          useful_life_months: 60,
          funding_method: 'equity',
          source: 'direct',
          category_id: categoryId
        }
      });
      assert(created.status === 201, `create draft (${created.status})`);
      const id = created.data?.id;
      assert(Boolean(id), 'acquisition id returned');
      assert(created.data?.status === 'draft', 'status draft');

      if (id) {
        const submitted = await api(`/assets/acquisitions/${id}/submit`, { method: 'POST', token });
        assert(submitted.status === 200 && submitted.data?.status === 'pending_approval', 'submit');

        const approved = await api(`/assets/acquisitions/${id}/approve`, { method: 'POST', token });
        assert(approved.status === 200 && approved.data?.status === 'approved', 'approve');

        const capitalised = await api(`/assets/acquisitions/${id}/capitalise`, {
          method: 'POST',
          token
        });
        assert(
          capitalised.status === 200 && capitalised.data?.status === 'capitalised',
          `capitalise (${capitalised.status}: ${capitalised.data?.error || capitalised.data?.message || 'ok'})`
        );
        assert(Boolean(capitalised.data?.capitalised_asset_id || capitalised.data?.asset?.id), 'asset created');
        assert(Boolean(capitalised.data?.journal_entry_id), 'journal posted');

        // Double capitalise must fail
        const again = await api(`/assets/acquisitions/${id}/capitalise`, { method: 'POST', token });
        assert(again.status >= 400, 'reject double capitalise');
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
