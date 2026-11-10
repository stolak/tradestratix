import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type CartLine = {
  key: string;
  product_id: string;
  name: string;
  uom_id: string;
  uom_code: string;
  quantity: string;
  unit_price: string;
};

export const PosPage: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [salesRepId, setSalesRepId] = useState('');
  const [method, setMethod] = useState('cash');
  const [productId, setProductId] = useState('');
  const [uomId, setUomId] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);

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

  const defaultPrice = (p: any, uom: string) => {
    if (!p) return '0';
    const sp = (p.selling_prices || []).find(
      (s: any) => (s.uom_id || s.uom?.id) === uom && (s.is_default || s.price_level === 'retail')
    );
    if (sp) return String(sp.unit_price ?? 0);
    return String(p.default_selling_price ?? 0);
  };

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );
  const sellUoms = useMemo(() => uomsForProduct(selectedProduct), [selectedProduct]);

  const total = useMemo(
    () =>
      cart.reduce(
        (s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0),
        0
      ),
    [cart]
  );

  const load = async () => {
    try {
      const [c, w, p, r, inv] = await Promise.all([
        api.customers.list(),
        api.warehouses.list(),
        api.products.list(),
        api.salesReps.list(),
        api.sales.invoices('posted', 'pos')
      ]);
      setCustomers(c);
      setWarehouses(w);
      setProducts(p);
      setReps(r);
      setRecent(inv.slice(0, 15));
      const walkIn = c.find((x: any) => x.customer_type === 'walk_in' || x.code === 'WALK-IN');
      setCustomerId((id) => id || walkIn?.id || c[0]?.id || '');
      setWarehouseId((id) => id || w[0]?.id || '');
      const product = p[0];
      if (product && !productId) {
        const uom = defaultSellUomId(product);
        setProductId(product.id);
        setUomId(uom);
        setUnitPrice(defaultPrice(product, uom));
      }
    } catch (e: any) {
      await alertError('POS', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    const allowed = new Set(sellUoms.map((u) => u.id));
    if (!uomId || !allowed.has(uomId)) {
      const uom = defaultSellUomId(selectedProduct);
      setUomId(uom);
      setUnitPrice(defaultPrice(selectedProduct, uom));
    }
  }, [selectedProduct, sellUoms.map((u) => u.id).join('|')]);

  const addLine = () => {
    if (!selectedProduct || !uomId) return;
    const uom = sellUoms.find((u) => u.id === uomId);
    setCart((lines) => [
      ...lines,
      {
        key: `${Date.now()}`,
        product_id: selectedProduct.id,
        name: selectedProduct.name,
        uom_id: uomId,
        uom_code: uom?.code || '',
        quantity: qty || '1',
        unit_price: unitPrice || '0'
      }
    ]);
    setQty('1');
  };

  const checkout = async () => {
    if (!cart.length) {
      await alertError('Cart is empty');
      return;
    }
    setBusy(true);
    try {
      const sale = await api.sales.posSale({
        customer_id: customerId,
        warehouse_id: warehouseId,
        sales_rep_id: salesRepId || undefined,
        payment_method: method,
        items: cart.map((l) => ({
          product_id: l.product_id,
          uom_id: l.uom_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price)
        }))
      });
      await alertSuccess('Sale complete', `${sale.invoice_number} · ${Number(sale.total_amount).toLocaleString()}`);
      setCart([]);
      await load();
    } catch (err: any) {
      await alertError('Checkout failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Point of Sale
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Fast cash/bank sale — posts stock, revenue and COGS immediately.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Pay with</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank / card</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.8fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <div className="field">
              <label>Product</label>
              <select
                value={productId}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  const uom = defaultSellUomId(p);
                  setProductId(e.target.value);
                  setUomId(uom);
                  setUnitPrice(defaultPrice(p, uom));
                }}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>UoM</label>
              <select
                value={uomId}
                onChange={(e) => {
                  setUomId(e.target.value);
                  setUnitPrice(defaultPrice(selectedProduct, e.target.value));
                }}
              >
                {sellUoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Qty</label>
              <input
                type="number"
                min="0.0001"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Price</label>
              <input
                type="number"
                min="0"
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-ghost" onClick={addLine}>
              Add
            </button>
          </div>

          <div className="field">
            <label>Sales rep (optional)</label>
            <select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)}>
              <option value="">—</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>UoM</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Line</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cart.map((l) => (
                <tr key={l.key}>
                  <td>{l.name}</td>
                  <td>{l.uom_code}</td>
                  <td>{l.quantity}</td>
                  <td>{Number(l.unit_price).toLocaleString()}</td>
                  <td>{(Number(l.quantity) * Number(l.unit_price)).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setCart((rows) => rows.filter((r) => r.key !== l.key))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16, alignContent: 'start' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Tender
          </div>
          <div className="display" style={{ fontSize: '2.5rem', margin: 0 }}>
            {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cart.length}
            onClick={() => void checkout()}
            style={{ width: '100%', padding: '0.9rem' }}
          >
            {busy ? 'Posting…' : `Charge ${method}`}
          </button>

          <div style={{ fontWeight: 700, marginTop: 8 }}>Recent POS sales</div>
          <div style={{ display: 'grid', gap: 6, fontSize: '0.9rem' }}>
            {recent.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{s.invoice_number}</span>
                <span>{Number(s.total_amount).toLocaleString()}</span>
              </div>
            ))}
            {!recent.length ? (
              <div style={{ color: 'var(--ink-muted)' }}>No POS sales yet</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
