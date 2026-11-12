import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';
import { getDefaultAccountMap } from './accounting.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function daysPastDue(dueOrBill: Date | null | undefined, asOf: Date) {
  const base = dueOrBill || asOf;
  const ms = asOf.getTime() - new Date(base).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function bucketForDays(days: number) {
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

const emptyBuckets = () => ({
  current: 0,
  '1_30': 0,
  '31_60': 0,
  '61_90': 0,
  '90_plus': 0,
  total: 0
});

export async function arAging(user: AuthUser, asOf?: string | Date, opts?: BranchListOpts) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      status: 'posted',
      paymentStatus: { in: ['open', 'partial'] },
      balance: { gt: 0 }
    },
    include: { customer: true },
    orderBy: { invoiceDate: 'asc' }
  });

  const byCustomer = new Map<
    string,
    {
      customer_id: string;
      customer_name: string;
      buckets: ReturnType<typeof emptyBuckets>;
      items: any[];
    }
  >();

  const totals = emptyBuckets();

  for (const inv of invoices) {
    const days = daysPastDue(inv.dueDate || inv.invoiceDate, asOfDate);
    const bucket = bucketForDays(days);
    const bal = roundMoney(Number(inv.balance));
    const key = inv.customerId;
    const mutable = byCustomer.get(key) || {
      customer_id: inv.customerId,
      customer_name: inv.customer.name,
      buckets: emptyBuckets(),
      items: [] as any[]
    };
    mutable.buckets[bucket as keyof typeof mutable.buckets] = roundMoney(
      mutable.buckets[bucket as keyof typeof mutable.buckets] + bal
    );
    mutable.buckets.total = roundMoney(mutable.buckets.total + bal);
    mutable.items.push({
      invoice_id: inv.id,
      invoice_number: inv.invoiceNumber,
      invoice_date: inv.invoiceDate,
      due_date: inv.dueDate,
      days_past_due: days,
      bucket,
      balance: bal
    });
    byCustomer.set(key, mutable);
    totals[bucket as keyof typeof totals] = roundMoney(totals[bucket as keyof typeof totals] + bal);
    totals.total = roundMoney(totals.total + bal);
  }

  return {
    as_of: asOfDate.toISOString(),
    totals,
    customers: [...byCustomer.values()].sort((a, b) =>
      a.customer_name.localeCompare(b.customer_name)
    )
  };
}

export async function apAging(user: AuthUser, asOf?: string | Date, opts?: BranchListOpts) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const bills = await prisma.supplierBill.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      status: { in: ['open', 'partial'] },
      balance: { gt: 0 }
    },
    include: { supplier: true },
    orderBy: { billDate: 'asc' }
  });

  const bySupplier = new Map<
    string,
    {
      supplier_id: string;
      supplier_name: string;
      buckets: ReturnType<typeof emptyBuckets>;
      items: any[];
    }
  >();
  const totals = emptyBuckets();

  for (const bill of bills) {
    const days = daysPastDue(bill.dueDate || bill.billDate, asOfDate);
    const bucket = bucketForDays(days);
    const bal = roundMoney(Number(bill.balance));
    const mutable = bySupplier.get(bill.supplierId) || {
      supplier_id: bill.supplierId,
      supplier_name: bill.supplier.name,
      buckets: emptyBuckets(),
      items: [] as any[]
    };
    mutable.buckets[bucket as keyof typeof mutable.buckets] = roundMoney(
      mutable.buckets[bucket as keyof typeof mutable.buckets] + bal
    );
    mutable.buckets.total = roundMoney(mutable.buckets.total + bal);
    mutable.items.push({
      bill_id: bill.id,
      bill_number: bill.billNumber,
      bill_date: bill.billDate,
      due_date: bill.dueDate,
      days_past_due: days,
      bucket,
      balance: bal
    });
    bySupplier.set(bill.supplierId, mutable);
    totals[bucket as keyof typeof totals] = roundMoney(totals[bucket as keyof typeof totals] + bal);
    totals.total = roundMoney(totals.total + bal);
  }

  return {
    as_of: asOfDate.toISOString(),
    totals,
    suppliers: [...bySupplier.values()].sort((a, b) =>
      a.supplier_name.localeCompare(b.supplier_name)
    )
  };
}

/**
 * Stock on hand by product variant × warehouse, as of now.
 * Empty branchIds = every branch the user may see; empty warehouseIds = every warehouse in those branches.
 */
