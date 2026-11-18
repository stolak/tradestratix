/**
 * Asset Management Phase 1 foundation checks.
 * Run: npx tsx scripts/test-assets-phase1.ts
 * Requires API on PORT (default 5009) and a seeded business owner.
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import {
  monthlyDepreciationAmount,
  netBookValue
} from '../src/services/asset.service.js';

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
  console.log('Asset Phase 1 tests\n');

  console.log('1. Depreciation / NBV math');
  assert(monthlyDepreciationAmount(10_000_000, 1_000_000, 60) === 150_000, 'SL monthly = 150000');
  assert(monthlyDepreciationAmount(100, 100, 12) === 0, 'zero when cost == salvage');
  assert(
    netBookValue({
      purchaseCost: 1000,
      freightCost: 50,
      installationCost: 50,
      otherCapitalCost: 0,
      accumulatedDepreciation: 200,
      accumulatedImpairment: 100
    }) === 800,
    'NBV includes freight/install and impairment'
  );

  console.log('2. Schema tables exist');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('asset_categories','asset_locations','asset_assignment_history','asset_documents','fixed_assets')`
  );
  const names = new Set(tables.map((r) => r.t));
  assert(names.has('asset_categories'), 'asset_categories table');
  assert(names.has('asset_locations'), 'asset_locations table');
  assert(names.has('asset_assignment_history'), 'asset_assignment_history table');
  assert(names.has('asset_documents'), 'asset_documents table');

  console.log('3. API category + location + asset (owner login)');
  const owner = await prisma.user.findFirst({
    where: { role: 'business_owner', status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) {
    console.log('  ⚠ skip API tests — no business_owner user');
  } else {
    // Prefer known demo password patterns; fall back to env
    const password = process.env.TEST_OWNER_PASSWORD || 'password123';
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: owner.username, password }
    });
    if (login.status !== 200 || !login.data?.token) {
      console.log(`  ⚠ skip API tests — login failed for ${owner.username} (${login.status})`);
    } else {
      const token = login.data.token as string;
      const cats = await api('/assets/categories', { token });
      assert(cats.status === 200 && Array.isArray(cats.data), 'GET /assets/categories');
      assert(cats.data.length >= 1, 'default categories seeded when empty or existing');

      const code = `LOC-${Date.now().toString(36).slice(-6)}`.toUpperCase();
      const loc = await api('/assets/locations', {
        method: 'POST',
        token,
        body: { code, name: 'Test Bay' }
      });
      assert(loc.status === 201 && loc.data?.code === code, 'POST /assets/locations');

      const catId = cats.data[0]?.id;
      const asset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Test Asset ${code}`,
          code: `FA-${code}`,
          category_id: catId,
          location_id: loc.data.id,
          purchase_cost: 50000,
          salvage_value: 5000,
          useful_life_months: 60,
          post: false
        }
      });
      assert(asset.status === 201 && asset.data?.id, 'POST /assets (no GL post)');
      assert(asset.data?.financial_status === 'not_capitalised', 'unposted asset not_capitalised');

      const patch = await api(`/assets/${asset.data.id}`, {
        method: 'PATCH',
        token,
        body: { department: 'Operations', condition: 'good' }
      });
      assert(patch.status === 200 && patch.data?.department === 'Operations', 'PATCH /assets/:id');

      const blocked = await api(`/assets/${asset.data.id}`, {
        method: 'PATCH',
        token,
        body: { accumulated_depreciation: 1 }
      });
      assert(blocked.status === 400, 'reject direct accum. dep. edit');
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
