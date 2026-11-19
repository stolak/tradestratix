/**
 * Asset Management Phase 7 dashboard / reports smoke checks.
 * Run: npx tsx scripts/test-assets-phase7.ts
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
  console.log('Asset Phase 7 tests\n');

  console.log('1. Dashboard / report APIs');
  const owner = await prisma.user.findFirst({
    where: { role: 'business_owner', status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) {
    console.log('  ⚠ skip — no business_owner');
  } else {
    const password = process.env.TEST_OWNER_PASSWORD || 'password123';
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: owner.username, password }
    });
    if (login.status !== 200 || !login.data?.token) {
      console.log(`  ⚠ skip — login failed (${login.status})`);
    } else {
      const token = login.data.token as string;
      const stamp = Date.now();
      const today = new Date().toISOString().slice(0, 10);

      const asset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase7 Dash ${stamp}`,
          code: `P7D-${stamp}`,
          purchase_cost: 120000,
          useful_life_months: 60,
          depreciation_method: 'straight_line',
          available_for_use_date: today,
          purchase_date: today,
          source: 'other',
          funding_method: 'equity',
          post_acquisition_journal: true
        }
      });
      assert(asset.status === 201 || asset.status === 200, `create asset ${asset.status}`);
      const assetId = asset.data?.id as string;

      // Ensure capitalised for register totals
      await prisma.fixedAsset.update({
        where: { id: assetId },
        data: { financialStatus: 'capitalised', status: 'active', operationalStatus: 'in_use' }
      });

      const dash = await api('/assets/dashboard', { token });
      assert(dash.status === 200, `dashboard ${dash.status}`);
      assert(typeof dash.data?.summary?.active_count === 'number', 'summary.active_count');
      assert(typeof dash.data?.summary?.total_cost === 'number', 'summary.total_cost');
      assert(typeof dash.data?.summary?.net_book_value === 'number', 'summary.net_book_value');
      assert(Array.isArray(dash.data?.by_category), 'by_category array');
      assert(Array.isArray(dash.data?.by_branch), 'by_branch array');

      const dbAssets = await prisma.fixedAsset.findMany({
        where: { businessId: owner.businessId, financialStatus: { not: 'disposed' } }
      });
      let dbCost = 0;
      let dbNbv = 0;
      for (const a of dbAssets) {
        const cost =
          Number(a.purchaseCost || 0) +
          Number(a.freightCost || 0) +
          Number(a.installationCost || 0) +
          Number(a.otherCapitalCost || 0);
        dbCost += cost;
        dbNbv +=
          cost - Number(a.accumulatedDepreciation || 0) - Number(a.accumulatedImpairment || 0);
      }
      dbCost = Math.round(dbCost * 100) / 100;
      dbNbv = Math.round(dbNbv * 100) / 100;
      assert(
        Math.abs(Number(dash.data.summary.total_cost) - dbCost) < 0.02,
        `dashboard cost matches DB (${dash.data.summary.total_cost} vs ${dbCost})`
      );
      assert(
        Math.abs(Number(dash.data.summary.net_book_value) - dbNbv) < 0.02,
        `dashboard NBV matches DB (${dash.data.summary.net_book_value} vs ${dbNbv})`
      );
      assert(
        Number(dash.data.summary.active_count) === dbAssets.length,
        `active_count matches (${dash.data.summary.active_count} vs ${dbAssets.length})`
      );

      const reg = await api('/assets/reports/register', { token });
      assert(reg.status === 200, `register report ${reg.status}`);
      assert(Array.isArray(reg.data?.lines), 'register lines');
      assert(typeof reg.data?.totals?.net_book_value === 'number', 'register totals.nbv');
      assert(
        Math.abs(Number(reg.data.totals.cost) - dbCost) < 0.02,
        'register cost matches dashboard/DB'
      );

      const recon = await api('/assets/reports/gl-reconciliation', { token });
      assert(recon.status === 200, `gl recon ${recon.status}`);
      assert(Array.isArray(recon.data?.lines), 'recon lines');
      assert(recon.data.lines.some((l: any) => l.key === 'fixed_assets_cost'), 'cost recon line');
      assert(recon.data.lines.some((l: any) => l.key === 'net_book_value'), 'nbv recon line');
      assert(typeof recon.data?.max_abs_difference === 'number', 'max_abs_difference');

      const depSum = await api('/assets/reports/depreciation-summary', { token });
      assert(depSum.status === 200, `dep summary ${depSum.status}`);
      assert(typeof depSum.data?.period_label === 'string', 'period_label');
      assert(Array.isArray(depSum.data?.runs), 'dep runs array');
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
