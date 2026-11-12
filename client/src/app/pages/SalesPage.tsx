import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Info, Plus, Trash2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { SearchSelect } from '../components/SearchSelect';
import { InvoiceViewModal } from '../components/InvoiceViewModal';
import { ReceiveCustomerPayment } from '../components/ReceiveCustomerPayment';

type Tab = 'invoices' | 'payments' | 'returns';

type SellPriceOption = {
  id: string;
  uom_id: string;
  code: string;
  name: string;
  price_level?: string;
  label?: string | null;
  unit_price: string;
  is_default?: boolean;
};

type LineItem = {
  key: string;
  product_id: string;
  selling_price_id: string;
  uom_id: string;
  quantity: string;
  unit_price: string;
  /** Pickup warehouse; empty = invoice default warehouse */
  warehouse_id: string;
  /** Manual split across warehouses (line UoM); null = automatic allocation */
  allocations?: { warehouse_id: string; quantity: string }[] | null;
};

type PreviewLine = {
  key: string;
  requested: number;
  allocated: number;
  shortage: number;
  allocations: { warehouse_id: string; quantity: number; method: string }[];
  stock: {
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
    branch_id: string;
    branch_name: string;
    free: number;
  }[];
};

type FulfilmentMode = 'immediate' | 'pickup' | 'delivery';

type FulfilmentOptions = {
  branches: { id: string; name: string; code: string }[];
  warehouses: { id: string; name: string; code: string; branch: { id: string; name: string; code: string } }[];
  availability: Record<string, Record<string, number>>;
};

const FULFILMENT_LABELS: Record<string, string> = {
  pending: 'To collect',
  partial: 'Part collected',
  fulfilled: 'Collected'
};

const DELIVERY_LABELS: Record<string, string> = {
  pending: 'To deliver',
  partial: 'Part delivered',
  fulfilled: 'Delivered'
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  posted: 'Confirmed',
  cancelled: 'Cancelled'
};

