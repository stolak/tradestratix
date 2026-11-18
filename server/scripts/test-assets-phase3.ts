/**
 * Asset Management Phase 3 depreciation run smoke checks.
 * Run: npx tsx scripts/test-assets-phase3.ts
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
  console.log('Asset Phase 3 tests\n');

  console.log('1. Schema tables');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (
         'asset_depreciation_books','asset_depreciation_runs','asset_depreciation_run_lines'
       )`
  );
  const names = new Set(tables.map((r) => r.t));
  assert(names.has('asset_depreciation_books'), 'asset_depreciation_books');
  assert(names.has('asset_depreciation_runs'), 'asset_depreciation_runs');
  assert(names.has('asset_depreciation_run_lines'), 'asset_depreciation_run_lines');

  const cols = await prisma.$queryRawUnsafe<{ c: string }[]>(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'depreciation_entries'
       AND column_name IN ('book_code','run_id','status')`
  );
  const colSet = new Set(cols.map((r) => r.c));
  assert(colSet.has('book_code'), 'depreciation_entries.book_code');
  assert(colSet.has('run_id'), 'depreciation_entries.run_id');
  assert(colSet.has('status'), 'depreciation_entries.status');

  console.log('2. Preview → approve → post API');
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
      const now = new Date();
      const past = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const testPeriod = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}`;
      const avail = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-01`;

      await prisma.assetDepreciationRunLine.deleteMany({
        where: {
          run: {
            businessId: owner.businessId,
            periodLabel: testPeriod,
            status: { in: ['draft', 'previewed', 'approved'] }
          }
        }
      });
      await prisma.assetDepreciationRun.deleteMany({
        where: {
          businessId: owner.businessId,
          periodLabel: testPeriod,
          status: { in: ['draft', 'previewed', 'approved'] }
        }
      });

      const stamp = Date.now();
      const created = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase3 Dep Asset ${stamp}`,
          code: `P3DEP-${stamp}`,
          purchase_cost: 120000,
          useful_life_months: 60,
          depreciation_method: 'straight_line',
          available_for_use_date: avail,
          purchase_date: avail,
          source: 'other',
          funding_method: 'equity',
          post_acquisition_journal: true
        }
      });
      assert(created.status === 201 || created.status === 200, `create asset ${created.status}`);
      const assetId = created.data?.id as string;
      assert(!!assetId, 'created asset id');
      // Ensure capitalised even if journal path skipped
      await prisma.fixedAsset.update({
        where: { id: assetId },
        data: {
          financialStatus: 'capitalised',
          status: 'active',
          availableForUseDate: new Date(avail),
          depreciationStartDate: new Date(avail),
          capitalisationDate: new Date(avail)
        }
      });

      const preview = await api('/assets/depreciation/runs/preview', {
        method: 'POST',
        token,
        body: { period_label: testPeriod, asset_ids: [assetId] }
      });
      assert(
        preview.status === 201 || preview.status === 200,
        `preview status ${preview.status} ${preview.data?.message || ''}`
      );
      assert(!!preview.data?.id, 'preview returns run id');
      assert(preview.data?.status === 'previewed', 'status previewed');
      assert(preview.data?.included_count >= 1, `included_count=${preview.data?.included_count}`);

      const approve = await api(`/assets/depreciation/runs/${preview.data.id}/approve`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(approve.status === 200, `approve status ${approve.status}`);
      assert(approve.data?.status === 'approved', 'status approved');

      const post = await api(`/assets/depreciation/runs/${preview.data.id}/post`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(
        post.status === 200,
        `post status ${post.status} ${post.data?.message || JSON.stringify(post.data).slice(0, 200)}`
      );
      assert(post.data?.status === 'posted', 'status posted');

      const reverse = await api(`/assets/depreciation/runs/${preview.data.id}/reverse`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(reverse.status === 200, `reverse status ${reverse.status}`);
      assert(reverse.data?.status === 'reversed', 'status reversed');

      const list = await api('/assets/depreciation/runs', { token });
      assert(list.status === 200 && Array.isArray(list.data), 'list runs');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