export async function stockBalance(
  user: AuthUser,
  filters: {
    branchIds?: string[];
    warehouseIds?: string[];
    q?: string | null;
    includeZero?: boolean;
  } = {}
) {
  const authorisedBranches = await branchAccess.listAuthorisedBranches(user);
  const authorisedIds = new Set(authorisedBranches.map((b) => b.id));
  const requestedBranches = [...new Set(filters.branchIds || [])];
  const denied = requestedBranches.filter((id) => !authorisedIds.has(id));
  if (denied.length) throw httpError(403, 'You do not have access to one or more selected branches');
  const branchIds = requestedBranches.length ? requestedBranches : [...authorisedIds];

  const availableWarehouses = await prisma.warehouse.findMany({
    where: { businessId: user.businessId, branchId: { in: [...authorisedIds] } },
    select: { id: true, code: true, name: true, branchId: true, isActive: true, category: true },
    orderBy: [{ branchId: 'asc' }, { name: 'asc' }]
  });
  const inBranches = availableWarehouses.filter((w) => branchIds.includes(w.branchId));
  const requestedWarehouses = [...new Set(filters.warehouseIds || [])];
  const unknown = requestedWarehouses.filter((id) => !inBranches.some((w) => w.id === id));
  if (unknown.length) {
    throw httpError(400, 'One or more selected warehouses are not in the selected branches');
  }
  const warehouseIds = requestedWarehouses.length ? requestedWarehouses : inBranches.map((w) => w.id);

  const q = filters.q?.trim();
  const lots = warehouseIds.length
    ? await prisma.stockLot.findMany({
        where: {
          businessId: user.businessId,
          warehouseId: { in: warehouseIds },
          ...(q
            ? {
                OR: [
                  { product: { name: { contains: q } } },
                  { product: { sku: { contains: q } } },
                  { variant: { sku: { contains: q } } },
                  { variant: { name: { contains: q } } }
                ]
              }
            : {})
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              reorderLevel: true,
              category: { select: { name: true } },
              baseUom: { select: { code: true } }
            }
          },
          variant: { select: { id: true, name: true, sku: true, isDefault: true } }
        }
      })
    : [];

  const today = new Date().toISOString().slice(0, 10);
  const warehouseById = new Map(availableWarehouses.map((w) => [w.id, w]));
  const branchById = new Map(authorisedBranches.map((b) => [b.id, b]));
  type Row = {
    product_id: string;
    product_name: string;
    product_sku: string | null;
    variant_id: string;
    variant_name: string | null;
    variant_sku: string | null;
    category: string | null;
    uom: string | null;
    reorder_level: number;
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
    branch_id: string;
    branch_name: string;
    lots: number;
    on_hand: number;
    reserved: number;
    available: number;
    in_transit: number;
    expired_qty: number;
    stock_value: number;
    avg_cost: number | null;
  };
  const rows = new Map<string, Row>();
  for (const lot of lots) {
    const key = `${lot.variantId}:${lot.warehouseId}`;
    const wh = warehouseById.get(lot.warehouseId)!;
    const row =
      rows.get(key) ||
      ({
        product_id: lot.productId,
        product_name: lot.product.name,
        product_sku: lot.product.sku,
        variant_id: lot.variantId,
        variant_name: lot.variant.isDefault ? null : lot.variant.name,
        variant_sku: lot.variant.sku,
        category: lot.product.category?.name ?? null,
        uom: lot.product.baseUom?.code ?? null,
        reorder_level: Number(lot.product.reorderLevel || 0),
        warehouse_id: wh.id,
        warehouse_code: wh.code,
        warehouse_name: wh.name,
        branch_id: wh.branchId,
        branch_name: branchById.get(wh.branchId)?.name ?? '',
        lots: 0,
        on_hand: 0,
        reserved: 0,
        available: 0,
        in_transit: 0,
        expired_qty: 0,
        stock_value: 0,
        avg_cost: null
      } as Row);
    const onHand = Number(lot.quantityOnHand);
    if (onHand > 0) row.lots += 1;
    row.on_hand += onHand;
    row.reserved += Number(lot.quantityReserved);
    row.in_transit += Number(lot.quantityInTransit);
    if (lot.expiryDate && lot.expiryDate < today) row.expired_qty += onHand;
    row.stock_value += onHand * Number(lot.unitCost || 0);
    rows.set(key, row);
  }

  const qty = (n: number) => Math.round(n * 10000) / 10000;
  const result = [...rows.values()]
    .map((r) => ({
      ...r,
      on_hand: qty(r.on_hand),
      reserved: qty(r.reserved),
      available: qty(r.on_hand - r.reserved - r.in_transit),
      in_transit: qty(r.in_transit),
      expired_qty: qty(r.expired_qty),
      stock_value: roundMoney(r.stock_value),
      avg_cost: r.on_hand > 0 ? roundMoney(r.stock_value / r.on_hand) : null
    }))
    .filter((r) => filters.includeZero || Math.abs(r.on_hand) > 1e-9 || Math.abs(r.in_transit) > 1e-9)
    .sort(
      (a, b) =>
        a.product_name.localeCompare(b.product_name) ||
        String(a.variant_name || '').localeCompare(String(b.variant_name || '')) ||
        a.branch_name.localeCompare(b.branch_name) ||
        a.warehouse_name.localeCompare(b.warehouse_name)
    );

  return {
    as_of: new Date().toISOString(),
    filter: {
      branch_ids: requestedBranches,
      warehouse_ids: requestedWarehouses
    },
    options: {
      branches: authorisedBranches.map((b) => ({ id: b.id, code: b.code, name: b.name, is_active: b.isActive })),
      warehouses: availableWarehouses.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        branch_id: w.branchId,
        is_active: w.isActive
      }))
    },
    totals: {
      products: new Set(result.map((r) => r.variant_id)).size,
      warehouses: new Set(result.map((r) => r.warehouse_id)).size,
      on_hand: qty(result.reduce((s, r) => s + r.on_hand, 0)),
      stock_value: roundMoney(result.reduce((s, r) => s + r.stock_value, 0))
    },
    rows: result
  };
}

