import { prisma } from '../utils/prisma.js';
import { roundMoney, serialize } from '../utils/helpers.js';

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

export async function arAging(businessId: string, asOf?: string | Date) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      businessId,
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

export async function apAging(businessId: string, asOf?: string | Date) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const bills = await prisma.supplierBill.findMany({
    where: {
      businessId,
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

export async function customerStatement(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) return null;

  const [invoices, payments] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { businessId, customerId, status: 'posted' },
      include: { items: true },
      orderBy: { invoiceDate: 'asc' }
    }),
    prisma.customerPayment.findMany({
      where: { businessId, customerId },
      include: { allocations: { include: { invoice: true } } },
      orderBy: { paymentDate: 'asc' }
    })
  ]);

  const openBalance = roundMoney(
    invoices.reduce((s, i) => s + Number(i.balance), 0)
  );

  return serialize({
    customer,
    open_balance: openBalance,
    invoices,
    payments
  });
}

export async function supplierStatement(businessId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, businessId } });
  if (!supplier) return null;

  const [bills, payments] = await Promise.all([
    prisma.supplierBill.findMany({
      where: { businessId, supplierId },
      orderBy: { billDate: 'asc' }
    }),
    prisma.supplierPayment.findMany({
      where: { businessId, supplierId },
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
