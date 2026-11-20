/**
 * Asset Management Phase 8 hardening smoke checks.
 * Run: npx tsx scripts/test-assets-phase8.ts
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
  console.log('Asset Phase 8 hardening tests\n');

  const owner = await prisma.user.findFirst({
    where: { role: 'business_owner', status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) {
    console.log('  ⚠ skip — no business_owner');
    process.exitCode = 0;
    return;
  }

  const password = process.env.TEST_OWNER_PASSWORD || 'password123';
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: owner.username, password }
  });
  if (login.status !== 200 || !login.data?.token) {
    console.log(`  ⚠ skip — login failed (${login.status})`);
    process.exitCode = 1;
    return;
  }
  const token = login.data.token as string;
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  console.log('1. Scoped list endpoints + SoD + cancel campaign');

  const lists = [
    '/assets/capital-projects',
    '/assets/impairments',
    '/assets/revaluations',
    '/assets/disposals',
    '/assets/components',
    '/assets/maintenance/requests',
    '/assets/maintenance/work-orders',
    '/assets/insurances',
    '/assets/warranties',
    '/assets/verification/campaigns',
    '/assets/dashboard',
    '/assets/reports/gl-reconciliation'
  ];
  for (const path of lists) {
    const res = await api(path, { token });
    assert(res.status === 200, `GET ${path} → ${res.status}`);
  }

  const asset = await api('/assets', {
    method: 'POST',
    token,
    body: {
      name: `Phase8 Hard ${stamp}`,
      code: `P8H-${stamp}`,
      purchase_cost: 50000,
      useful_life_months: 36,
      depreciation_method: 'straight_line',
      available_for_use_date: today,
      purchase_date: today,
      source: 'other',
      funding_method: 'equity',
      post_acquisition_journal: false
    }
  });
  assert(asset.status === 201 || asset.status === 200, `create asset ${asset.status}`);
  const assetId = asset.data?.id as string;
  await prisma.fixedAsset.update({
    where: { id: assetId },
    data: { financialStatus: 'capitalised', status: 'active', operationalStatus: 'in_use' }
  });

  const imp = await api('/assets/impairments', {
    method: 'POST',
    token,
    body: { asset_id: assetId, amount: 1000, reason: 'phase8' }
  });
  assert(imp.status === 201 || imp.status === 200, `create impairment draft ${imp.status}`);
  assert(imp.data?.status === 'draft', 'impairment stays draft until post');
  const postedImp = await api(`/assets/impairments/${imp.data?.id}/post`, {
    method: 'POST',
    token,
    body: {}
  });
  assert(postedImp.status === 200 && postedImp.data?.status === 'posted', 'post impairment step');

  const disp = await api('/assets/disposals', {
    method: 'POST',
    token,
    body: {
      asset_id: assetId,
      disposal_type: 'scrap',
      proceeds: 0,
      proceeds_method: 'none',
      disposal_date: today
    }
  });
  assert(disp.status === 201 || disp.status === 200, `create disposal draft ${disp.status}`);
  const dispId = disp.data?.id as string;
  const approveDraft = await api(`/assets/disposals/${dispId}/approve`, {
    method: 'POST',
    token,
    body: {}
  });
  assert(approveDraft.status >= 400, 'cannot approve disposal from draft');
  await api(`/assets/disposals/${dispId}/submit`, { method: 'POST', token, body: {} });
  const approveOk = await api(`/assets/disposals/${dispId}/approve`, {
    method: 'POST',
    token,
    body: {}
  });
  assert(approveOk.status === 200 && approveOk.data?.status === 'approved', 'approve after submit');

  const camp = await api('/assets/verification/campaigns', {
    method: 'POST',
    token,
    body: { name: `Phase8 Camp ${stamp}` }
  });
  assert(camp.status === 201 || camp.status === 200, `create campaign ${camp.status}`);
  const cancelled = await api(`/assets/verification/campaigns/${camp.data?.id}/cancel`, {
    method: 'POST',
    token,
    body: {}
  });
  assert(
    cancelled.status === 200 && cancelled.data?.status === 'cancelled',
    `cancel campaign ${cancelled.status}`
  );

  const notifs = await prisma.appNotification.count({
    where: { businessId: owner.businessId, module: 'assets' }
  });
  assert(notifs > 0, `asset notifications created (${notifs})`);

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