export async function customerStatement(
  user: AuthUser,
  customerId: string,
  opts?: BranchListOpts
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId: user.businessId }
  });
  if (!customer) return null;

  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });

  const [invoices, payments] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { businessId: user.businessId, customerId, status: 'posted', ...scope },
      include: { items: true },
      orderBy: { invoiceDate: 'asc' }
    }),
    prisma.customerPayment.findMany({
      where: { businessId: user.businessId, customerId, ...scope },
      include: { allocations: { include: { invoice: true } } },
      orderBy: { paymentDate: 'asc' }
    })
  ]);

  const openBalance = roundMoney(invoices.reduce((s, i) => s + Number(i.balance), 0));

  return serialize({
    customer,
    open_balance: openBalance,
    invoices,
    payments
  });
}

export async function supplierStatement(
  user: AuthUser,
  supplierId: string,
  opts?: BranchListOpts
) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, businessId: user.businessId }
  });
  if (!supplier) return null;

  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });

  const [bills, payments] = await Promise.all([
    prisma.supplierBill.findMany({
      where: { businessId: user.businessId, supplierId, ...scope },
      orderBy: { billDate: 'asc' }
    }),
    prisma.supplierPayment.findMany({
      where: { businessId: user.businessId, supplierId, ...scope },
      include: { allocations: { include: { bill: true } } },
      orderBy: { paymentDate: 'asc' }
    })
  ]);

  const openBalance = roundMoney(bills.reduce((s, b) => s + Number(b.balance), 0));

  return serialize({
    supplier,
    open_balance: openBalance,
    bills,
    payments
  });
}

function parseDateBound(from?: string | null, to?: string | null) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) throw httpError(400, 'from is not a valid date');
  if (toDate && Number.isNaN(toDate.getTime())) throw httpError(400, 'to is not a valid date');
  if (toDate) toDate.setHours(23, 59, 59, 999);
  return { fromDate, toDate };
}

/**
 * Inter-branch clearing reconciliation: lines on the clearing account grouped by source,
 * with per-branch nets. Company-wide net should be ~0; non-zero pairs are open / unmatched.
 */
