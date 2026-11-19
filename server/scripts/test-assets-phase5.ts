/**
 * Asset Management Phase 5 advanced accounting smoke checks.
 * Run: npx tsx scripts/test-assets-phase5.ts
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
  console.log('Asset Phase 5 tests\n');

  console.log('1. Schema tables');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (
         'capital_projects','capital_project_costs','asset_components',
         'asset_impairments','asset_revaluations','asset_disposals','asset_accounting_events'
       )`
  );
  const names = new Set(tables.map((r) => r.t));
  for (const t of [
    'capital_projects',
    'capital_project_costs',
    'asset_components',
    'asset_impairments',
    'asset_revaluations',
    'asset_disposals',
    'asset_accounting_events'
  ]) {
    assert(names.has(t), t);
  }

  console.log('2. CIP / impairment / revaluation / disposal API');
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

      const cip = await api('/assets/capital-projects', {
        method: 'POST',
        token,
        body: { name: `CIP Build ${stamp}` }
      });
      assert(cip.status === 201, `create CIP ${cip.status}`);
      const cipId = cip.data?.id as string;

      const cost = await api(`/assets/capital-projects/${cipId}/costs`, {
        method: 'POST',
        token,
        body: {
          amount: 100000,
          funding_method: 'equity',
          description: 'Foundation',
          cost_date: today
        }
      });
      assert(cost.status === 200, `add CIP cost ${cost.status} ${JSON.stringify(cost.data?.message || '')}`);

      await api(`/assets/capital-projects/${cipId}/complete`, { method: 'POST', token, body: {} });
      const cap = await api(`/assets/capital-projects/${cipId}/capitalise`, {
        method: 'POST',
        token,
        body: { asset_name: `From CIP ${stamp}`, useful_life_months: 60 }
      });
      assert(cap.status === 200 && cap.data?.status === 'capitalised', `capitalise CIP ${cap.status}`);
      const cipAssetId = cap.data?.capitalised_asset_id || cap.data?.capitalisedAssetId;

      const asset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase5 FA ${stamp}`,
          code: `P5FA-${stamp}`,
          purchase_cost: 80000,
          useful_life_months: 48,
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

      const imp = await api('/assets/impairments', {
        method: 'POST',
        token,
        body: { asset_id: assetId, amount: 5000, reason: 'Damage', impairment_date: today }
      });
      assert(imp.status === 201, `create impairment ${imp.status}`);
      const postedImp = await api(`/assets/impairments/${imp.data?.id}/post`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(postedImp.status === 200 && postedImp.data?.status === 'posted', 'post impairment');

      const afterImp = await prisma.fixedAsset.findUnique({ where: { id: assetId } });
      const nbv =
        Number(afterImp?.purchaseCost || 0) -
        Number(afterImp?.accumulatedDepreciation || 0) -
        Number(afterImp?.accumulatedImpairment || 0);
      const reval = await api('/assets/revaluations', {
        method: 'POST',
        token,
        body: {
          asset_id: assetId,
          new_carrying_amount: roundUp(nbv + 2000),
          reason: 'Market uplift',
          revaluation_date: today
        }
      });
      assert(reval.status === 201, `create revaluation ${reval.status} ${JSON.stringify(reval.data?.message || '')}`);
      const postedRev = await api(`/assets/revaluations/${reval.data?.id}/post`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(postedRev.status === 200 && postedRev.data?.status === 'posted', 'post revaluation');

      const comp = await api('/assets/components', {
        method: 'POST',
        token,
        body: {
          parent_asset_id: assetId,
          name: 'Motor',
          cost_amount: 1000
        }
      });
      assert(comp.status === 201, `create component ${comp.status}`);

      const dispAsset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase5 Dispose ${stamp}`,
          code: `P5D-${stamp}`,
          purchase_cost: 20000,
          useful_life_months: 24,
          depreciation_method: 'straight_line',
          available_for_use_date: today,
          purchase_date: today,
          source: 'other',
          funding_method: 'equity',
          post_acquisition_journal: true
        }
      });
      const disposeId = dispAsset.data?.id as string;
      const disp = await api('/assets/disposals', {
        method: 'POST',
        token,
        body: {
          asset_id: disposeId,
          disposal_type: 'scrap',
          proceeds: 0,
          proceeds_method: 'none',
          disposal_date: today,
          reason: 'Scrapped'
        }
      });
      assert(disp.status === 201, `create disposal ${disp.status}`);
      await api(`/assets/disposals/${disp.data?.id}/submit`, { method: 'POST', token, body: {} });
      await api(`/assets/disposals/${disp.data?.id}/approve`, { method: 'POST', token, body: {} });
      const postedDisp = await api(`/assets/disposals/${disp.data?.id}/post`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(postedDisp.status === 200 && postedDisp.data?.status === 'posted', `post disposal ${postedDisp.status} ${JSON.stringify(postedDisp.data?.message || '')}`);

      const disposed = await prisma.fixedAsset.findUnique({ where: { id: disposeId } });
      assert(disposed?.financialStatus === 'disposed', 'asset financialStatus disposed');
      assert(Boolean(cipAssetId), 'CIP produced capitalised asset');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

function roundUp(n: number) {
  return Math.round(n * 100) / 100;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
