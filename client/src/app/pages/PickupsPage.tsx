import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PackageCheck, RefreshCw, Search, X } from 'lucide-react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { InvoiceViewModal } from '../components/InvoiceViewModal';

type View = 'pending' | 'released';

function fmtDate(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function qty(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'paid',
  partial: 'part paid',
  open: 'unpaid'
};

export const PickupsPage: React.FC = () => {
  const { activeBranchId, can } = useAuth();
  const canViewInvoice = can('sales.view', 'pos.view');
  const [view, setView] = useState<View>('pending');
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [released, setReleased] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [releasing, setReleasing] = useState<any | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [pending, history] = await Promise.all([
        api.sales.pendingPickups({ warehouse_id: warehouseId || undefined, q: search || undefined }),
        api.sales.fulfilments(warehouseId || undefined)
      ]);
      setWarehouses(pending.warehouses || []);
      setRows(pending.rows || []);
      setReleased(history || []);
    } catch (err: any) {
      await alertError('Pickups', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [warehouseId, search, activeBranchId]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const outstandingLines = useMemo(
    () => rows.reduce((s, r) => s + (r.lines || []).length, 0),
    [rows]
  );

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Pickups
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Orders confirmed in any branch with stock reserved in your warehouses. Releasing issues the
          reserved stock and invoices what was handed over — revenue, receivable and cost of goods post to
          the order’s revenue branch, applying any deposit the customer paid.
        </p>
      </header>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="cust-bal__toolbar">
          <div className="segmented" role="tablist">
            <button
              type="button"
              className={`segmented__btn${view === 'pending' ? ' is-active' : ''}`}
              onClick={() => setView('pending')}
            >
              To collect{rows.length ? ` (${rows.length})` : ''}
            </button>
            <button
              type="button"
              className={`segmented__btn${view === 'released' ? ' is-active' : ''}`}
              onClick={() => setView('released')}
            >
              Released
            </button>
          </div>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            aria-label="Warehouse"
            style={{ maxWidth: 280 }}
          >
            <option value="">All my warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branch?.name} · {w.code} — {w.name}
              </option>
            ))}
          </select>
          {view === 'pending' ? (
            <label className="pickups__search">
              <Search size={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Invoice #, customer or phone"
              />
            </label>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        {view === 'pending' ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Sold at</th>
                  <th>Collect from</th>
                  <th>Outstanding</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.invoice_id}:${r.warehouse?.id}`}>
                    <td>
                      {canViewInvoice ? (
                        <button
                          type="button"
                          className="invoice-link"
                          onClick={() => setViewInvoiceId(r.invoice_id)}
                        >
                          {r.invoice_number}
                        </button>
                      ) : (
                        r.invoice_number
                      )}
                      {r.fulfilment_status === 'partial' ? (
                        <div className="line-items__discount-note">part collected</div>
                      ) : null}
                    </td>
                    <td>{fmtDate(r.invoice_date)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.customer?.name}</div>
                      {r.customer?.phone ? (
                        <div className="line-items__discount-note">{r.customer.phone}</div>
                      ) : null}
                    </td>
                    <td>{r.selling_branch?.name || '—'}</td>
                    <td>
                      {r.warehouse?.name}
                      <div className="line-items__discount-note">{r.warehouse?.branch?.name}</div>
                    </td>
                    <td>
                      {(r.lines || [])
                        .slice(0, 3)
                        .map((l: any) => `${qty(l.remaining)} ${l.uom?.code || ''} ${l.product?.name}`)
                        .join(', ')}
                      {(r.lines || []).length > 3 ? ` +${r.lines.length - 3} more` : ''}
                    </td>
                    <td>
                      <span className={`invoice-chip invoice-chip--${r.payment_status}`}>
                        {PAYMENT_LABELS[r.payment_status] || r.payment_status}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn btn-primary" onClick={() => setReleasing(r)}>
                        <PackageCheck size={15} /> Release
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem' }}>
                      {loading ? 'Loading…' : 'Nothing waiting to be collected.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {rows.length ? (
              <div className="pickups__foot">
                {rows.length} pickup{rows.length === 1 ? '' : 's'} · {outstandingLines} line
                {outstandingLines === 1 ? '' : 's'} outstanding
              </div>
            ) : null}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Release #</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Warehouse</th>
                  <th>Collected by</th>
                  <th>Lines</th>
                </tr>
              </thead>
              <tbody>
                {released.map((f) => (
                  <tr key={f.id}>
                    <td>{f.fulfilment_number}</td>
                    <td>{fmtDate(f.fulfilled_at)}</td>
                    <td>
                      {canViewInvoice ? (
                        <button
                          type="button"
                          className="invoice-link"
                          onClick={() => setViewInvoiceId(f.invoice?.id)}
                        >
                          {f.invoice?.invoice_number}
                        </button>
                      ) : (
                        f.invoice?.invoice_number
                      )}
                    </td>
                    <td>{f.invoice?.customer?.name}</td>
                    <td>
                      {f.warehouse?.name}
                      <div className="line-items__discount-note">{f.branch?.name}</div>
                    </td>
                    <td>
                      {f.collected_by || '—'}
                      {f.collector_phone ? (
                        <div className="line-items__discount-note">{f.collector_phone}</div>
                      ) : null}
                    </td>
                    <td>{(f.items || []).length}</td>
                  </tr>
                ))}
                {!released.length ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-muted)', padding: '2rem' }}>
                      {loading ? 'Loading…' : 'No releases yet.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {releasing ? (
        <ReleaseModal
          pickup={releasing}
          onClose={() => setReleasing(null)}
          onDone={async () => {
            setReleasing(null);
            await load();
          }}
        />
      ) : null}

      {viewInvoiceId ? (
        <InvoiceViewModal invoiceId={viewInvoiceId} onClose={() => setViewInvoiceId(null)} />
      ) : null}
    </div>
  );
};

const ReleaseModal: React.FC<{
  pickup: any;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}> = ({ pickup, onClose, onDone }) => {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries((pickup.lines || []).map((l: any) => [l.invoice_item_id, String(l.remaining)]))
  );
  const [meta, setMeta] = useState({
    collected_by: pickup.customer?.name || '',
    collector_phone: pickup.customer?.phone || '',
    id_reference: '',
    notes: ''
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  const lines: any[] = pickup.lines || [];
  const invalid = lines.find((l) => {
    const v = Number(quantities[l.invoice_item_id] || 0);
    return !Number.isFinite(v) || v < 0 || v > Number(l.remaining) + 1e-9;
  });
  const anyQty = lines.some((l) => Number(quantities[l.invoice_item_id] || 0) > 0);
  const balance = Number(pickup.amount_due ?? pickup.balance ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid || !anyQty) return;
    setBusy(true);
    try {
      const res = await api.sales.fulfil({
        invoice_id: pickup.invoice_id,
        warehouse_id: pickup.warehouse?.id,
        ...meta,
        items: lines
          .map((l) => ({
            invoice_item_id: l.invoice_item_id,
            quantity: Number(quantities[l.invoice_item_id] || 0)
          }))
          .filter((i) => i.quantity > 0)
      });
      await alertSuccess(
        `${res.fulfilment_number} released`,
        res.invoice?.fulfilment_status === 'fulfilled'
          ? `${pickup.invoice_number} is now fully collected.`
          : `${pickup.invoice_number} still has goods to collect.`
      );
      await onDone();
    } catch (err: any) {
      await alertError('Release failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal invoice-view" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="modal__header">
          <div>
            <div className="invoice-view__eyebrow">Release goods · {pickup.warehouse?.name}</div>
            <h2 className="display invoice-view__number">{pickup.invoice_number}</h2>
          </div>
          <div className="modal__actions">
            <button type="button" className="line-items__remove" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal__body">
          <div className="invoice-view__meta">
            <div>
              <div className="invoice-view__label">Customer</div>
              <div className="invoice-view__strong">{pickup.customer?.name}</div>
              {pickup.customer?.phone ? <div>{pickup.customer.phone}</div> : null}
            </div>
            <dl className="invoice-view__facts">
              <dt>Invoice date</dt>
              <dd>{fmtDate(pickup.invoice_date)}</dd>
              <dt>Sold at</dt>
              <dd>{pickup.selling_branch?.name || '—'}</dd>
              <dt>Payment</dt>
              <dd>{PAYMENT_LABELS[pickup.payment_status] || pickup.payment_status}</dd>
            </dl>
          </div>

          {balance > 0 ? (
            <div className="pickups__warning">
              This order still has{' '}
              {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} unpaid. Release only if the
              customer is cleared to collect on credit.
            </div>
          ) : null}

          <div className="line-items">
            <table className="line-items__table">
              <thead>
                <tr>
                  <th className="line-items__index">#</th>
                  <th>Product</th>
                  <th>UoM</th>
                  <th className="num">Ordered</th>
                  <th className="num">Collected</th>
                  <th className="num">Outstanding</th>
                  <th style={{ width: 120, textAlign: 'center' }}>Release now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const v = Number(quantities[l.invoice_item_id] || 0);
                  const bad = v < 0 || v > Number(l.remaining) + 1e-9;
                  return (
                    <tr key={l.invoice_item_id}>
                      <td className="line-items__index">{idx + 1}</td>
                      <td>
                        <div className="invoice-view__strong">{l.product?.name}</div>
                        <div className="invoice-view__sub">
                          {[l.product?.sku, l.variant?.name].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>{l.uom?.code || '—'}</td>
                      <td className="num">{qty(l.quantity)}</td>
                      <td className="num">{qty(l.fulfilled_quantity)}</td>
                      <td className="num">{qty(l.remaining)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max={l.remaining}
                          step="any"
                          className="line-items__qty"
                          value={quantities[l.invoice_item_id] ?? ''}
                          aria-invalid={bad}
                          style={bad ? { borderColor: 'var(--danger, #c0392b)' } : undefined}
                          onChange={(e) =>
                            setQuantities((s) => ({ ...s, [l.invoice_item_id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Collected by</label>
              <input
                value={meta.collected_by}
                onChange={(e) => setMeta({ ...meta, collected_by: e.target.value })}
                placeholder="Name of person collecting"
                required
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                value={meta.collector_phone}
                onChange={(e) => setMeta({ ...meta, collector_phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label>ID / waybill reference</label>
              <input
                value={meta.id_reference}
                onChange={(e) => setMeta({ ...meta, id_reference: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="field">
              <label>Notes</label>
              <input
                value={meta.notes}
                onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || Boolean(invalid) || !anyQty}>
            {busy ? 'Releasing…' : 'Release goods'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
