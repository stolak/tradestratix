/**
 * Bulk acquisition → N capitalised assets.
 * Run: npx tsx scripts/test-assets-bulk.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { nextAssetCodes, parseSerialNumbers } from '../src/services/asset-acquisition.service.js';

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
  console.log('Asset bulk capitalisation tests\n');

  console.log('1. Helpers');
  const parsed = parseSerialNumbers('SN-A\nSN-B\nSN-C');
  assert(parsed.length === 3 && parsed[1] === 'SN-B', 'parse serials newline');
  try {
    parseSerialNumbers('SN-A\nSN-A');
    assert(false, 'reject duplicate serials in list');
  } catch {
    assert(true, 'reject duplicate serials in list');
  }

  console.log('2. API bulk workflow');
  const owner = await prisma.user.findFirst({
    where: { role: 'business_owner', status: 'active' },
    orderBy: { createdAt: 'asc' }
  });
  if (!owner) {
    console.log('  ⚠ skip API — no owner');
  } else {
    const password = process.env.TEST_OWNER_PASSWORD || 'password123';
    const login = await api('/auth/login', {
      method: 'POST',
      body: { username: owner.username, password }
    });
    if (login.status !== 200 || !login.data?.token) {
      console.log('  ⚠ skip API — login failed');
    } else {
      const token = login.data.token as string;
      const cats = await api('/assets/categories', { token });
      const computer =
        (Array.isArray(cats.data) &&
          cats.data.find((c: any) => String(c.code).toUpperCase() === 'COMPUTER')) ||
        cats.data?.[0];
      const stamp = Date.now().toString(36).slice(-6).toUpperCase();
      const serials = [`HP-${stamp}-01`, `HP-${stamp}-02`, `HP-${stamp}-03`];

      const created = await api('/assets/acquisitions', {
        method: 'POST',
        token,
        body: {
          asset_name: 'HP computer ProBook iCore 8 16G',
          manufacturer: 'HP',
          model: 'ProBook iCore 8 16G',
          category_id: computer?.id,
          quantity: 3,
          unit_cost: 450000,
          funding_method: 'equity',
          source: 'other',
          serial_numbers: serials,
          useful_life_months: 36
        }
      });
      assert(created.status === 201, `create bulk draft (${created.status})`);
      assert(created.data?.quantity === 3, 'quantity 3');
      assert(Number(created.data?.purchase_cost) === 1_350_000, 'lot purchase = unit × qty');

      const id = created.data?.id;
      if (id) {
        await api(`/assets/acquisitions/${id}/submit`, { method: 'POST', token });
        await api(`/assets/acquisitions/${id}/approve`, { method: 'POST', token });
        const cap = await api(`/assets/acquisitions/${id}/capitalise`, { method: 'POST', token });
        assert(cap.status === 200, `capitalise (${cap.status}: ${cap.data?.error || 'ok'})`);
        assert(Array.isArray(cap.data?.assets) && cap.data.assets.length === 3, '3 assets created');
        const codes = (cap.data.assets || []).map((a: any) => a.code);
        assert(codes.every((c: string) => c && String(c).includes('-')), 'auto tags assigned');
        const sns = (cap.data.assets || []).map((a: any) => a.serial_number);
        assert(sns.sort().join() === [...serials].sort().join(), 'serials preserved');
        const costs = (cap.data.assets || []).map((a: any) => Number(a.purchase_cost));
        assert(costs.every((c: number) => c === 450000), 'each unit cost 450000');

        const dup = await api('/assets/acquisitions', {
          method: 'POST',
          token,
          body: {
            asset_name: 'HP computer ProBook iCore 8 16G',
            quantity: 1,
            unit_cost: 1,
            funding_method: 'equity',
            source: 'other',
            serial_numbers: [serials[0]]
          }
        });
        assert(dup.status >= 400, 'reject reuse of existing serial on create');
      }

      if (computer?.code) {
        const next = await nextAssetCodes(owner.businessId, computer.code, 2);
        assert(next.length === 2 && next[0] !== next[1], 'nextAssetCodes advances');
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
