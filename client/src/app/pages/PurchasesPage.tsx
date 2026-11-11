import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'orders' | 'receive' | 'bills' | 'payments';

export const PurchasesPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('orders');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

  const [poForm, setPoForm] = useState({
    supplier_id: '',
    warehouse_id: '',
    notes: '',
    product_id: '',
    uom_id: '',
    quantity: '24',
    unit_cost: ''
  });

  /** Base + purchase + packaging conversion UoMs for a product. */
  const uomsForProduct = (p: any) => {
    if (!p) return [] as { id: string; code: string; name: string }[];
    const map = new Map<string, { id: string; code: string; name: string }>();
    const add = (u?: any) => {
      if (!u?.id) return;
      map.set(u.id, { id: u.id, code: u.code, name: u.name });
    };
    add(p.base_uom);
    add(p.purchase_uom);
    for (const c of p.conversions || []) add(c.from_uom);
    return [...map.values()];
  };

  const defaultPurchaseUomId = (p: any) =>
    p?.purchase_uom_id || p?.purchase_uom?.id || p?.base_uom_id || p?.base_uom?.id || '';

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === poForm.product_id),
    [products, poForm.product_id]
  );

  const purchaseUoms = useMemo(() => uomsForProduct(selectedProduct), [selectedProduct]);

  const [receiveForm, setReceiveForm] = useState({
    purchase_order_id: '',
    batch_number: '',
    expiry_date: ''
  });

  const [payForm, setPayForm] = useState({
    supplier_id: '',
    amount: '',
    method: 'bank',
    reference: ''
  });

  const selectedPo = useMemo(
    () => orders.find((o) => o.id === receiveForm.purchase_order_id),
    [orders, receiveForm.purchase_order_id]
  );

  const receivableOrders = useMemo(
    () => orders.filter((o) => ['approved', 'partially_received'].includes(o.status)),
    [orders]
  );

  const load = async () => {
    try {
      const [s, w, p, o, r, b, pay] = await Promise.all([
        api.suppliers.list(),
        api.warehouses.list(),
        api.products.list(),
        api.purchases.orders(),
        api.purchases.receipts(),
        api.purchases.bills(),
        api.purchases.payments()
      ]);
      setSuppliers(s);
      setWarehouses(w);
      setProducts(p);
      setOrders(o);
      setReceipts(r);
      setBills(b);
      setPayments(pay);
      setPoForm((f) => {
        const product = p.find((x: any) => x.id === f.product_id) || p[0];
        return {
          ...f,
          supplier_id: f.supplier_id || s[0]?.id || '',
          warehouse_id: f.warehouse_id || w[0]?.id || '',
          product_id: f.product_id || product?.id || '',
          uom_id: f.uom_id || defaultPurchaseUomId(product),
          unit_cost:
            f.unit_cost ||
            (product ? String(product.default_purchase_cost ?? 0) : '')
        };
      });
      setPayForm((f) => ({ ...f, supplier_id: f.supplier_id || s[0]?.id || '' }));
    } catch (e: any) {
      await alertError('Purchases', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const allowed = new Set(purchaseUoms.map((u) => u.id));
    if (!poForm.uom_id || !allowed.has(poForm.uom_id)) {
      setPoForm((f) => ({ ...f, uom_id: defaultPurchaseUomId(selectedProduct) }));
    }
  }, [selectedProduct, purchaseUoms.map((u) => u.id).join('|')]);

  const createPo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.purchases.createOrder({
        supplier_id: poForm.supplier_id,
        warehouse_id: poForm.warehouse_id,
        notes: poForm.notes || undefined,
        items: [
          {
            product_id: poForm.product_id,
            uom_id: poForm.uom_id || undefined,
            quantity: Number(poForm.quantity),
            unit_cost: Number(poForm.unit_cost)
          }
        ]
      });
      await alertSuccess('Purchase order created');
      setPoForm((f) => ({ ...f, notes: '', quantity: '24' }));
      await load();
    } catch (err: any) {
      await alertError('Create PO failed', err.message);
    }
  };

  const actPo = async (id: string, action: 'submit' | 'approve' | 'cancel') => {
    try {
      if (action === 'submit') await api.purchases.submitOrder(id);
      if (action === 'approve') await api.purchases.approveOrder(id);
      if (action === 'cancel') await api.purchases.cancelOrder(id);
      await alertSuccess(`PO ${action}d`);
      await load();
    } catch (err: any) {
      await alertError('PO action failed', err.message);
    }
  };

  const receivePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPo?.items?.length) {
      await alertError('Select an approved PO');
      return;
    }
    const items = selectedPo.items
      .map((it: any) => {
        const remaining = Number(it.quantity_ordered) - Number(it.quantity_received);
        if (remaining <= 0) return null;
        return {
          purchase_order_item_id: it.id,
          quantity: remaining,
          unit_cost: Number(it.unit_cost),
          batch_number: receiveForm.batch_number || undefined,
          expiry_date: receiveForm.expiry_date || undefined
        };
      })
      .filter(Boolean);
    if (!items.length) {
      await alertError('Nothing left to receive on this PO');
      return;
    }
    try {
      await api.purchases.receive({
        purchase_order_id: selectedPo.id,
        items
      });
      await alertSuccess('GRN posted — stock + AP updated');
      setReceiveForm({ purchase_order_id: '', batch_number: '', expiry_date: '' });
      await load();
      setTab('bills');
    } catch (err: any) {
      await alertError('Receive failed', err.message);
    }
  };

  const paySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.purchases.recordPayment({
        supplier_id: payForm.supplier_id,
        amount: Number(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined
      });
      await alertSuccess('Supplier payment recorded');
      setPayForm((f) => ({ ...f, amount: '', reference: '' }));
      await load();
    } catch (err: any) {
      await alertError('Payment failed', err.message);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'orders', label: 'Purchase orders' },
    { id: 'receive', label: 'Receive (GRN)' },
    { id: 'bills', label: 'AP bills' },
    { id: 'payments', label: 'Payments' }
  ];

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Purchases
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          PO → approve → GRN (stock + AP) → pay supplier.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'orders' ? (
        <>
          <form
            onSubmit={createPo}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New purchase order</div>
            <div className="form-grid">
              <div className="field">
                <label>Supplier</label>
                <select
                  value={poForm.supplier_id}
                  onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}
                  required
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Warehouse</label>
                <select
                  value={poForm.warehouse_id}
                  onChange={(e) => setPoForm({ ...poForm, warehouse_id: e.target.value })}
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
                <label>Product</label>
                <select
                  value={poForm.product_id}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setPoForm({
                      ...poForm,
                      product_id: e.target.value,
                      uom_id: defaultPurchaseUomId(p),
                      unit_cost: p ? String(p.default_purchase_cost ?? 0) : poForm.unit_cost
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
                <label>Purchase UoM</label>
                <select
                  value={poForm.uom_id}
                  onChange={(e) => setPoForm({ ...poForm, uom_id: e.target.value })}
                  required
                >
                  {purchaseUoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
                      {selectedProduct?.purchase_uom_id === u.id ||
                      selectedProduct?.purchase_uom?.id === u.id
                        ? ' (default)'
                        : ''}
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
                  value={poForm.quantity}
                  onChange={(e) => setPoForm({ ...poForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Unit cost (per selected UoM)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={poForm.unit_cost}
                  onChange={(e) => setPoForm({ ...poForm, unit_cost: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={poForm.notes}
                  onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Create PO
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Lines</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.po_number}</td>
                    <td>{o.supplier?.name}</td>
                    <td>{o.status}</td>
                    <td>{Number(o.total_amount).toLocaleString()}</td>
                    <td>
                      {(o.items || [])
                        .map(
                          (it: any) =>
                            `${it.product?.name} ${it.quantity_received}/${it.quantity_ordered} ${it.uom?.code || ''}`
                        )
                        .join(' · ')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {o.status === 'draft' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void actPo(o.id, 'submit')}
                          >
                            Submit
                          </button>
                        ) : null}
                        {['draft', 'pending_approval'].includes(o.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void actPo(o.id, 'approve')}
                          >
                            Approve
                          </button>
                        ) : null}
                        {!['received', 'cancelled', 'partially_received'].includes(o.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void actPo(o.id, 'cancel')}
                          >
                            Cancel
                          </button>
                        ) : null}
                        {['approved', 'partially_received'].includes(o.status) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setReceiveForm((f) => ({ ...f, purchase_order_id: o.id }));
                              setTab('receive');
                            }}
                          >
                            Receive
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

      {tab === 'receive' ? (
        <>
          <form
            onSubmit={receivePo}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Post goods receipt</div>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
              Posts remaining ordered qty into stock and creates an open AP bill (Dr Inventory / Cr
              AP).
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Approved PO</label>
                <select
                  value={receiveForm.purchase_order_id}
                  onChange={(e) =>
                    setReceiveForm({ ...receiveForm, purchase_order_id: e.target.value })
                  }
                  required
                >
                  <option value="">Select…</option>
                  {receivableOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.po_number} — {o.supplier?.name} ({o.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Batch (if tracked)</label>
                <input
                  value={receiveForm.batch_number}
                  onChange={(e) =>
                    setReceiveForm({ ...receiveForm, batch_number: e.target.value })
                  }
                  placeholder="e.g. LOT-2026-01"
                />
              </div>
              <div className="field">
                <label>Expiry (YYYY-MM-DD)</label>
                <input
                  value={receiveForm.expiry_date}
                  onChange={(e) => setReceiveForm({ ...receiveForm, expiry_date: e.target.value })}
                  placeholder="2027-06-30"
                />
              </div>
            </div>
            {selectedPo ? (
              <div style={{ fontSize: '0.9rem' }}>
                {(selectedPo.items || []).map((it: any) => (
                  <div key={it.id}>
                    {it.product?.name}: remaining{' '}
                    {Number(it.quantity_ordered) - Number(it.quantity_received)}{' '}
                    {it.uom?.code || ''} @ {Number(it.unit_cost).toLocaleString()}
                  </div>
                ))}
              </div>
            ) : null}
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Post GRN
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>GRN #</th>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Subtotal</th>
                  <th>Bill</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.grn_number}</td>
                    <td>{r.purchase_order?.po_number || '—'}</td>
                    <td>{r.supplier?.name}</td>
                    <td>{r.status}</td>
                    <td>{Number(r.subtotal).toLocaleString()}</td>
                    <td>{r.bill?.bill_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'bills' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Bill #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>{b.bill_number}</td>
                  <td>{b.supplier?.name}</td>
                  <td>{b.status}</td>
                  <td>{Number(b.total_amount).toLocaleString()}</td>
                  <td>{Number(b.amount_paid).toLocaleString()}</td>
                  <td>{Number(b.balance).toLocaleString()}</td>
                  <td>{b.due_date ? String(b.due_date).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {tab === 'payments' ? (
        <>
          <form
            onSubmit={paySupplier}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Record supplier payment</div>
            <div className="form-grid">
              <div className="field">
                <label>Supplier</label>
                <select
                  value={payForm.supplier_id}
                  onChange={(e) => setPayForm({ ...payForm, supplier_id: e.target.value })}
                  required
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
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
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="transfer">Transfer</option>
                  <option value="cheque">Cheque</option>
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
                  <th>Supplier</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Allocations</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payment_number}</td>
                    <td>{p.supplier?.name}</td>
                    <td>{Number(p.amount).toLocaleString()}</td>
                    <td>{p.method}</td>
                    <td>
                      {(p.allocations || [])
                        .map(
                          (a: any) =>
                            `${a.bill?.bill_number}: ${Number(a.amount).toLocaleString()}`
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