export async function interBranchClearing(
  user: AuthUser,
  filter: { from?: string; to?: string } & BranchListOpts = {}
) {
  const accountMap = await getDefaultAccountMap(user.businessId);
  const clearingId = accountMap.inter_branch_clearing;
  if (!clearingId) throw httpError(400, 'Default account "inter_branch_clearing" is not configured');

  const { fromDate, toDate } = parseDateBound(filter.from, filter.to);
  const authorised = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  const canAll = branchAccess.canAccessAllBranches(user);
  const focusBranch =
    filter.branchId && !filter.allowConsolidated
      ? filter.branchId
      : !filter.allowConsolidated && user.activeBranchId
        ? user.activeBranchId
        : null;

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: clearingId,
      journalEntry: {
        businessId: user.businessId,
        status: 'posted',
        ...(fromDate || toDate
          ? { entryDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
          : {}),
        ...(focusBranch
          ? { branchId: focusBranch }
          : canAll
            ? {}
            : { branchId: { in: authorised } })
      }
    },
    include: {
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          entryDate: true,
          memo: true,
          branchId: true,
          sourceType: true,
          sourceId: true,
          customerId: true,
          branch: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, name: true, code: true } }
        }
      }
    },
    orderBy: { journalEntry: { entryDate: 'asc' } }
  });

  type Pair = {
    source_type: string | null;
    source_id: string | null;
    customer: { id: string; name: string; code: string | null } | null;
    branches: Record<string, { branch_id: string; branch_code: string; branch_name: string; debit: number; credit: number; net: number }>;
    debit: number;
    credit: number;
    net: number;
    balanced: boolean;
    entries: { entry_number: string; entry_date: string; branch_id: string | null; memo: string | null; debit: number; credit: number }[];
  };

  const pairs = new Map<string, Pair>();
  const byBranch = new Map<string, { branch_id: string; branch_code: string; branch_name: string; debit: number; credit: number; net: number }>();

  for (const line of lines) {
    const je = line.journalEntry;
    const key = `${je.sourceType || 'none'}:${je.sourceId || je.id}`;
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    let pair = pairs.get(key);
    if (!pair) {
      pair = {
        source_type: je.sourceType,
        source_id: je.sourceId,
        customer: je.customer,
        branches: {},
        debit: 0,
        credit: 0,
        net: 0,
        balanced: true,
        entries: []
      };
      pairs.set(key, pair);
    }
    pair.debit = roundMoney(pair.debit + debit);
    pair.credit = roundMoney(pair.credit + credit);
    pair.net = roundMoney(pair.debit - pair.credit);
    pair.entries.push({
      entry_number: je.entryNumber,
      entry_date: je.entryDate.toISOString(),
      branch_id: je.branchId,
      memo: je.memo,
      debit,
      credit
    });
    if (je.branchId) {
      const b = je.branch;
      const row = pair.branches[je.branchId] || {
        branch_id: je.branchId,
        branch_code: b?.code || '',
        branch_name: b?.name || '',
        debit: 0,
        credit: 0,
        net: 0
      };
      row.debit = roundMoney(row.debit + debit);
      row.credit = roundMoney(row.credit + credit);
      row.net = roundMoney(row.debit - row.credit);
      pair.branches[je.branchId] = row;

      const br = byBranch.get(je.branchId) || {
        branch_id: je.branchId,
        branch_code: b?.code || '',
        branch_name: b?.name || '',
        debit: 0,
        credit: 0,
        net: 0
      };
      br.debit = roundMoney(br.debit + debit);
      br.credit = roundMoney(br.credit + credit);
      br.net = roundMoney(br.debit - br.credit);
      byBranch.set(je.branchId, br);
    }
  }

  const rows = [...pairs.values()].map((p) => {
    p.balanced = Math.abs(p.net) < 0.01;
    return {
      ...p,
      branches: Object.values(p.branches)
    };
  });
  const open = rows.filter((r) => !r.balanced);
  const companyNet = roundMoney(rows.reduce((s, r) => s + r.net, 0));

  return serialize({
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    clearing_account_id: clearingId,
    company_net: companyNet,
    balanced: Math.abs(companyNet) < 0.01,
    open_count: open.length,
    by_branch: [...byBranch.values()].sort((a, b) => a.branch_name.localeCompare(b.branch_name)),
    pairs: rows.sort((a, b) => Number(a.balanced) - Number(b.balanced)),
    open_pairs: open
  });
}

