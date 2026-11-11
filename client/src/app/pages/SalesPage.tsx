import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Info, Plus, Trash2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { SearchSelect } from '../components/SearchSelect';
import { InvoiceViewModal } from '../components/InvoiceViewModal';

type Tab = 'invoices' | 'payments';

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
};

function isWalkInCustomer(c: any) {
  return (
    c?.customer_type === 'walk_in' ||
    String(c?.code || '').toUpperCase() === 'WALK-IN'
  );
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
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
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
  const [payments, setPayments] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    customer_id: '',
    warehouse_id: '',
    sales_rep_id: '',
    notes: ''
  });
  const [lines, setLines] = useState<LineItem[]>([makeLine()]);

  const [payForm, setPayForm] = useState({
    customer_id: '',
    amount: '',
    method: 'cash',
    reference: ''
  });

  const selectableCustomers = useMemo(
    () => (isSalesRep ? customers : customers.filter((c) => !isWalkInCustomer(c))),
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
  const warehouseOptions = useMemo(
    () => warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    [warehouses]
  );
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

  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const setLineProduct = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    updateLine(key, {
      product_id: productId,
      ...priceFieldsFromProduct(product)
    });
  };

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
      api.customers.list(),
      api.warehouses.list(activeBranchId || undefined),
      api.products.list(),
      api.salesReps.list(activeBranchId || undefined),
      api.sales.invoices(),
      api.sales.payments(),
      api.salesReps.me()
    ]);
    const value = <T,>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value as T) : fallback;

    const c = value<any[]>(0, []);
    const w = value<any[]>(1, []);
    const p = value<any[]>(2, []);
    const r = value<any[]>(3, []);
    const inv = value<any[]>(4, []);
    const pay = value<any[]>(5, []);
    const meRep = value<any | null>(6, null);
    const resolvedRepId = meRep?.id || user?.sales_rep?.id || '';
    const resolvedIsRep = Boolean(meRep?.id || user?.is_sales_rep || user?.sales_rep?.id);
    setMySalesRep(meRep?.id ? { id: meRep.id } : null);

    const visibleCustomers = resolvedIsRep ? c : c.filter((x) => !isWalkInCustomer(x));

    setCustomers(c);
    setWarehouses(w);
    setProducts(p);
    setReps(r);
    setInvoices(inv.filter((i: any) => i.channel !== 'pos'));
    setPayments(pay);

    const failed = settled
      .map((s, i) =>
        s.status === 'rejected'
          ? ['Customers', 'Warehouses', 'Products', 'Sales reps', 'Invoices', 'Payments', 'My sales rep'][
              i
            ]
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

    setPayForm((f) => ({
      ...f,
      customer_id:
        visibleCustomers.some((x) => x.id === f.customer_id)
          ? f.customer_id
          : visibleCustomers[0]?.id || ''
    }));
  };

  useEffect(() => {
    void load();
  }, [activeBranchId]);

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
        unit_price: Number(l.unit_price)
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
        items: payloadItems
      });
      await alertSuccess('Draft invoice created');
      setForm((f) => ({ ...f, notes: '' }));
      resetLines(products);
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const postInvoice = async (id: string) => {
    try {
      await api.sales.postInvoice(id);
      await alertSuccess('Invoice posted — stock + AR + COGS');
      await load();
      return true;
    } catch (err: any) {
      await alertError('Post failed', err.message);
      return false;
    }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.sales.recordPayment({
        customer_id: payForm.customer_id,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined
      });
      await alertSuccess('Customer payment recorded');
      setPayForm((f) => ({ ...f, amount: '', reference: '' }));
      await load();
    } catch (err: any) {
      await alertError('Payment failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Sales
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Draft invoice → post (FEFO stock out, AR, COGS) → collect payment.
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
              </div>
              <div className="field">
                <label>Warehouse</label>
                <SearchSelect
                  value={form.warehouse_id}
                  options={warehouseOptions}
                  required
                  placeholder="Search warehouse…"
                  onChange={(warehouse_id) => setForm({ ...form, warehouse_id })}
                />
              </div>
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

            <div className="line-items">
             <div className="line-items__scroll">
              <table className="line-items__table">
                <thead>
                  <tr>
                    <th className="line-items__index">#</th>
                    <th style={{ width: '32%' }}>Product</th>
                    <th style={{ width: '26%' }}>Selling UoM</th>
                    <th style={{ width: 100, textAlign: 'center' }}>Qty</th>
                    <th className="num" style={{ width: 130 }}>Unit price</th>
                    <th className="num" style={{ width: 130 }}>Subtotal</th>
                    <th style={{ width: 52 }} />
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
                        <td>
                          <input
                            type="number"
                            min="0.00"
                            step="1"
                            className="line-items__qty"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                            required
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className="line-items__qty"
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
                <div className="line-items__total">
                  <span className="line-items__total-label">Invoice subtotal</span>
                  <span className="line-items__total-value">
                    {invoiceSubtotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                </div>
              </div>
            </div>

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
              {busy ? 'Creating…' : 'Create draft invoice'}
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
                      <td>{inv.status}</td>
                      <td>{inv.payment_status}</td>
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
                              Post
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
        <>
          <form
            onSubmit={pay}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Record customer payment</div>
            <div className="form-grid">
              <div className="field">
                <label>Customer</label>
                <select
                  value={payForm.customer_id}
                  onChange={(e) => setPayForm({ ...payForm, customer_id: e.target.value })}
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Method</label>
                <select
                  value={payForm.method}
                  onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div className="field">
                <label>Reference</label>
                <input
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Post payment
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Allocations</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.payment_number}</td>
                      <td>{p.customer?.name}</td>
                      <td>{Number(p.amount).toLocaleString()}</td>
                      <td>{p.method}</td>
                      <td>
                        {(p.allocations || [])
                          .map(
                            (a: any) =>
                              `${a.invoice?.invoice_number}: ${Number(a.amount).toLocaleString()}`
                          )
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {viewInvoiceId ? (
        <InvoiceViewModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
          onPost={postInvoice}
          canPost={canPostInvoice}
        />
      ) : null}
    </div>
  );
};
