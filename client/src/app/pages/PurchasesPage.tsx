import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { PaySupplierPayment } from '../components/PaySupplierPayment';
import { SearchSelect } from '../components/SearchSelect';

type Tab = 'orders' | 'receive' | 'bills' | 'payments';

export const PurchasesPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('orders');
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);

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

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );
  const warehouseOptions = useMemo(
    () => warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    [warehouses]
  );
  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        value: p.id,
        label: p.sku ? `${p.name} (${p.sku})` : p.name
      })),
    [products]
  );

  const lineSubtotal = useMemo(() => {
    const qty = Number(poForm.quantity);
    const cost = Number(poForm.unit_cost);
    if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0) return 0;
    return Math.round((qty * cost + Number.EPSILON) * 100) / 100;
  }, [poForm.quantity, poForm.unit_cost]);

  const [receiveForm, setReceiveForm] = useState({
    purchase_order_id: ''
  });
  /** Per PO-line batch/expiry/serials for GRN (keyed by purchase_order_item id). */
  const [receiveLines, setReceiveLines] = useState<
    Record<string, { batch_number: string; expiry_date: string; serial_numbers: string }>
  >({});

  const selectedPo = useMemo(
    () => orders.find((o) => o.id === receiveForm.purchase_order_id),
    [orders, receiveForm.purchase_order_id]
  );

  const productById = useMemo(() => {
    const map = new Map<string, any>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const selectReceivePo = (poId: string) => {
    setReceiveForm({ purchase_order_id: poId });
    const po = orders.find((o) => o.id === poId);
    const next: Record<string, { batch_number: string; expiry_date: string; serial_numbers: string }> =
      {};
    for (const it of po?.items || []) {
      const remaining = Number(it.quantity_ordered) - Number(it.quantity_received);
      if (remaining <= 0) continue;
      next[it.id] = { batch_number: '', expiry_date: '', serial_numbers: '' };
    }
    setReceiveLines(next);
  };

  const parseSerialInput = (raw: string) =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  /** Convert packaging qty → base units (serials are always 1 per base unit). */
  const qtyToBase = (product: any, fromUomId: string | null | undefined, quantity: number) => {
    const baseId = product?.base_uom_id || product?.base_uom?.id;
    if (!fromUomId || !baseId || fromUomId === baseId) return quantity;
    const conversions: any[] = product?.conversions || [];
    const direct = conversions.find(
      (c) =>
        (c.from_uom_id || c.from_uom?.id) === fromUomId &&
        (c.to_uom_id || c.to_uom?.id) === baseId
    );
    if (direct) return quantity * Number(direct.factor || 0);
    const reverse = conversions.find(
      (c) =>
        (c.from_uom_id || c.from_uom?.id) === baseId &&
        (c.to_uom_id || c.to_uom?.id) === fromUomId
    );
    if (reverse && Number(reverse.factor) !== 0) return quantity / Number(reverse.factor);
    // One-hop: from → mid → base
    for (const link of conversions) {
      const linkFrom = link.from_uom_id || link.from_uom?.id;
      const linkTo = link.to_uom_id || link.to_uom?.id;
      if (linkFrom !== fromUomId) continue;
      if (linkTo === baseId) return quantity * Number(link.factor || 0);
      const next = conversions.find(
        (c) =>
          (c.from_uom_id || c.from_uom?.id) === linkTo &&
          (c.to_uom_id || c.to_uom?.id) === baseId
      );
      if (next) return quantity * Number(link.factor || 0) * Number(next.factor || 0);
    }
    return null;
  };

  /** Prefer products.list() row (has conversions); PO embed may omit them. */
  const productForLine = (it: any) => productById.get(it.product_id) || it.product;

  const serialsRequiredForLine = (it: any, remaining: number) => {
    const product = productForLine(it);
    if (!product?.track_serial) return 0;
    const uomId = it.uom_id || it.uom?.id;
    const base = qtyToBase(product, uomId, remaining);
    if (base == null || !(base > 0)) return null;
    return Math.round(base);
  };

  const receivableOrders = useMemo(
    () => orders.filter((o) => ['approved', 'partially_received'].includes(o.status)),
    [orders]
  );

  const load = async () => {
    try {
      const [s, w, p, o, r, b] = await Promise.all([
        api.suppliers.list(),
        api.warehouses.list(),
        api.products.list(),
        api.purchases.orders(),
        api.purchases.receipts(),
        api.purchases.bills()
      ]);
      setSuppliers(s);
      setWarehouses(w);
      setProducts(p);
      setOrders(o);
      setReceipts(r);
      setBills(b);
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
    for (const it of selectedPo.items) {
      const remaining = Number(it.quantity_ordered) - Number(it.quantity_received);
      if (remaining <= 0) continue;
      const product = productForLine(it);
      const line = receiveLines[it.id] || {
        batch_number: '',
        expiry_date: '',
        serial_numbers: ''
      };
      if (product?.track_batch && !line.batch_number.trim()) {
        await alertError(
          'Batch required',
          `${product.name || 'Product'} requires a batch number on receive.`
        );
        return;
      }
      if (product?.track_expiry && !line.expiry_date) {
        await alertError(
          'Expiry required',
          `${product.name || 'Product'} requires an expiry date on receive.`
        );
        return;
      }
      if (product?.track_serial) {
        const serials = parseSerialInput(line.serial_numbers);
        const needed = serialsRequiredForLine(it, remaining);
        if (needed == null) {
          await alertError(
            'Serials required',
            `Cannot convert ${it.uom?.code || 'UoM'} to base units for ${product.name || 'product'}. Check packaging conversions.`
          );
          return;
        }
        if (serials.length !== needed) {
          const baseCode = product.base_uom?.code || 'pcs';
          await alertError(
            'Serials required',
            `${product.name || 'Product'}: ${remaining} ${it.uom?.code || ''} = ${needed} ${baseCode} — enter exactly ${needed} serial number(s).`
          );
          return;
        }
      }
    }
    const items = selectedPo.items
      .map((it: any) => {
        const remaining = Number(it.quantity_ordered) - Number(it.quantity_received);
        if (remaining <= 0) return null;
        const line = receiveLines[it.id] || {
          batch_number: '',
          expiry_date: '',
          serial_numbers: ''
        };
        const serials = parseSerialInput(line.serial_numbers);
        return {
          purchase_order_item_id: it.id,
          quantity: remaining,
          unit_cost: Number(it.unit_cost),
          batch_number: line.batch_number.trim() || undefined,
          expiry_date: line.expiry_date || undefined,
          serial_numbers: serials.length ? serials : undefined
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
      setReceiveForm({ purchase_order_id: '' });
      setReceiveLines({});
      await load();
      setTab('bills');
    } catch (err: any) {
      await alertError('Receive failed', err.message);
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
                <SearchSelect
                  value={poForm.supplier_id}
                  options={supplierOptions}
                  required
                  placeholder="Search supplier…"
                  onChange={(supplier_id) => setPoForm({ ...poForm, supplier_id })}
                />
              </div>
              <div className="field">
                <label>Warehouse</label>
                <SearchSelect
                  value={poForm.warehouse_id}
                  options={warehouseOptions}
                  required
                  placeholder="Search warehouse…"
                  onChange={(warehouse_id) => setPoForm({ ...poForm, warehouse_id })}
                />
              </div>
              <div className="field">
                <label>Product</label>
                <SearchSelect
                  value={poForm.product_id}
                  options={productOptions}
                  required
                  placeholder="Search product…"
                  onChange={(product_id) => {
                    const p = products.find((x) => x.id === product_id);
                    setPoForm({
                      ...poForm,
                      product_id,
                      uom_id: defaultPurchaseUomId(p),
                      unit_cost: p ? String(p.default_purchase_cost ?? 0) : poForm.unit_cost
                    });
                  }}
                />
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
                <label>Subtotal</label>
                <input value={lineSubtotal.toLocaleString()} readOnly tabIndex={-1} />
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
            <div className="field">
              <label>Approved PO</label>
              <select
                value={receiveForm.purchase_order_id}
                onChange={(e) => selectReceivePo(e.target.value)}
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
            {selectedPo ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Remaining</th>
                      <th>Unit cost</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>Serials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPo.items || [])
                      .filter(
                        (it: any) =>
                          Number(it.quantity_ordered) - Number(it.quantity_received) > 0
                      )
                      .map((it: any) => {
                        const remaining =
                          Number(it.quantity_ordered) - Number(it.quantity_received);
                        const product = productForLine(it);
                        const trackBatch = !!product?.track_batch;
                        const trackExpiry = !!product?.track_expiry;
                        const trackSerial = !!product?.track_serial;
                        const serialsNeeded = trackSerial
                          ? serialsRequiredForLine(it, remaining)
                          : 0;
                        const baseCode = product?.base_uom?.code || 'pcs';
                        const line = receiveLines[it.id] || {
                          batch_number: '',
                          expiry_date: '',
                          serial_numbers: ''
                        };
                        return (
                          <tr key={it.id}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{product?.name || '—'}</div>
                              <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                                {[
                                  trackBatch ? 'batch' : null,
                                  trackExpiry ? 'expiry' : null,
                                  trackSerial ? 'serial' : null
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'no lot tracking'}
                              </div>
                            </td>
                            <td>
                              {remaining} {it.uom?.code || ''}
                              {trackSerial && serialsNeeded != null && serialsNeeded !== remaining ? (
                                <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                                  = {serialsNeeded} {baseCode}
                                </div>
                              ) : null}
                            </td>
                            <td>{Number(it.unit_cost).toLocaleString()}</td>
                            <td>
                              {trackBatch ? (
                                <input
                                  required
                                  value={line.batch_number}
                                  placeholder="e.g. LOT-2026-01"
                                  onChange={(e) =>
                                    setReceiveLines((prev) => ({
                                      ...prev,
                                      [it.id]: { ...line, batch_number: e.target.value }
                                    }))
                                  }
                                />
                              ) : (
                                <span style={{ color: 'var(--ink-muted)' }}>—</span>
                              )}
                            </td>
                            <td>
                              {trackExpiry ? (
                                <input
                                  type="date"
                                  required
                                  value={line.expiry_date}
                                  onChange={(e) =>
                                    setReceiveLines((prev) => ({
                                      ...prev,
                                      [it.id]: { ...line, expiry_date: e.target.value }
                                    }))
                                  }
                                />
                              ) : (
                                <span style={{ color: 'var(--ink-muted)' }}>—</span>
                              )}
                            </td>
                            <td>
                              {trackSerial ? (
                                <textarea
                                  required
                                  rows={Math.min(
                                    6,
                                    Math.max(2, serialsNeeded != null ? serialsNeeded : 2)
                                  )}
                                  value={line.serial_numbers}
                                  placeholder={
                                    serialsNeeded != null
                                      ? `One serial per ${baseCode} (${serialsNeeded} required)`
                                      : 'One serial per base unit'
                                  }
                                  onChange={(e) =>
                                    setReceiveLines((prev) => ({
                                      ...prev,
                                      [it.id]: { ...line, serial_numbers: e.target.value }
                                    }))
                                  }
                                  style={{ minWidth: 160, fontFamily: 'ui-monospace, monospace' }}
                                />
                              ) : (
                                <span style={{ color: 'var(--ink-muted)' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
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
        <PaySupplierPayment
          suppliers={suppliers}
          historyScope="all"
          onDone={() => void load()}
        />
      ) : null}
    </div>
  );
};
