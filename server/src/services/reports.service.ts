import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import * as branchAccess from './branch-access.service.js';

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
      available: qty(r.on_hand - r.reserved),
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
