/**
 * Asset Management Phase 6 physical verification smoke checks.
 * Run: npx tsx scripts/test-assets-phase6.ts
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
  console.log('Asset Phase 6 tests\n');

  console.log('1. Schema tables');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('asset_verification_campaigns','asset_verification_results')`
  );
  const names = new Set(tables.map((r) => r.t));
  assert(names.has('asset_verification_campaigns'), 'asset_verification_campaigns');
  assert(names.has('asset_verification_results'), 'asset_verification_results');

  console.log('2. Campaign scan / mismatch / resolve');
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
      console.log(`  ⚠ skip API — login failed (${login.status})`);
    } else {
      const token = login.data.token as string;
      const stamp = Date.now();
      const today = new Date().toISOString().slice(0, 10);

      const locs = await api('/assets/locations', { token });
      const locA = Array.isArray(locs.data) ? locs.data[0] : null;
      let locB = Array.isArray(locs.data) ? locs.data[1] : null;
      if (!locB && locA) {
        const created = await api('/assets/locations', {
          method: 'POST',
          token,
          body: { code: `VLOC-${stamp}`, name: `Verify Loc ${stamp}` }
        });
        locB = created.data;
      }

      const asset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase6 Verify ${stamp}`,
          code: `P6V-${stamp}`,
          barcode: `BC${stamp}`,
          purchase_cost: 15000,
          useful_life_months: 36,
          depreciation_method: 'straight_line',
          available_for_use_date: today,
          purchase_date: today,
          location_id: locA?.id,
          source: 'other',
          funding_method: 'equity',
          post_acquisition_journal: false
        }
      });
      assert(asset.status === 201 || asset.status === 200, `create asset ${asset.status}`);
      const assetCode = asset.data?.code as string;

      const camp = await api('/assets/verification/campaigns', {
        method: 'POST',
        token,
        body: { name: `Stock count ${stamp}` }
      });
      assert(camp.status === 201, `create campaign ${camp.status}`);
      const cid = camp.data?.id as string;

      const opened = await api(`/assets/verification/campaigns/${cid}/open`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(opened.status === 200 && opened.data?.status === 'open', 'open campaign');
      assert(Number(opened.data?.expected_count || 0) >= 1, 'expected count >= 1');

      const matchScan = await api(`/assets/verification/campaigns/${cid}/scan`, {
        method: 'POST',
        token,
        body: { scanned_code: assetCode }
      });
      // May already be matched if we scan same asset - create second asset for mismatch path
      assert(matchScan.status === 200, `scan match ${matchScan.status}`);

      // Second asset for mismatch: scan with alternate location without mutating register
      const asset2 = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase6 Mismatch ${stamp}`,
          code: `P6M-${stamp}`,
          barcode: `BM${stamp}`,
          purchase_cost: 9000,
          useful_life_months: 24,
          depreciation_method: 'straight_line',
          available_for_use_date: today,
          purchase_date: today,
          location_id: locA?.id,
          source: 'other',
          funding_method: 'equity',
          post_acquisition_journal: false
        }
      });
      const asset2Id = asset2.data?.id as string;

      // New campaign scoped so we control expected set — use open after create includes new assets
      const camp2 = await api('/assets/verification/campaigns', {
        method: 'POST',
        token,
        body: { name: `Mismatch count ${stamp}`, location_id: locA?.id }
      });
      const c2 = camp2.data?.id as string;
      await api(`/assets/verification/campaigns/${c2}/open`, { method: 'POST', token, body: {} });

      const mismatchScan = await api(`/assets/verification/campaigns/${c2}/scan`, {
        method: 'POST',
        token,
        body: {
          scanned_code: asset2.data?.barcode || asset2.data?.code,
          found_location_id: locB?.id
        }
      });
      assert(
        mismatchScan.status === 200 && mismatchScan.data?.status === 'mismatch',
        `scan mismatch ${mismatchScan.status} ${mismatchScan.data?.status}`
      );

      const mid = await prisma.fixedAsset.findUnique({ where: { id: asset2Id } });
      assert((mid?.locationId || null) === (locA?.id || null), 'register location unchanged after mismatch scan');
      assert((mid?.locationId || null) !== (locB?.id || null), 'found location not applied before resolve');

      const resolved = await api(`/assets/verification/results/${mismatchScan.data?.id}/resolve`, {
        method: 'POST',
        token,
        body: { resolution_action: 'correct_register' }
      });
      assert(resolved.status === 200 && resolved.data?.status === 'resolved', 'resolve correct_register');

      const after = await prisma.fixedAsset.findUnique({ where: { id: asset2Id } });
      assert((after?.locationId || null) === (locB?.id || null), 'resolve updates register location');

      const closed = await api(`/assets/verification/campaigns/${c2}/close`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(closed.status === 200 && closed.data?.status === 'closed', 'close campaign');
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
