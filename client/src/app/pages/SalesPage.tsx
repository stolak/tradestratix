import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'invoices' | 'payments';

export const SalesPage: React.FC = () => {
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

  const uomsForProduct = (p: any) => {
    if (!p) return [] as { id: string; code: string; name: string }[];
    const map = new Map<string, { id: string; code: string; name: string }>();
    const add = (u?: any) => {
      if (!u?.id) return;
      map.set(u.id, { id: u.id, code: u.code, name: u.name });
    };
    add(p.base_uom);
    add(p.selling_uom);
    for (const c of p.conversions || []) add(c.from_uom);
    return [...map.values()];
  };

  const defaultSellUomId = (p: any) =>
    p?.selling_uom_id || p?.selling_uom?.id || p?.base_uom_id || p?.base_uom?.id || '';

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === form.product_id),
    [products, form.product_id]
  );
  const sellUoms = useMemo(() => uomsForProduct(selectedProduct), [selectedProduct]);

  const defaultPrice = (p: any, uomId: string) => {
    if (!p) return '0';
    const sp = (p.selling_prices || []).find(
      (s: any) => (s.uom_id || s.uom?.id) === uomId && s.is_default
    );
    if (sp) return String(sp.unit_price ?? 0);
    const any = (p.selling_prices || []).find((s: any) => (s.uom_id || s.uom?.id) === uomId);
    if (any) return String(any.unit_price ?? 0);
    return String(p.default_selling_price ?? 0);
  };

  const load = async () => {
    const settled = await Promise.allSettled([
      api.customers.list(),
      api.warehouses.list(),
      api.products.list(),
      api.salesReps.list(),
      api.sales.invoices(),
      api.sales.payments()
    ]);
    const value = <T,>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value as T) : fallback;

    const c = value<any[]>(0, []);
    const w = value<any[]>(1, []);
    const p = value<any[]>(2, []);
    const r = value<any[]>(3, []);
    const inv = value<any[]>(4, []);
    const pay = value<any[]>(5, []);

    setCustomers(c);
    setWarehouses(w);
    setProducts(p);
    setReps(r);
    setInvoices(inv.filter((i: any) => i.channel !== 'pos'));
    setPayments(pay);

    const failed = settled
      .map((s, i) =>
        s.status === 'rejected'
          ? ['Customers', 'Warehouses', 'Products', 'Sales reps', 'Invoices', 'Payments'][i]
          : null
      )
      .filter(Boolean);
    if (failed.length && !c.length && !w.length && !p.length) {
      await alertError('Sales', `Could not load: ${failed.join(', ')}`);
    } else if (failed.length) {
      console.warn('Sales partial load failures:', failed);
    }

    const product = p[0];
    const uom = defaultSellUomId(product);
    setForm((f) => ({
      ...f,
      customer_id:
        f.customer_id || c.find((x: any) => x.customer_type !== 'walk_in')?.id || c[0]?.id || '',
      warehouse_id: f.warehouse_id || w[0]?.id || '',
      product_id: f.product_id || product?.id || '',
      uom_id: f.uom_id || uom,
      unit_price: f.unit_price || defaultPrice(product, uom)
    }));
    setPayForm((f) => ({
      ...f,
      customer_id: f.customer_id || c[0]?.id || ''
    }));
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const allowed = new Set(sellUoms.map((u) => u.id));
    if (!form.uom_id || !allowed.has(form.uom_id)) {
      const uom = defaultSellUomId(selectedProduct);
      setForm((f) => ({
        ...f,
        uom_id: uom,
        unit_price: defaultPrice(selectedProduct, uom)
      }));
    }
  }, [selectedProduct, sellUoms.map((u) => u.id).join('|')]);

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
                <select
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
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
                <label>Warehouse</label>
                <select
                  value={form.warehouse_id}
                  onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                  required
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Sales rep (optional)</label>
                <select
                  value={form.sales_rep_id}
                  onChange={(e) => setForm({ ...form, sales_rep_id: e.target.value })}
                >
                  <option value="">—</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({Number(r.commission_percent)}%)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Product</label>
                <select
                  value={form.product_id}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    const uom = defaultSellUomId(p);
                    setForm({
                      ...form,
                      product_id: e.target.value,
                      uom_id: uom,
                      unit_price: defaultPrice(p, uom)
                    });
                  }}
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Selling UoM</label>
                <select
                  value={form.uom_id}
                  onChange={(e) => {
                    const uom = e.target.value;
                    setForm({
                      ...form,
                      uom_id: uom,
                      unit_price: defaultPrice(selectedProduct, uom)
                    });
                  }}
                  required
                >
                  {sellUoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
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