function qtyLabel(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function isWalkInCustomer(c: any) {
  return (
    c?.customer_type === 'walk_in' ||
    String(c?.code || '').toUpperCase() === 'WALK-IN'
  );
}

function fmtMoney(v: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newLineKey() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sellingPricesForProduct(p: any) {
  return ((p?.selling_prices || []) as any[]).filter((s) => s && s.is_active !== false);
}

function sellPriceOptionsForProduct(p: any): SellPriceOption[] {
  return sellingPricesForProduct(p)
    .map((sp) => {
      const uomId = sp.uom_id || sp.uom?.id || '';
      if (!uomId || !sp.id) return null;
      return {
        id: sp.id,
        uom_id: uomId,
        code: sp.uom?.code || '',
        name: sp.uom?.name || '',
        price_level: sp.price_level,
        label: sp.label,
        unit_price: String(sp.effective_unit_price ?? sp.unit_price ?? 0),
        is_default: Boolean(sp.is_default)
      } as SellPriceOption;
    })
    .filter(Boolean) as SellPriceOption[];
}

function defaultSellPrice(p: any): SellPriceOption | null {
  const rows = sellPriceOptionsForProduct(p);
  if (!rows.length) return null;
  return (
    rows.find((s) => s.is_default) ||
    rows.find((s) => s.uom_id === (p?.selling_uom_id || p?.selling_uom?.id)) ||
    rows[0]
  );
}

function priceFieldsFromProduct(p: any) {
  const sp = defaultSellPrice(p);
  return {
    selling_price_id: sp?.id || '',
    uom_id: sp?.uom_id || '',
    unit_price: sp?.unit_price || '0'
  };
}

function makeLine(product?: any): LineItem {
  return {
    key: newLineKey(),
    product_id: product?.id || '',
    quantity: '1',
    warehouse_id: '',
    ...priceFieldsFromProduct(product)
  };
}

function lineSubtotal(line: LineItem) {
  const qty = Number(line.quantity);
  const price = Number(line.unit_price);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return Math.round(qty * price * 10000) / 10000;
}

export const SalesPage: React.FC = () => {
  const { activeBranchId, user, can } = useAuth();
  const canChangePrice = can('sales.change_price');
  const canPostInvoice = can('sales.post') || can('sales.approve');
  const canChooseRevenueBranch = can('sales.revenue_branch');
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [fulfilmentMode, setFulfilmentMode] = useState<FulfilmentMode>('immediate');
  const deferred = fulfilmentMode !== 'immediate';
  const [delivery, setDelivery] = useState({ address: '', contact: '', phone: '' });
  const [collectors, setCollectors] = useState('');
  const [revenueBranchId, setRevenueBranchId] = useState('');
  const [fulfilOptions, setFulfilOptions] = useState<FulfilmentOptions>({
    branches: [],
    warehouses: [],
    availability: {}
  });
  const [mySalesRep, setMySalesRep] = useState<{ id: string } | null>(
    () => (user?.sales_rep?.id ? { id: user.sales_rep.id } : null)
  );
  const isSalesRep = Boolean(user?.is_sales_rep || user?.sales_rep?.id || mySalesRep?.id);
  const mySalesRepId = mySalesRep?.id || user?.sales_rep?.id || '';
  const [tab, setTab] = useState<Tab>('invoices');
  const [customers, setCustomers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    customer_id: '',
    warehouse_id: '',
    sales_rep_id: '',
    notes: ''
  });
  const [lines, setLines] = useState<LineItem[]>([makeLine()]);

  const selectableCustomers = useMemo(
    () =>
      customers.filter(
        (c) => (c.status || 'active') === 'active' && (isSalesRep || !isWalkInCustomer(c))
      ),
    [customers, isSalesRep]
  );

  const selectedCustomer = useMemo(
    () => selectableCustomers.find((c) => c.id === form.customer_id),
    [selectableCustomers, form.customer_id]
  );
  const walkInSelected = isWalkInCustomer(selectedCustomer);
  const salesRepLocked = walkInSelected && isSalesRep && !!mySalesRepId;

  const customerOptions = useMemo(
    () => selectableCustomers.map((c) => ({ value: c.id, label: c.name })),
    [selectableCustomers]
  );
  const allWarehouseOptions = useMemo(
    () =>
      fulfilOptions.warehouses.map((w) => ({
        value: w.id,
        label: `${w.branch?.name} · ${w.code} — ${w.name}`
      })),
    [fulfilOptions.warehouses]
  );
  const warehouseOptions = useMemo(
    () =>
      deferred && allWarehouseOptions.length
        ? allWarehouseOptions
        : warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    [warehouses, fulfilmentMode, allWarehouseOptions]
  );
  const warehouseById = useMemo(
    () => new Map(fulfilOptions.warehouses.map((w) => [w.id, w])),
    [fulfilOptions.warehouses]
  );
  const lineProductKey = useMemo(
    () => [...new Set(lines.map((l) => l.product_id).filter(Boolean))].sort().join(','),
    [lines]
  );
  const freeStock = (productId: string, warehouseId: string) =>
    fulfilOptions.availability[productId]?.[warehouseId] ?? 0;
  const otherBranchPickup =
    deferred &&
    lines.some((l) => {
      const wh = warehouseById.get(l.warehouse_id || form.warehouse_id);
      return wh && wh.branch?.id !== activeBranchId;
    });
  const salesRepOptions = useMemo(
    () =>
      reps.map((r) => ({
        value: r.id,
        label: `${r.name || r.employee?.full_name || 'Rep'} (${Number(r.commission_percent)}%)`
      })),
    [reps]
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products]
  );

  const invoiceSubtotal = useMemo(
    () => lines.reduce((sum, line) => sum + lineSubtotal(line), 0),
    [lines]
  );
  const customerDiscountPct = Number(selectedCustomer?.discount_percent || 0);
  const customerDiscountAmount =
    customerDiscountPct > 0 ? Math.round(invoiceSubtotal * customerDiscountPct) / 100 : 0;
  const invoiceTotal = invoiceSubtotal - customerDiscountAmount;
  const customerCreditLimit =
    selectedCustomer?.credit_limit != null ? Number(selectedCustomer.credit_limit) : null;
  const customerAvailableCredit =
    customerCreditLimit != null
      ? selectedCustomer?.available_credit != null
        ? Number(selectedCustomer.available_credit)
        : customerCreditLimit - Number(selectedCustomer?.outstanding_balance || 0)
      : null;
  const customerOpenOrders = Number(selectedCustomer?.open_order_value || 0);
  const overCredit = customerAvailableCredit != null && invoiceTotal > customerAvailableCredit;

  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const setLineProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    updateLine(key, {
      product_id: productId,
      allocations: null,
      ...priceFieldsFromProduct(product)
    });
  };

  const [preview, setPreview] = useState<Record<string, PreviewLine>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewBody = useMemo(() => {
    const items = lines
      .filter((l) => l.product_id && l.uom_id && Number(l.quantity) > 0)
      .map((l) => ({
        key: l.key,
        product_id: l.product_id,
        uom_id: l.uom_id,
        quantity: Number(l.quantity),
        warehouse_id: deferred && l.warehouse_id ? l.warehouse_id : undefined,
        allocations:
          deferred && l.allocations
            ? l.allocations.map((a) => ({ warehouse_id: a.warehouse_id, quantity: Number(a.quantity) || 0 }))
            : undefined
      }));
    return items.length
      ? JSON.stringify({
          branch_id: activeBranchId || undefined,
          fulfilment_mode: fulfilmentMode,
          warehouse_id: form.warehouse_id || undefined,
          items
        })
      : '';
  }, [lines, fulfilmentMode, form.warehouse_id, activeBranchId]);

  useEffect(() => {
    if (!previewBody) {
      setPreview({});
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.sales
        .allocationPreview(JSON.parse(previewBody))
        .then((res) => {
          if (cancelled) return;
          setPreview(Object.fromEntries((res.lines || []).map((l: PreviewLine) => [l.key, l])));
          setPreviewError(null);
        })
        .catch((err: any) => {
          if (!cancelled) setPreviewError(err.message || 'Could not plan stock allocation');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [previewBody]);

  const lineAllocated = (line: LineItem, p: PreviewLine, warehouseId: string) =>
    line.allocations
      ? line.allocations.find((a) => a.warehouse_id === warehouseId)?.quantity ?? ''
      : String(p.allocations.find((a) => a.warehouse_id === warehouseId)?.quantity ?? '');

  const setManualAllocation = (line: LineItem, p: PreviewLine, warehouseId: string, value: string) => {
    const current =
      line.allocations ??
      p.allocations.map((a) => ({ warehouse_id: a.warehouse_id, quantity: String(a.quantity) }));
    const next = current.some((a) => a.warehouse_id === warehouseId)
      ? current.map((a) => (a.warehouse_id === warehouseId ? { ...a, quantity: value } : a))
      : [...current, { warehouse_id: warehouseId, quantity: value }];
    updateLine(line.key, { allocations: next });
  };

  const shortLines = lines
    .map((l, idx) => ({ idx, line: l, p: preview[l.key] }))
    .filter((x) => x.p && x.p.shortage > 0);

  const setLineSellingPrice = (key: string, sellingPriceId: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    const sp = sellPriceOptionsForProduct(product).find((s) => s.id === sellingPriceId);
    updateLine(key, {
      selling_price_id: sellingPriceId,
      uom_id: sp?.uom_id || '',
      unit_price: sp?.unit_price || '0'
    });
  };

  const addLine = () => {
    setLines((rows) => [...rows, makeLine(products[0])]);
  };

  const removeLine = (key: string) => {
    setLines((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== key)));
  };

  const resetLines = (productList: any[]) => {
    setLines([makeLine(productList[0])]);
  };

  const load = async () => {
    const settled = await Promise.allSettled([
      api.customers.list(undefined, undefined, { includeWalkIn: true }),
      api.warehouses.list(activeBranchId || undefined),
      api.products.list(),
      api.salesReps.list(activeBranchId || undefined),
      api.sales.invoices(),
      api.salesReps.me(),
      api.sales.returns()
    ]);
    const value = <T,>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value as T) : fallback;

    const c = value<any[]>(0, []);
    const w = value<any[]>(1, []);
    const p = value<any[]>(2, []);
    const r = value<any[]>(3, []);
    const inv = value<any[]>(4, []);
    const meRep = value<any | null>(5, null);
    const rets = value<any[]>(6, []);
    const resolvedRepId = meRep?.id || user?.sales_rep?.id || '';
    const resolvedIsRep = Boolean(meRep?.id || user?.is_sales_rep || user?.sales_rep?.id);
    setMySalesRep(meRep?.id ? { id: meRep.id } : null);

    const visibleCustomers = resolvedIsRep ? c : c.filter((x) => !isWalkInCustomer(x));

    setCustomers(c);
    setWarehouses(w);
    setProducts(p);
    setReps(r);
    setInvoices(inv.filter((i: any) => i.channel !== 'pos'));
    setReturns(rets);

    const failed = settled
      .map((s, i) =>
        s.status === 'rejected'
          ? [
              'Customers',
              'Warehouses',
              'Products',
              'Sales reps',
              'Invoices',
              'My sales rep',
              'Returns'
            ][i]
          : null
      )
      .filter(Boolean);
    if (failed.length && !c.length && !w.length && !p.length) {
      await alertError('Sales', `Could not load: ${failed.join(', ')}`);
    } else if (failed.length) {
      console.warn('Sales partial load failures:', failed);
    }

    setForm((f) => {
      const nextCustomer =
        visibleCustomers.some((x) => x.id === f.customer_id)
          ? f.customer_id
          : visibleCustomers.find((x) => !isWalkInCustomer(x))?.id ||
            visibleCustomers[0]?.id ||
            '';
      const nextCustomerRow = visibleCustomers.find((x) => x.id === nextCustomer);
      const lockRep = isWalkInCustomer(nextCustomerRow) && resolvedIsRep && resolvedRepId;
      return {
        ...f,
        customer_id: nextCustomer,
        warehouse_id: w.some((x) => x.id === f.warehouse_id) ? f.warehouse_id : w[0]?.id || '',
        sales_rep_id: lockRep
          ? resolvedRepId
          : r.some((x) => x.id === f.sales_rep_id)
            ? f.sales_rep_id
            : ''
      };
    });

    setLines((rows) => {
      if (!rows.length) return [makeLine(p[0])];
      return rows.map((row) => {
        const product =
          p.find((x) => x.id === row.product_id) || p[0] || null;
        if (!product) return row;
        const options = sellPriceOptionsForProduct(product);
        const keepPrice = options.some((s) => s.id === row.selling_price_id);
        if (keepPrice && row.product_id === product.id) return row;
        return {
          ...row,
          product_id: product.id,
          ...priceFieldsFromProduct(product)
        };
      });
    });

  };

  useEffect(() => {
    setRevenueBranchId('');
    void load();
  }, [activeBranchId]);

  useEffect(() => {
    let cancelled = false;
    api.sales
      .fulfilmentOptions(lineProductKey ? lineProductKey.split(',') : [])
      .then((res) => {
        if (!cancelled) setFulfilOptions(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lineProductKey, activeBranchId]);

  const changeFulfilmentMode = (mode: FulfilmentMode) => {
    setFulfilmentMode(mode);
    if (mode === 'immediate') {
      setLines((rows) => rows.map((r) => ({ ...r, warehouse_id: '', allocations: null })));
      setForm((f) =>
        warehouses.some((w) => w.id === f.warehouse_id)
          ? f
          : { ...f, warehouse_id: warehouses[0]?.id || '' }
      );
    }
  };

  useEffect(() => {
    if (!salesRepLocked) return;
    setForm((f) => (f.sales_rep_id === mySalesRepId ? f : { ...f, sales_rep_id: mySalesRepId }));
  }, [salesRepLocked, mySalesRepId]);

  const createDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id || !form.warehouse_id) {
      await alertError('Create failed', 'Customer and warehouse are required');
      return;
    }
    const payloadItems = lines
      .filter((l) => l.product_id && l.uom_id && Number(l.quantity) > 0)
      .map((l) => ({
        product_id: l.product_id,
        uom_id: l.uom_id,
        selling_price_id: l.selling_price_id || undefined,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        warehouse_id: deferred && l.warehouse_id ? l.warehouse_id : undefined,
        allocations:
          deferred && l.allocations
            ? l.allocations
                .map((a) => ({ warehouse_id: a.warehouse_id, quantity: Number(a.quantity) || 0 }))
                .filter((a) => a.quantity > 0)
            : undefined
      }));
    if (!payloadItems.length) {
      await alertError('Create failed', 'Add at least one valid line item');
      return;
    }
    for (const [i, line] of lines.entries()) {
      if (!line.product_id) {
        await alertError('Create failed', `Line ${i + 1}: product is required`);
        return;
      }
      if (!line.uom_id || !line.selling_price_id) {
        await alertError('Create failed', `Line ${i + 1}: selling UoM is required`);
        return;
      }
      if (!(Number(line.quantity) > 0)) {
        await alertError('Create failed', `Line ${i + 1}: quantity must be greater than 0`);
        return;
      }
      if (!(Number(line.unit_price) >= 0)) {
        await alertError('Create failed', `Line ${i + 1}: unit price is invalid`);
        return;
      }
    }

    setBusy(true);
    try {
      await api.sales.createInvoice({
        customer_id: form.customer_id,
        warehouse_id: form.warehouse_id,
        sales_rep_id: form.sales_rep_id || undefined,
        notes: form.notes || undefined,
        fulfilment_mode: fulfilmentMode,
        ...(fulfilmentMode === 'delivery'
          ? {
              delivery_address: delivery.address || undefined,
              delivery_contact: delivery.contact || undefined,
              delivery_phone: delivery.phone || undefined
            }
          : {}),
        ...(fulfilmentMode === 'pickup' && collectors.trim()
          ? {
              authorised_collectors: collectors
                .split(';')
                .map((c) => {
                  const [name, phone] = c.split(',').map((s) => s.trim());
                  return { name, phone: phone || undefined };
                })
                .filter((c) => c.name)
            }
          : {}),
        revenue_branch_id:
          canChooseRevenueBranch && revenueBranchId && revenueBranchId !== activeBranchId
            ? revenueBranchId
            : undefined,
        items: payloadItems
      });
      await alertSuccess('Draft order created', 'Confirm it to reserve the stock.');
      setForm((f) => ({ ...f, notes: '' }));
      resetLines(products);
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const postInvoice = async (id: string, opts: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const posted = await api.sales.postInvoice(id, opts);
      if (posted?.fulfilment_mode === 'pickup') {
        await Swal.fire({
          icon: 'success',
          title: 'Order confirmed — stock reserved',
          html:
            `Give the customer this pickup code:<div class="pickup-code">${posted.pickup_code || '—'}</div>` +
            'The warehouse will ask for it at collection. Revenue, receivable and cost of goods post as the customer collects; any payment taken now is held as a deposit.',
          confirmButtonColor: '#0f5c4c'
        });
      } else {
        await alertSuccess(
          posted?.fulfilment_mode === 'delivery' ? 'Order confirmed — stock reserved for delivery' : 'Sale confirmed and handed over',
          posted?.fulfilment_mode === 'delivery'
            ? 'The warehouse will pick and dispatch it. Revenue posts when delivery is confirmed.'
            : undefined
        );
      }
      await load();
      return true;
    } catch (err: any) {
      const msg = String(err.message || '');
      const isPickup = ['pickup', 'delivery'].includes(invoices.find((i) => i.id === id)?.fulfilment_mode);
      if (/insufficient sellable stock/i.test(msg) && isPickup && !opts.allow_backorder) {
        const r = await Swal.fire({
          icon: 'warning',
          title: 'Not enough stock',
          text: `${msg} Confirm anyway and backorder the shortfall?`,
          showCancelButton: true,
          confirmButtonText: 'Confirm with backorder',
          confirmButtonColor: '#0f5c4c'
        });
        return r.isConfirmed ? postInvoice(id, { ...opts, allow_backorder: true }) : false;
      }
      if (/credit limit exceeded/i.test(msg) && can('sales.override_credit_limit') && !opts.override_credit) {
        const r = await Swal.fire({
          icon: 'warning',
          title: 'Credit limit exceeded',
          text: msg,
          input: 'text',
          inputLabel: 'Reason for overriding the limit',
          inputValidator: (v) => (String(v || '').trim() ? undefined : 'A reason is required'),
          showCancelButton: true,
          confirmButtonText: 'Override and confirm',
          confirmButtonColor: '#0f5c4c'
        });
        return r.isConfirmed
          ? postInvoice(id, { ...opts, override_credit: true, override_reason: String(r.value).trim() })
          : false;
      }
      await alertError('Confirm failed', msg);
      return false;
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Sales
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Draft order → confirm (reserves stock and credit) → hand over (revenue, receivable and cost of
          goods post per collection) → collect payment. Walk-in cash stays in custody until Finance retires
          it.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className={`btn ${tab === 'invoices' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('invoices')}
        >
          Invoices
        </button>
        <button
          type="button"
          className={`btn ${tab === 'payments' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('payments')}
        >
          Payments
        </button>
        <button
          type="button"
          className={`btn ${tab === 'returns' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('returns')}
        >
          Returns
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'invoices' ? (
        <>
          <form
            onSubmit={createDraft}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New credit / account invoice</div>

            <div className="fulfil-mode">
              <div className="segmented" role="tablist" aria-label="Hand-over">
                {(
                  [
                    ['immediate', 'Collect now'],
                    ['pickup', 'Pickup later'],
                    ['delivery', 'Deliver']
                  ] as [FulfilmentMode, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`segmented__btn${fulfilmentMode === id ? ' is-active' : ''}`}
                    onClick={() => changeFulfilmentMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="fulfil-mode__hint">
                {fulfilmentMode === 'delivery'
                  ? 'Confirming reserves stock in any branch. The warehouse picks and dispatches it; revenue and cost of goods post when delivery is confirmed with proof of delivery.'
                  : deferred
                    ? 'Confirming reserves stock — split across warehouses in any branch if needed — and issues the customer a pickup code. Revenue and cost of goods post as each part is collected.'
                    : 'Goods leave this branch’s warehouses when the sale is confirmed; revenue posts at the same time.'}
                {otherBranchPickup
                  ? ' Some lines are collected from another branch; that branch’s inventory is settled through inter-branch clearing.'
                  : ''}
              </span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Customer</label>
                <SearchSelect
                  value={form.customer_id}
                  options={customerOptions}
                  required
                  placeholder="Search customer…"
                  onChange={(nextId) => {
                    const next = selectableCustomers.find((c) => c.id === nextId);
                    const lockRep = isWalkInCustomer(next) && isSalesRep && mySalesRepId;
                    setForm({
                      ...form,
                      customer_id: nextId,
                      sales_rep_id: lockRep ? mySalesRepId : form.sales_rep_id
                    });
                  }}
                />
                {selectedCustomer &&
                (customerDiscountPct > 0 || customerCreditLimit != null) ? (
                  <div className="customer-terms">
                    {customerDiscountPct > 0 ? (
                      <span className="branch-pricing__badge branch-pricing__badge--discount">
                        −{customerDiscountPct}% customer discount
                      </span>
                    ) : null}
                    {customerAvailableCredit != null ? (
                      <span className={overCredit ? 'customer-terms__over' : undefined}>
                        Credit available {fmtMoney(Math.max(0, customerAvailableCredit))}
                        {customerOpenOrders > 0 ? ` (after ${fmtMoney(customerOpenOrders)} in open orders)` : ''}
                        {overCredit ? ' — this order exceeds it, so confirming on credit will be blocked' : ''}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>
                  {fulfilmentMode === 'delivery' ? 'Ship from warehouse' : deferred ? 'Default pickup warehouse' : 'Warehouse'}
                </label>
                <SearchSelect
                  value={form.warehouse_id}
                  options={warehouseOptions}
                  required
                  placeholder="Search warehouse…"
                  onChange={(warehouse_id) => setForm({ ...form, warehouse_id })}
                />
              </div>
              {canChooseRevenueBranch ? (
                <div className="field">
                  <label>Revenue branch</label>
                  <select
                    value={revenueBranchId || activeBranchId || ''}
                    onChange={(e) => setRevenueBranchId(e.target.value)}
                  >
                    {fulfilOptions.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.id === activeBranchId ? ' (selling branch)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  Sales rep
                  <button
                    type="button"
                    aria-label="Sales rep help"
                    onClick={() =>
                      void Swal.fire({
                        icon: 'info',
                        title: 'Sales rep',
                        text: salesRepLocked
                          ? 'Walk-in sales are locked to the logged-in sales representative and cannot be changed.'
                          : 'Optional. Choose a sales representative for this invoice when selling to account customers.',
                        confirmButtonColor: '#0f5c4c'
                      })
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      color: 'var(--ink-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    <Info size={15} />
                  </button>
                </label>
                <SearchSelect
                  value={form.sales_rep_id}
                  options={salesRepOptions}
                  disabled={salesRepLocked}
                  required={salesRepLocked}
                  allowEmpty={!salesRepLocked}
                  placeholder="Search sales rep…"
                  onChange={(sales_rep_id) => setForm({ ...form, sales_rep_id })}
                />
              </div>
            </div>

            {fulfilmentMode === 'delivery' ? (
              <div className="form-grid">
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Delivery address</label>
                  <input
                    value={delivery.address}
                    onChange={(e) => setDelivery({ ...delivery, address: e.target.value })}
                    placeholder={
                      [selectedCustomer?.address_line1, selectedCustomer?.city].filter(Boolean).join(', ') ||
                      'Street, area, city'
                    }
                  />
                </div>
                <div className="field">
                  <label>Receiving contact</label>
                  <input
                    value={delivery.contact}
                    onChange={(e) => setDelivery({ ...delivery, contact: e.target.value })}
                    placeholder={selectedCustomer?.name || 'Name'}
                  />
                </div>
                <div className="field">
                  <label>Contact phone</label>
                  <input
                    value={delivery.phone}
                    onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })}
                    placeholder={selectedCustomer?.phone || ''}
                  />
                </div>
              </div>
            ) : null}
            {fulfilmentMode === 'pickup' ? (
              <div className="field">
                <label>Others allowed to collect (optional)</label>
                <input
                  value={collectors}
                  onChange={(e) => setCollectors(e.target.value)}
                  placeholder="Name, phone; Name, phone"
                />
              </div>
            ) : null}

            <div className="line-items">
             <div className="line-items__scroll">
              <table className="line-items__table">
                <thead>
                  <tr>
                    <th className="line-items__index">#</th>
                    <th className="line-items__col-product">Product</th>
                    <th className="line-items__col-uom">Selling UoM</th>
                    <th className="line-items__col-qty" style={{ textAlign: 'center' }}>
                      Qty
                    </th>
                    <th className="num line-items__col-price">Unit price</th>
                    <th className="num line-items__col-subtotal">Subtotal</th>
                    {deferred ? <th className="line-items__col-pickup">Pickup from</th> : null}
                    <th className="line-items__col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const product = products.find((p) => p.id === line.product_id);
                    const sellOptions = sellPriceOptionsForProduct(product);
                    return (
                      <tr key={line.key}>
                        <td className="line-items__index">{index + 1}</td>
                        <td>
                          <SearchSelect
                            value={line.product_id}
                            options={productOptions}
                            required
                            placeholder="Search product…"
                            onChange={(productId) => setLineProduct(line.key, productId)}
                          />
                        </td>
                        <td>
                          <select
                            value={line.selling_price_id}
                            onChange={(e) =>
                              setLineSellingPrice(line.key, e.target.value, line.product_id)
                            }
                            required
                            disabled={!product || sellOptions.length === 0}
                          >
                            {sellOptions.length === 0 ? (
                              <option value="">No selling prices</option>
                            ) : null}
                            {sellOptions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.code}
                                {s.name ? ` — ${s.name}` : ''}
                                {s.price_level ? ` · ${s.price_level}` : ''}
                                {` · ${s.unit_price}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="line-items__col-qty">
                          <input
                            type="number"
                            min="0.00"
                            step="1"
                            className="line-items__qty"
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(line.key, { quantity: e.target.value, allocations: null })
                            }
                            required
                          />
                        </td>
                        <td className="line-items__col-price">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className="line-items__price"
                            value={line.unit_price}
                            onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                            readOnly={!canChangePrice}
                            title={
                              canChangePrice
                                ? undefined
                                : 'Price is set by the selected UoM. You need the "change price" privilege to edit it.'
                            }
                            required
                          />
                          {(() => {
                            const pct = product?.branch_discount_percent;
                            const sp = (product?.selling_prices || []).find(
                              (s: any) => s.id === line.selling_price_id
                            );
                            if (!pct || !sp) return null;
                            return (
                              <div className="line-items__discount-note">
                                −{Number(pct)}% branch discount · was{' '}
                                {Number(sp.pre_discount_unit_price).toLocaleString()}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="num line-items__subtotal">
                          {lineSubtotal(line).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </td>
                        {deferred ? (
                          <td>
                            <select
                              value={line.warehouse_id}
                              onChange={(e) =>
                                updateLine(line.key, { warehouse_id: e.target.value, allocations: null })
                              }
                            >
                              <option value="">
                                Default
                                {warehouseById.get(form.warehouse_id)
                                  ? ` (${warehouseById.get(form.warehouse_id)!.code})`
                                  : ''}
                              </option>
                              {fulfilOptions.warehouses.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.branch?.name} · {w.code}
                                  {line.product_id
                                    ? ` — ${freeStock(line.product_id, w.id).toLocaleString()} free`
                                    : ''}
                                </option>
                              ))}
                            </select>
                            {line.product_id ? (
                              <div className="line-items__discount-note">
                                {freeStock(line.product_id, line.warehouse_id || form.warehouse_id).toLocaleString()}{' '}
                                {product?.base_uom?.code || 'base units'} free here
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="line-items__remove"
                            aria-label={`Remove line ${index + 1}`}
                            title="Remove line"
                            disabled={lines.length <= 1}
                            onClick={() => removeLine(line.key)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
             </div>
              <div className="line-items__footer">
                <button type="button" className="line-items__add" onClick={addLine}>
                  <Plus size={16} />
                  Add line
                </button>
                <div className="line-items__totals">
                  {customerDiscountPct > 0 ? (
                    <>
                      <div className="line-items__total line-items__total--muted">
                        <span className="line-items__total-label">Subtotal</span>
                        <span className="line-items__total-value">{fmtMoney(invoiceSubtotal)}</span>
                      </div>
                      <div className="line-items__total line-items__total--muted">
                        <span className="line-items__total-label">
                          Customer discount −{customerDiscountPct}%
                        </span>
                        <span className="line-items__total-value">
                          −{fmtMoney(customerDiscountAmount)}
                        </span>
                      </div>
                    </>
                  ) : null}
                  <div className="line-items__total">
                    <span className="line-items__total-label">
                      {customerDiscountPct > 0 ? 'Invoice total' : 'Invoice subtotal'}
                    </span>
                    <span className="line-items__total-value">{fmtMoney(invoiceTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {fulfilmentMode === 'immediate' && shortLines.length ? (
              <div className="pickups__warning">
                Not enough free stock in this branch:{' '}
                {shortLines.map((s) => `line ${s.idx + 1} short ${qtyLabel(s.p.shortage)}`).join(', ')}.
                Choose “Pickup later” to fulfil from another branch’s warehouse.
              </div>
            ) : null}

            {deferred && Object.keys(preview).length ? (
              <div className="alloc">
                <div className="alloc__head">
                  <span className="alloc__title">Stock allocation</span>
                  <span className="alloc__hint">
                    Suggested split by free stock (default warehouse first, then its branch, then elsewhere).
                    Edit a quantity to choose the warehouses yourself.
                  </span>
                </div>
                {lines.map((line, idx) => {
                  const p = preview[line.key];
                  if (!p) return null;
                  const product = products.find((x) => x.id === line.product_id);
                  const rows = p.stock.filter(
                    (s) => s.free > 0 || Number(lineAllocated(line, p, s.warehouse_id)) > 0
                  );
                  const manualTotal = line.allocations
                    ? line.allocations.reduce((s, a) => s + (Number(a.quantity) || 0), 0)
                    : null;
                  return (
                    <div className="alloc__line" key={line.key}>
                      <div className="alloc__line-head">
                        <span>
                          Line {idx + 1} · <strong>{product?.name}</strong> — {qtyLabel(p.requested)} ordered
                        </span>
                        {p.shortage > 0 ? (
                          <span className="invoice-chip invoice-chip--pending">
                            {qtyLabel(p.shortage)} short — backorder at confirmation
                          </span>
                        ) : (
                          <span className="invoice-chip invoice-chip--fulfilled">fully allocated</span>
                        )}
                        {line.allocations ? (
                          <>
                            <span className="invoice-chip invoice-chip--open">manual</span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => updateLine(line.key, { allocations: null })}
                            >
                              Use automatic
                            </button>
                          </>
                        ) : null}
                      </div>
                      {rows.length ? (
                        <table className="alloc__table">
                          <thead>
                            <tr>
                              <th>Warehouse</th>
                              <th className="num">Free</th>
                              <th className="num" style={{ width: 120 }}>
                                Allocate
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((s) => (
                              <tr key={s.warehouse_id}>
                                <td>
                                  {s.branch_name} · {s.warehouse_code}
                                  <span className="alloc__sub"> {s.warehouse_name}</span>
                                </td>
                                <td className="num">{qtyLabel(s.free)}</td>
                                <td className="num">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    className="line-items__qty"
                                    value={lineAllocated(line, p, s.warehouse_id)}
                                    onChange={(e) => setManualAllocation(line, p, s.warehouse_id, e.target.value)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="alloc__sub">No sellable stock anywhere — the whole line will be backordered.</div>
                      )}
                      {manualTotal != null && manualTotal > Number(line.quantity) ? (
                        <div className="customer-terms__over">
                          Allocated {qtyLabel(manualTotal)} is more than the {qtyLabel(line.quantity)} ordered.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {previewError ? <div className="pickups__warning">{previewError}</div> : null}
              </div>
            ) : null}

            <div className="field">
              <label>Notes (optional)</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="One note for the whole invoice"
              />
            </div>

            <button
              className="btn btn-primary"
              type="submit"
              style={{ justifySelf: 'start' }}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create draft order'}
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Lines</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Hand-over</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Rep</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <button
                          type="button"
                          className="invoice-link"
                          onClick={() => setViewInvoiceId(inv.id)}
                        >
                          {inv.invoice_number}
                        </button>
                      </td>
                      <td>{inv.customer?.name}</td>
                      <td>{(inv.items || []).length || '—'}</td>
                      <td>{STATUS_LABELS[inv.status] || inv.status}</td>
                      <td>
                        {inv.payment_status}
                        {Number(inv.deposit_held) > 0 ? (
                          <div className="line-items__discount-note">
                            deposit {Number(inv.deposit_held).toLocaleString()}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {inv.status !== 'posted' ? (
                          inv.fulfilment_mode === 'pickup' ? 'Pickup' : inv.fulfilment_mode === 'delivery' ? 'Delivery' : '—'
                        ) : (
                          <span className={`invoice-chip invoice-chip--${inv.fulfilment_status}`}>
                            {(inv.fulfilment_mode === 'delivery' ? DELIVERY_LABELS : FULFILMENT_LABELS)[inv.fulfilment_status] ||
                              inv.fulfilment_status}
                          </span>
                        )}
                        {inv.branch_id && inv.selling_branch_id && inv.branch_id !== inv.selling_branch_id ? (
                          <div className="line-items__discount-note">
                            {inv.selling_branch_id === activeBranchId
                              ? `Revenue → ${inv.branch?.name}`
                              : `Sold by ${inv.selling_branch?.name}`}
                          </div>
                        ) : null}
                      </td>
                      <td>{Number(inv.total_amount).toLocaleString()}</td>
                      <td>{Number(inv.balance).toLocaleString()}</td>
                      <td>{inv.sales_rep?.name || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setViewInvoiceId(inv.id)}
                          >
                            <Eye size={15} /> View
                          </button>
                          {inv.status === 'draft' && canPostInvoice ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void postInvoice(inv.id)}
                            >
                              Confirm
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'payments' ? (
        <ReceiveCustomerPayment
          customers={selectableCustomers}
          historyScope="all"
          onDone={() => void load()}
        />
      ) : null}

      {tab === 'returns' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>
            Returns of goods already handed over. Open an invoice and use <strong>Return goods</strong>, or review
            posted returns below.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Return #</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Warehouse</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                  <th>Settlement</th>
                </tr>
              </thead>
              <tbody>
                {returns.length ? (
                  returns.map((r) => (
                    <tr key={r.id}>
                      <td>{r.return_number}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-linkish"
                          onClick={() => setViewInvoiceId(r.invoice_id || r.invoice?.id)}
                        >
                          {r.invoice?.invoice_number || '—'}
                        </button>
                      </td>
                      <td>{r.customer?.name}</td>
                      <td>
                        {r.warehouse?.code || r.warehouse?.name}
                        {r.branch?.name ? ` · ${r.branch.name}` : ''}
                      </td>
                      <td>{r.status}</td>
                      <td className="num">{Number(r.total_amount || 0).toLocaleString()}</td>
                      <td>
                        {r.settlement === 'refund'
                          ? `refund ${Number(r.refund_amount || 0).toLocaleString()}`
                          : Number(r.credit_issued) > 0
                            ? `credit ${Number(r.credit_issued).toLocaleString()}`
                            : r.settlement || '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                      No returns yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {viewInvoiceId ? (
        <InvoiceViewModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
          onPost={(id) => postInvoice(id)}
          canPost={canPostInvoice}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
};