/** Warehouse fulfilment pipeline: awaiting pick, in progress, ready, out for delivery, done. */
export async function fulfilmentSummary(
  user: AuthUser,
  filter: { from?: string; to?: string; status?: string; warehouse_id?: string } & BranchListOpts = {}
) {
  const { fromDate, toDate } = parseDateBound(filter.from, filter.to);
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filter.branchId,
    allowConsolidated: filter.allowConsolidated ?? true
  });

  const branchFilter = scope.branchId as string | { in: string[] } | undefined;
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      businessId: user.businessId,
      status: 'posted',
      fulfilmentMode: { in: ['pickup', 'delivery'] },
      ...(branchFilter
        ? {
            OR: [{ branchId: branchFilter as any }, { sellingBranchId: branchFilter as any }]
          }
        : {}),
      ...(fromDate || toDate
        ? { postedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {})
    },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, name: true, code: true } },
      sellingBranch: { select: { id: true, name: true, code: true } },
      items: { select: { id: true, quantity: true, fulfilledQuantity: true, cancelledQuantity: true, lineTotal: true } },
      fulfilments: {
        where: filter.status ? { status: filter.status } : undefined,
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          branch: { select: { id: true, code: true, name: true } }
        }
      }
    },
    orderBy: { postedAt: 'desc' },
    take: 500
  });

  const warehouseFilter = filter.warehouse_id || null;
  const statusCounts: Record<string, number> = {
    awaiting_pick: 0,
    picking: 0,
    ready_for_collection: 0,
    picked: 0,
    dispatched: 0,
    released: 0,
    delivered: 0,
    discrepancy: 0,
    cancelled: 0
  };

  const tasks = await prisma.salesFulfilment.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(fromDate || toDate
        ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {})
    },
    select: { status: true, recognisedAmount: true, totalCost: true }
  });
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const openReservations = await prisma.salesReservation.findMany({
    where: {
      businessId: user.businessId,
      status: 'active',
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(scope.branchId ? { branchId: scope.branchId as any } : {})
    },
    select: { invoiceItemId: true, quantity: true, fulfilledQuantity: true, releasedQuantity: true, warehouseId: true }
  });
  const reservedOnTask = new Set(
    (
      await prisma.salesFulfilmentItem.findMany({
        where: {
          fulfilment: {
            businessId: user.businessId,
            status: { in: ['picking', 'ready_for_collection', 'picked', 'dispatched'] }
          }
        },
        select: { invoiceItemId: true }
      })
    ).map((i) => i.invoiceItemId)
  );
  let awaitingPick = 0;
  for (const r of openReservations) {
    const left = Number(r.quantity) - Number(r.fulfilledQuantity) - Number(r.releasedQuantity);
    if (left > 1e-6 && !reservedOnTask.has(r.invoiceItemId)) awaitingPick += 1;
  }
  statusCounts.awaiting_pick = awaitingPick;

  const rows = invoices.map((inv) => {
    const ordered = inv.items.reduce((s, i) => s + Number(i.quantity), 0);
    const fulfilled = inv.items.reduce((s, i) => s + Number(i.fulfilledQuantity), 0);
    const cancelled = inv.items.reduce((s, i) => s + Number(i.cancelledQuantity), 0);
    return {
      id: inv.id,
      invoice_number: inv.invoiceNumber,
      customer: inv.customer,
      revenue_branch: inv.branch,
      selling_branch: inv.sellingBranch,
      fulfilment_mode: inv.fulfilmentMode,
      fulfilment_status: inv.fulfilmentStatus,
      ordered_qty: ordered,
      fulfilled_qty: fulfilled,
      cancelled_qty: cancelled,
      open_qty: Math.max(0, ordered - fulfilled - cancelled),
      recognised_amount: Number(inv.recognisedAmount),
      deposit_held: Number(inv.depositHeld),
      balance: Number(inv.balance),
      tasks: inv.fulfilments
        .filter((f) => !warehouseFilter || f.warehouseId === warehouseFilter)
        .map((f) => ({
          id: f.id,
          fulfilment_number: f.fulfilmentNumber,
          status: f.status,
          warehouse: f.warehouse,
          branch: f.branch,
          recognised_amount: Number(f.recognisedAmount)
        }))
    };
  });

  return serialize({
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    status_counts: statusCounts,
    recognised_total: roundMoney(tasks.reduce((s, t) => s + Number(t.recognisedAmount), 0)),
    cogs_total: roundMoney(tasks.reduce((s, t) => s + Number(t.totalCost), 0)),
    orders: rows
  });
}

/**
 * Sales by revenue branch for the period (recognised revenue, deposits held, returns, COGS).
 * Consolidated view sums branches without double-counting clearing.
 */
