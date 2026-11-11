import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { SearchSelect } from '../components/SearchSelect';

type Tab = 'invoices' | 'payments';

function isWalkInCustomer(c: any) {
  return (
    c?.customer_type === 'walk_in' ||
    String(c?.code || '').toUpperCase() === 'WALK-IN'
  );
}

export const SalesPage: React.FC = () => {
  const { activeBranchId, user } = useAuth();
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

  const [form, setForm] = useState({
    customer_id: '',
    warehouse_id: '',
    sales_rep_id: '',
    product_id: '',
    selling_price_id: '',
    uom_id: '',
    quantity: '1',
    unit_price: '',
    notes: ''
  });

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

  const sellingPricesForProduct = (p: any) =>
    ((p?.selling_prices || []) as any[]).filter((s) => s && s.is_active !== false);

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

  /** Selling UoM choices come from ProductSellingPrice for the selected product. */
  const sellPriceOptionsForProduct = (p: any): SellPriceOption[] =>
    sellingPricesForProduct(p)
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
          unit_price: String(sp.unit_price ?? 0),
          is_default: Boolean(sp.is_default)
        } as SellPriceOption;
      })
      .filter(Boolean) as SellPriceOption[];

  const defaultSellPrice = (p: any): SellPriceOption | null => {
    const rows = sellPriceOptionsForProduct(p);
    if (!rows.length) return null;
    return (
      rows.find((s) => s.is_default) ||
      rows.find((s) => s.uom_id === (p?.selling_uom_id || p?.selling_uom?.id)) ||
      rows[0]
    );
  };

  const priceFieldsFromProduct = (p: any) => {
    const sp = defaultSellPrice(p);
    return {
      selling_price_id: sp?.id || '',
      uom_id: sp?.uom_id || '',
      unit_price: sp?.unit_price || '0'
    };
  };

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === form.product_id),
    [products, form.product_id]
  );
  const sellPriceOptions = useMemo(
    () => sellPriceOptionsForProduct(selectedProduct),
    [selectedProduct]
  );

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

    const product = p[0];
    const priced = priceFieldsFromProduct(product);
    setForm((f) => {
      const nextCustomer =
        visibleCustomers.some((x) => x.id === f.customer_id)
          ? f.customer_id
          : visibleCustomers.find((x) => !isWalkInCustomer(x))?.id ||
            visibleCustomers[0]?.id ||
            '';
      const nextCustomerRow = visibleCustomers.find((x) => x.id === nextCustomer);
      const lockRep = isWalkInCustomer(nextCustomerRow) && resolvedIsRep && resolvedRepId;
      const keepProduct = f.product_id || product?.id || '';
      const keepProductRow = p.find((x) => x.id === keepProduct) || product;
      const keepPriced = priceFieldsFromProduct(keepProductRow);
      const keepPrice =
        f.selling_price_id &&
        sellPriceOptionsForProduct(keepProductRow).some((s) => s.id === f.selling_price_id);
      return {
        ...f,
        customer_id: nextCustomer,
        warehouse_id: w.some((x) => x.id === f.warehouse_id) ? f.warehouse_id : w[0]?.id || '',
        sales_rep_id: lockRep
          ? resolvedRepId
          : r.some((x) => x.id === f.sales_rep_id)
            ? f.sales_rep_id
            : '',
        product_id: keepProduct,
        selling_price_id: keepPrice ? f.selling_price_id : keepPriced.selling_price_id || priced.selling_price_id,
        uom_id: keepPrice ? f.uom_id : keepPriced.uom_id || priced.uom_id,
        unit_price: keepPrice
          ? f.unit_price || keepPriced.unit_price
          : keepPriced.unit_price || priced.unit_price
      };
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

  useEffect(() => {
    if (!selectedProduct) return;
    const allowed = new Set(sellPriceOptions.map((s) => s.id));
    if (!form.selling_price_id || !allowed.has(form.selling_price_id)) {
      const priced = priceFieldsFromProduct(selectedProduct);
      setForm((f) => ({
        ...f,
        ...priced
      }));
    }
  }, [selectedProduct, sellPriceOptions.map((s) => s.id).join('|')]);

  const createDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.sales.createInvoice({
        customer_id: form.customer_id,
        warehouse_id: form.warehouse_id,
        sales_rep_id: form.sales_rep_id || undefined,
        notes: form.notes || undefined,
        items: [
          {
            product_id: form.product_id,
            uom_id: form.uom_id,
            quantity: Number(form.quantity),
            unit_price: Number(form.unit_price)
          }
        ]
      });
      await alertSuccess('Draft invoice created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const postInvoice = async (id: string) => {
    try {
      await api.sales.postInvoice(id);
      await alertSuccess('Invoice posted — stock + AR + COGS');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
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
              <div className="field">
                <label>Product</label>
                <SearchSelect
                  value={form.product_id}
                  options={productOptions}
                  required
                  placeholder="Search product…"
                  onChange={(product_id) => {
                    const p = products.find((x) => x.id === product_id);
                    setForm({
                      ...form,
                      product_id,
                      ...priceFieldsFromProduct(p)
                    });
                  }}
                />
              </div>
              <div className="field">
                <label>Selling UoM</label>
                <select
                  value={form.selling_price_id}
                  onChange={(e) => {
                    const sp = sellPriceOptions.find((s) => s.id === e.target.value);
                    setForm({
                      ...form,
                      selling_price_id: e.target.value,
                      uom_id: sp?.uom_id || '',
                      unit_price: sp?.unit_price || '0'
                    });
                  }}
                  required
                  disabled={!selectedProduct || sellPriceOptions.length === 0}
                >
                  {sellPriceOptions.length === 0 ? (
                    <option value="">No selling prices for product</option>
                  ) : null}
                  {sellPriceOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                      {s.name ? ` — ${s.name}` : ''}
                      {s.price_level ? ` · ${s.price_level}` : ''}
                      {s.label ? ` (${s.label})` : ''}
                      {` · ${s.unit_price}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Quantity</label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Unit price</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Create draft invoice
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
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
                    <td>{inv.invoice_number}</td>
                    <td>{inv.customer?.name}</td>
                    <td>{inv.status}</td>
                    <td>{inv.payment_status}</td>
                    <td>{Number(inv.total_amount).toLocaleString()}</td>
                    <td>{Number(inv.balance).toLocaleString()}</td>
                    <td>{inv.sales_rep?.name || '—'}</td>
                    <td>
                      {inv.status === 'draft' ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void postInvoice(inv.id)}
                        >
                          Post
                        </button>
                      ) : null}
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
    </div>
  );
};
