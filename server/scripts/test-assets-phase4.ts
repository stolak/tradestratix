/**
 * Asset Management Phase 4 operations smoke checks.
 * Run: npx tsx scripts/test-assets-phase4.ts
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
  console.log('Asset Phase 4 tests\n');

  console.log('1. Schema tables');
  const tables = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (
         'asset_transfers','asset_transfer_lines',
         'asset_maintenance_requests','asset_maintenance_work_orders','asset_maintenance_costs',
         'asset_insurances','asset_insurance_claims','asset_warranties'
       )`
  );
  const names = new Set(tables.map((r) => r.t));
  for (const t of [
    'asset_transfers',
    'asset_transfer_lines',
    'asset_maintenance_requests',
    'asset_maintenance_work_orders',
    'asset_maintenance_costs',
    'asset_insurances',
    'asset_insurance_claims',
    'asset_warranties'
  ]) {
    assert(names.has(t), t);
  }

  console.log('2. Transfer / maintenance / cover API');
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

      const asset = await api('/assets', {
        method: 'POST',
        token,
        body: {
          name: `Phase4 Ops Asset ${stamp}`,
          code: `P4OPS-${stamp}`,
          purchase_cost: 50000,
          useful_life_months: 36,
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
      await prisma.fixedAsset.update({
        where: { id: assetId },
        data: { financialStatus: 'capitalised', status: 'active', operationalStatus: 'in_use' }
      });

      const locs = await api('/assets/locations', { token });
      const locationId = Array.isArray(locs.data) ? locs.data[0]?.id : undefined;
      const assetBranchId =
        (asset.data?.branch_id || asset.data?.branchId || owner.defaultBranchId) as string | undefined;

      const transfer = await api('/assets/transfers', {
        method: 'POST',
        token,
        body: {
          reason: 'Phase4 test move',
          to_branch_id: assetBranchId,
          lines: [{ asset_id: assetId, to_location_id: locationId }]
        }
      });
      assert(transfer.status === 201, `create transfer ${transfer.status} ${JSON.stringify(transfer.data?.message || transfer.data)}`);
      const tid = transfer.data?.id as string;

      let step = await api(`/assets/transfers/${tid}/submit`, { method: 'POST', token, body: {} });
      assert(step.status === 200 && step.data?.status === 'pending_approval', 'submit transfer');
      step = await api(`/assets/transfers/${tid}/approve`, { method: 'POST', token, body: {} });
      assert(step.status === 200 && step.data?.status === 'approved', 'approve transfer');
      step = await api(`/assets/transfers/${tid}/dispatch`, { method: 'POST', token, body: {} });
      assert(step.status === 200 && step.data?.status === 'in_transit', 'dispatch transfer');
      step = await api(`/assets/transfers/${tid}/receive`, { method: 'POST', token, body: {} });
      assert(step.status === 200 && step.data?.status === 'received', 'receive transfer');

      const req = await api('/assets/maintenance/requests', {
        method: 'POST',
        token,
        body: { asset_id: assetId, title: `Service ${stamp}`, priority: 'high' }
      });
      assert(req.status === 201, `create request ${req.status}`);
      const rid = req.data?.id as string;
      await api(`/assets/maintenance/requests/${rid}/submit`, { method: 'POST', token, body: {} });
      await api(`/assets/maintenance/requests/${rid}/approve`, { method: 'POST', token, body: {} });
      const wo = await api('/assets/maintenance/work-orders', {
        method: 'POST',
        token,
        body: { request_id: rid }
      });
      assert(wo.status === 201 && wo.data?.status === 'open', 'create work order');
      const wid = wo.data?.id as string;
      await api(`/assets/maintenance/work-orders/${wid}/start`, { method: 'POST', token, body: {} });
      const done = await api(`/assets/maintenance/work-orders/${wid}/complete`, {
        method: 'POST',
        token,
        body: {}
      });
      assert(done.status === 200 && done.data?.status === 'completed', 'complete work order');

      const ins = await api('/assets/insurances', {
        method: 'POST',
        token,
        body: {
          asset_id: assetId,
          insurer_name: 'Test Insurer',
          policy_number: `POL-${stamp}`,
          start_date: today,
          end_date: `${Number(today.slice(0, 4)) + 1}-12-31`
        }
      });
      assert(ins.status === 201, `create insurance ${ins.status}`);
      const war = await api('/assets/warranties', {
        method: 'POST',
        token,
        body: {
          asset_id: assetId,
          provider_name: 'OEM Warranty',
          start_date: today,
          end_date: `${Number(today.slice(0, 4)) + 1}-12-31`
        }
      });
      assert(war.status === 201, `create warranty ${war.status}`);
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