export async function salesByBranch(
  user: AuthUser,
  filter: { from?: string; to?: string } & BranchListOpts = {}
) {
  const { fromDate, toDate } = parseDateBound(filter.from, filter.to);
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: filter.branchId,
    allowConsolidated: filter.allowConsolidated ?? true
  });

  const fulfilments = await prisma.salesFulfilment.findMany({
    where: {
      businessId: user.businessId,
      status: { in: ['released', 'delivered'] },
      ...(fromDate || toDate
        ? { fulfilledAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {})
    },
    include: {
      invoice: {
        select: {
          id: true,
          branchId: true,
          invoiceNumber: true,
          branch: { select: { id: true, code: true, name: true } }
        }
      },
      branch: { select: { id: true, code: true, name: true } }
    }
  });

  const returns = await prisma.salesReturn.findMany({
    where: {
      businessId: user.businessId,
      status: 'posted',
      ...(fromDate || toDate
        ? { postedAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {})
    },
    select: {
      revenueBranchId: true,
      recognisedReversal: true,
      cogsReversal: true,
      creditIssued: true,
      refundAmount: true,
      revenueBranch: { select: { id: true, code: true, name: true } }
    }
  });

  type Row = {
    branch_id: string;
    branch_code: string;
    branch_name: string;
    handovers: number;
    recognised: number;
    cogs: number;
    returns: number;
    returns_cogs: number;
    credit_issued: number;
    refunds: number;
    gross_margin: number;
  };
  const byBranch = new Map<string, Row>();
  const ensure = (id: string, code: string, name: string) => {
    let row = byBranch.get(id);
    if (!row) {
      row = {
        branch_id: id,
        branch_code: code,
        branch_name: name,
        handovers: 0,
        recognised: 0,
        cogs: 0,
        returns: 0,
        returns_cogs: 0,
        credit_issued: 0,
        refunds: 0,
        gross_margin: 0
      };
      byBranch.set(id, row);
    }
    return row;
  };

  const authorised = await branchAccess.listAuthorisedBranchIds(user.id, user.businessId, user.role);
  const canAll = branchAccess.canAccessAllBranches(user);
  const allowBranch = (id: string | null | undefined) => {
    if (!id) return false;
    if (canAll) return true;
    if (filter.branchId && !filter.allowConsolidated) return id === filter.branchId;
    if (scope.branchId && typeof scope.branchId === 'string') return id === scope.branchId;
    if (scope.branchId && typeof scope.branchId === 'object' && 'in' in (scope.branchId as object)) {
      return ((scope.branchId as { in: string[] }).in || []).includes(id);
    }
    return authorised.includes(id);
  };

  for (const f of fulfilments) {
    const revenueBranchId = f.invoice.branchId || f.branchId;
    if (!allowBranch(revenueBranchId)) continue;
    const meta = f.invoice.branch || f.branch;
    const row = ensure(revenueBranchId, meta.code, meta.name);
    row.handovers += 1;
    row.recognised = roundMoney(row.recognised + Number(f.recognisedAmount));
    row.cogs = roundMoney(row.cogs + Number(f.totalCost));
  }

  for (const r of returns) {
    if (!allowBranch(r.revenueBranchId)) continue;
    const row = ensure(r.revenueBranchId, r.revenueBranch.code, r.revenueBranch.name);
    row.returns = roundMoney(row.returns + Number(r.recognisedReversal));
    row.returns_cogs = roundMoney(row.returns_cogs + Number(r.cogsReversal));
    row.credit_issued = roundMoney(row.credit_issued + Number(r.creditIssued));
    row.refunds = roundMoney(row.refunds + Number(r.refundAmount));
  }

  const branches = [...byBranch.values()]
    .map((r) => ({
      ...r,
      net_recognised: roundMoney(r.recognised - r.returns),
      gross_margin: roundMoney(r.recognised - r.returns - (r.cogs - r.returns_cogs))
    }))
    .sort((a, b) => a.branch_name.localeCompare(b.branch_name));

  const totals = branches.reduce(
    (s, r) => ({
      handovers: s.handovers + r.handovers,
      recognised: roundMoney(s.recognised + r.recognised),
      cogs: roundMoney(s.cogs + r.cogs),
      returns: roundMoney(s.returns + r.returns),
      returns_cogs: roundMoney(s.returns_cogs + r.returns_cogs),
      credit_issued: roundMoney(s.credit_issued + r.credit_issued),
      refunds: roundMoney(s.refunds + r.refunds),
      net_recognised: roundMoney(s.net_recognised + r.net_recognised),
      gross_margin: roundMoney(s.gross_margin + r.gross_margin)
    }),
    {
      handovers: 0,
      recognised: 0,
      cogs: 0,
      returns: 0,
      returns_cogs: 0,
      credit_issued: 0,
      refunds: 0,
      net_recognised: 0,
      gross_margin: 0
    }
  );

  return serialize({
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    consolidated: Boolean(filter.allowConsolidated || !filter.branchId),
    totals,
    branches
  });
}
