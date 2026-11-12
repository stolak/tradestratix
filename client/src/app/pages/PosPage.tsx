import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Info } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { InvoiceViewModal } from '../components/InvoiceViewModal';

type CartLine = {
  key: string;
  product_id: string;
  name: string;
  uom_id: string;
  uom_code: string;
  quantity: string;
  unit_price: string;
};

type PosTab = 'sell' | 'sales';

function isWalkInCustomer(c: any) {
  return (
    c?.customer_type === 'walk_in' ||
    String(c?.code || '').toUpperCase() === 'WALK-IN'
  );
}

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function saleLocalDay(s: any) {
  const raw = s.invoice_date || s.created_at;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function salePaymentMethod(s: any) {
  const m =
    s.payment_method ||
    s.payment_methods?.[0] ||
    s.allocations?.[0]?.payment?.method ||
    '';
  return String(m || '').toLowerCase();
}

function methodLabel(m: string) {
  const key = String(m || '').toLowerCase();
  if (key === 'cash') return 'Cash';
  if (key === 'bank') return 'Bank transfer';
  if (key === 'card') return 'Card';
  if (key === 'transfer') return 'Mobile / transfer';
  if (key === 'custody') return 'Custody';
  return m || '—';
}

export const PosPage: React.FC = () => {
  const { activeBranchId, user, can } = useAuth();
  const canChangePrice = can('sales.change_price');
  const [mySalesRep, setMySalesRep] = useState<{ id: string } | null>(
    () => (user?.sales_rep?.id ? { id: user.sales_rep.id } : null)
  );
  const isSalesRep = Boolean(user?.is_sales_rep || user?.sales_rep?.id || mySalesRep?.id);
  const mySalesRepId = mySalesRep?.id || user?.sales_rep?.id || '';
  const [tab, setTab] = useState<PosTab>('sell');
  const [customers, setCustomers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [mySales, setMySales] = useState<any[]>([]);
  const [salesFrom, setSalesFrom] = useState(todayLocalDate);
  const [salesTo, setSalesTo] = useState(todayLocalDate);
  const [salesMethod, setSalesMethod] = useState('');
  const [custodyBalance, setCustodyBalance] = useState(0);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
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

  const selectableCustomers = useMemo(
    () =>
      customers.filter(
        (c) => (c.status || 'active') === 'active' && (isSalesRep || !isWalkInCustomer(c))
      ),
    [customers, isSalesRep]
  );
  const selectedCustomer = useMemo(
    () => selectableCustomers.find((c) => c.id === customerId),
    [selectableCustomers, customerId]
  );
  const walkInSelected = isWalkInCustomer(selectedCustomer);
  const salesRepLocked = walkInSelected && isSalesRep && !!mySalesRepId;

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
    const rows = ((p.selling_prices || []) as any[]).filter(
      (s) => (s.uom_id || s.uom?.id) === uom && s.is_active !== false
    );
    const sp =
      rows.find((s) => s.price_level === 'retail') || rows.find((s) => s.is_default) || rows[0];
    if (sp) return String(sp.effective_unit_price ?? sp.unit_price ?? 0);
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
  const customerDiscountPct = Number(selectedCustomer?.discount_percent || 0);
  const tender =
    customerDiscountPct > 0
      ? total - Math.round(total * customerDiscountPct) / 100
      : total;

  const filteredMySales = useMemo(() => {
    return mySales.filter((s) => {
      const day = saleLocalDay(s);
      if (salesFrom && day && day < salesFrom) return false;
      if (salesTo && day && day > salesTo) return false;
      if (salesMethod) {
        const m = salePaymentMethod(s);
        if (m !== salesMethod) return false;
      }
      return true;
    });
  }, [mySales, salesFrom, salesTo, salesMethod]);

  const filteredSalesTotal = useMemo(
    () => filteredMySales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0),
    [filteredMySales]
  );

  const load = async () => {
    const settled = await Promise.allSettled([
      api.customers.list(undefined, undefined, { includeWalkIn: true }),
      api.warehouses.list(activeBranchId || undefined),
      api.products.list(),
      api.salesReps.list(activeBranchId || undefined),
      api.sales.invoices('posted', 'pos'),
      api.salesReps.me({ withBalances: true })
    ]);
    const value = <T,>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value as T) : fallback;

    const c = value<any[]>(0, []);
    const w = value<any[]>(1, []);
    const p = value<any[]>(2, []);
    const r = value<any[]>(3, []);
    const inv = value<any[]>(4, []);
    const meRep = value<any | null>(5, null);
    const resolvedRepId = meRep?.id || user?.sales_rep?.id || '';
    const resolvedIsRep = Boolean(meRep?.id || user?.is_sales_rep || user?.sales_rep?.id);
    setMySalesRep(meRep?.id ? { id: meRep.id } : null);
    setCustodyBalance(Number(meRep?.balance || 0));
    const visible = resolvedIsRep ? c : c.filter((x) => !isWalkInCustomer(x));

    setCustomers(c);
    setWarehouses(w);
    setProducts(p);
    setReps(r);
    setRecent(inv.slice(0, 15));

    if (resolvedRepId) {
      try {
        const mine = await api.sales.invoices('posted', undefined, { salesRepId: resolvedRepId });
        setMySales(mine);
      } catch {
        setMySales(
          inv.filter((x) => (x.sales_rep_id || x.sales_rep?.id) === resolvedRepId)
        );
      }
    } else {
      setMySales(inv);
    }

    const failed = settled
      .map((s, i) =>
        s.status === 'rejected'
          ? ['Customers', 'Warehouses', 'Products', 'Sales reps', 'Invoices', 'My sales rep'][i]
          : null
      )
      .filter(Boolean);
    if (failed.length && !c.length && !w.length && !p.length) {
      await alertError('POS', `Could not load: ${failed.join(', ')}`);
    }

    const preferred =
      (resolvedIsRep
        ? visible.find((x) => isWalkInCustomer(x))
        : visible.find((x) => !isWalkInCustomer(x))) || visible[0];
    setCustomerId((id) =>
      visible.some((x) => x.id === id) ? id : preferred?.id || ''
    );
    setWarehouseId((id) => (w.some((x) => x.id === id) ? id : w[0]?.id || ''));
    setSalesRepId((id) => {
      const nextCustomer =
        visible.find((x) => x.id === (visible.some((v) => v.id === customerId) ? customerId : preferred?.id)) ||
        preferred;
      if (isWalkInCustomer(nextCustomer) && resolvedIsRep && resolvedRepId) return resolvedRepId;
      return r.some((x) => x.id === id) ? id : '';
    });
    const product = p[0];
    if (product && !productId) {
      const uom = defaultSellUomId(product);
      setProductId(product.id);
      setUomId(uom);
      setUnitPrice(defaultPrice(product, uom));
    }
  };

  useEffect(() => {
    void load();
  }, [activeBranchId]);

  useEffect(() => {
    if (!salesRepLocked) return;
    setSalesRepId(mySalesRepId);
  }, [salesRepLocked, mySalesRepId]);

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
    if (!method) {
      await alertError('Payment method', 'Select how the customer paid (for reconciliation).');
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
          ...(canChangePrice ? { unit_price: Number(l.unit_price) } : {})
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
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Point of Sale
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Fast sale — posts stock, revenue and COGS immediately. Walk-in cash goes to your custody; Finance
          retires it into till or bank.
        </p>
      </header>

      {isSalesRep ? (
        <div
          className="card-surface"
          style={{
            padding: '0.85rem 1.1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>Cash due for retirement</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {money(custodyBalance)}
            </div>
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              Held in your custody — Finance retires this under Banking → Sales cash custody
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn ${tab === 'sell' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('sell')}
        >
          Sell
        </button>
        <button
          type="button"
          className={`btn ${tab === 'sales' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('sales')}
        >
          My sales
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'sell' ? (
        <div className="split-pos">
          <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div className="form-grid">
              <div className="field">
                <label>Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const next = selectableCustomers.find((c) => c.id === nextId);
                    setCustomerId(nextId);
                    if (isWalkInCustomer(next) && isSalesRep && mySalesRepId) {
                      setSalesRepId(mySalesRepId);
                    }
                  }}
                  required
                >
                  {selectableCustomers.map((c) => (
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
              {walkInSelected ? (
                <div className="field">
                  <label>Collection</label>
                  <input value="Held in sales-rep custody" disabled />
                </div>
              ) : null}
            </div>

            <div className="form-grid">
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
                  readOnly={!canChangePrice}
                  title={
                    canChangePrice
                      ? undefined
                      : 'Price is set by the selected UoM. You need the "change price" privilege to edit it.'
                  }
                  style={canChangePrice ? undefined : { background: '#f5f6f7', cursor: 'not-allowed' }}
                />
              </div>
              <div className="form-grid--actions">
                <button type="button" className="btn btn-ghost" onClick={addLine}>
                  Add
                </button>
              </div>
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
                        : 'Optional. Choose a sales representative for this sale when selling to account customers.',
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
              <select
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
                disabled={salesRepLocked}
                required={salesRepLocked}
              >
                {!salesRepLocked ? <option value="">—</option> : null}
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || r.employee?.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="table-wrap">
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
          </div>

          <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16, alignContent: 'start' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Tender
            </div>
            {customerDiscountPct > 0 && total > 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
                Subtotal {total.toLocaleString(undefined, { minimumFractionDigits: 2 })} · −
                {customerDiscountPct}% customer discount
              </div>
            ) : null}
            <div className="display" style={{ fontSize: '2.5rem', margin: 0 }}>
              {tender.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="field">
              <label>Method of payment</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} required>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="card">Card</option>
                <option value="transfer">Mobile / transfer</option>
              </select>
              {walkInSelected ? (
                <small style={{ color: 'var(--ink-muted)' }}>
                  Recorded for reconciliation. Walk-in cash still sits in your custody until Finance retires it.
                </small>
              ) : null}
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
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setViewInvoiceId(s.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                    font: 'inherit'
                  }}
                >
                  <span style={{ textDecoration: 'underline' }}>{s.invoice_number}</span>
                  <span>{Number(s.total_amount).toLocaleString()}</span>
                </button>
              ))}
              {!recent.length ? (
                <div style={{ color: 'var(--ink-muted)' }}>No POS sales yet</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'sales' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div
            style={{
              padding: '0.75rem 1rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem 1rem',
              alignItems: 'flex-end',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ fontWeight: 600 }}>{isSalesRep ? 'My sales' : 'POS / sales'}</div>
            <div className="form-grid" style={{ margin: 0, flex: '1 1 420px' }}>
              <div className="field">
                <label>From</label>
                <input
                  type="date"
                  value={salesFrom}
                  max={salesTo || todayLocalDate()}
                  onChange={(e) => setSalesFrom(e.target.value)}
                />
              </div>
              <div className="field">
                <label>To</label>
                <input
                  type="date"
                  value={salesTo}
                  min={salesFrom || undefined}
                  max={todayLocalDate()}
                  onChange={(e) => setSalesTo(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Payment method</label>
                <select value={salesMethod} onChange={(e) => setSalesMethod(e.target.value)}>
                  <option value="">All methods</option>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
                  <option value="card">Card</option>
                  <option value="transfer">Mobile / transfer</option>
                </select>
              </div>
              <div className="form-grid--actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    const t = todayLocalDate();
                    setSalesFrom(t);
                    setSalesTo(t);
                    setSalesMethod('');
                  }}
                >
                  Today
                </button>
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th>Method</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredMySales.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                    <td>
                      {s.invoice_date
                        ? new Date(s.invoice_date).toLocaleDateString()
                        : s.created_at
                          ? new Date(s.created_at).toLocaleDateString()
                          : '—'}
                    </td>
                    <td>{s.customer?.name || '—'}</td>
                    <td>{s.channel || '—'}</td>
                    <td>{methodLabel(salePaymentMethod(s))}</td>
                    <td className="num">{money(s.total_amount)}</td>
                    <td>{s.payment_status || s.status || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setViewInvoiceId(s.id)}
                        title="View invoice"
                      >
                        <Eye size={16} /> View
                      </button>
                    </td>
                  </tr>
                ))}
                {!filteredMySales.length ? (
                  <tr>
                    <td colSpan={8} style={{ color: 'var(--ink-muted)' }}>
                      {mySales.length
                        ? 'No sales match these filters.'
                        : 'No sales yet.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {filteredMySales.length ? (
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ fontWeight: 700, textAlign: 'right' }}>
                      Grand total ({filteredMySales.length} sale{filteredMySales.length === 1 ? '' : 's'})
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {money(filteredSalesTotal)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      ) : null}

      {viewInvoiceId ? (
        <InvoiceViewModal
          invoiceId={viewInvoiceId}
          onClose={() => setViewInvoiceId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
};
