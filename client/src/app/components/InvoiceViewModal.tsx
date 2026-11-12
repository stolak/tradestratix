import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

type Props = {
  invoiceId: string;
  onClose: () => void;
  /** Resolve `false` to keep the modal open (e.g. post failed). */
  onPost?: (id: string) => Promise<boolean | void> | boolean | void;
  canPost?: boolean;
  /** Called after an order action (cancel, reallocate, allocate) changed the invoice. */
  onChanged?: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'draft',
  posted: 'confirmed',
  cancelled: 'cancelled'
};

const n = (v: unknown) => Number(v || 0);

/** Reserved (uncollected) and backordered quantities per line, in the line UoM. */
function lineStock(it: any) {
  const factor = n(it.base_quantity) > 0 ? n(it.quantity) / n(it.base_quantity) : 1;
  const byWh = new Map<string, { name: string; branch: string; qty: number }>();
  for (const r of it.reservations || []) {
    if (r.status !== 'active') continue;
    const left = (n(r.quantity) - n(r.fulfilled_quantity) - n(r.released_quantity)) * factor;
    if (left <= 1e-9) continue;
    const row = byWh.get(r.warehouse_id) || {
      name: r.warehouse?.code || r.warehouse?.name || 'warehouse',
      branch: r.warehouse?.branch?.name || '',
      qty: 0
    };
    row.qty += left;
    byWh.set(r.warehouse_id, row);
  }
  const reserved = [...byWh.values()].reduce((s, r) => s + r.qty, 0);
  const backordered = Math.max(
    0,
    n(it.quantity) - n(it.fulfilled_quantity) - n(it.cancelled_quantity) - reserved
  );
  return { byWh, reserved, backordered };
}

function q(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const FULFILMENT_LABELS: Record<string, string> = {
  pending: 'to collect',
  partial: 'part collected',
  fulfilled: 'collected'
};

function fmtDate(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export const InvoiceViewModal: React.FC<Props> = ({ invoiceId, onClose, onPost, canPost, onChanged }) => {
  const { can } = useAuth();
  const [invoice, setInvoice] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInvoice(null);
    setError(null);
    api.sales
      .getInvoice(invoiceId)
      .then((row) => {
        if (!cancelled) setInvoice(row);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Could not load invoice');
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

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

  const items: any[] = invoice?.items || [];
  const allocations: any[] = invoice?.allocations || [];
  const fulfilments: any[] = invoice?.fulfilments || [];
  const isPickup = invoice?.fulfilment_mode === 'pickup';
  const soldElsewhere =
    invoice?.selling_branch_id && invoice?.branch_id && invoice.selling_branch_id !== invoice.branch_id;
  const discountTotal = items.reduce((sum, it) => {
    if (it.gross_unit_price == null) return sum;
    return sum + (Number(it.gross_unit_price) - Number(it.unit_price)) * Number(it.quantity);
  }, 0);

  const handlePost = async () => {
    if (!onPost || !invoice) return;
    setPosting(true);
    try {
      const ok = await onPost(invoice.id);
      if (ok !== false) onClose();
    } finally {
      setPosting(false);
    }
  };

  const stockByLine = new Map(items.map((it) => [it.id, lineStock(it)]));
  const openQty = items.reduce(
    (s, it) => s + Math.max(0, n(it.quantity) - n(it.fulfilled_quantity) - n(it.cancelled_quantity)),
    0
  );
  const reservedWarehouses = new Map<string, string>();
  for (const it of items) {
    for (const [id, w] of stockByLine.get(it.id)!.byWh) {
      reservedWarehouses.set(id, `${w.branch ? `${w.branch} · ` : ''}${w.name}`);
    }
  }
  const backorderedQty = items.reduce((s, it) => s + stockByLine.get(it.id)!.backordered, 0);
  const isOpenOrder = invoice?.status === 'posted' && invoice?.recognition_policy === 'at_fulfilment';
  const canCancel =
    can('sales.cancel') && (invoice?.status === 'draft' || (isOpenOrder && openQty > 1e-9));
  const canReallocate = can('fulfilment.reallocate') && isOpenOrder && isPickup && reservedWarehouses.size > 0;
  const canAllocate =
    (can('fulfilment.reallocate') || can('sales.post')) && isOpenOrder && isPickup && backorderedQty > 1e-9;

  const runAction = async (fn: () => Promise<any>, success: string) => {
    setActing(true);
    try {
      const updated = await fn();
      setInvoice(updated);
      await alertSuccess(success);
      onChanged?.();
    } catch (err: any) {
      await alertError('Action failed', err.message);
    } finally {
      setActing(false);
    }
  };

  const cancelOrder = async () => {
    const partial = invoice.status === 'posted' && items.some((it) => n(it.fulfilled_quantity) > 0);
    const r = await Swal.fire({
      icon: 'warning',
      title: partial ? 'Close the uncollected balance?' : 'Cancel this order?',
      text: partial
        ? 'Goods not yet collected are released back to stock. Collected goods stay invoiced. Any deposit beyond the collected value becomes customer credit.'
        : 'All reserved stock is released. Any deposit becomes customer credit that can be refunded or used on another invoice.',
      input: 'text',
      inputLabel: 'Reason',
      inputValidator: (v) => (String(v || '').trim() ? undefined : 'A reason is required'),
      showCancelButton: true,
      confirmButtonText: partial ? 'Close balance' : 'Cancel order',
      confirmButtonColor: '#b03a2e'
    });
    if (!r.isConfirmed) return;
    await runAction(
      () => api.sales.cancelOrder(invoice.id, { reason: String(r.value).trim() }),
      partial ? 'Uncollected balance closed' : 'Order cancelled'
    );
  };

  const reallocate = async () => {
    const from = Object.fromEntries(reservedWarehouses);
    const pick = await Swal.fire({
      title: 'Move reserved stock',
      text: 'Release this order’s reservation in a warehouse and reserve the same quantity elsewhere.',
      input: 'select',
      inputOptions: from,
      inputLabel: 'Move away from',
      showCancelButton: true,
      confirmButtonText: 'Next',
      confirmButtonColor: '#0f5c4c'
    });
    if (!pick.isConfirmed || !pick.value) return;
    const reason = await Swal.fire({
      title: 'Reason for reallocation',
      text: 'Stock is re-reserved automatically from the other warehouses with free stock.',
      input: 'text',
      inputValidator: (v) => (String(v || '').trim() ? undefined : 'A reason is required'),
      showCancelButton: true,
      confirmButtonText: 'Reallocate',
      confirmButtonColor: '#0f5c4c'
    });
    if (!reason.isConfirmed) return;
    await runAction(
      () =>
        api.sales.reallocateOrder(invoice.id, {
          from_warehouse_id: String(pick.value),
          reason: String(reason.value).trim()
        }),
      'Reservation moved'
    );
  };

  const allocateBackorders = () =>
    runAction(() => api.sales.allocateBackorders(invoice.id), 'Backordered quantities reserved');

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal invoice-view" role="dialog" aria-modal="true" aria-label="Invoice">
        <div className="modal__header">
          <div>
            <div className="invoice-view__eyebrow">
              {invoice?.channel === 'pos' ? 'POS receipt' : 'Sales invoice'}
            </div>
            <h2 className="display invoice-view__number">
              {invoice?.invoice_number || 'Loading…'}
            </h2>
          </div>
          <div className="modal__actions no-print">
            {invoice ? (
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                <Printer size={16} /> Print
              </button>
            ) : null}
            <button type="button" className="line-items__remove" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal__body">
          {error ? <div className="invoice-view__error">{error}</div> : null}
          {!invoice && !error ? <div className="invoice-view__loading">Loading invoice…</div> : null}

          {invoice ? (
            <>
              <div className="invoice-view__chips">
                <span className={`invoice-chip invoice-chip--${invoice.status}`}>
                  {STATUS_LABELS[invoice.status] || invoice.status}
                </span>
                <span className={`invoice-chip invoice-chip--${invoice.payment_status}`}>
                  {invoice.payment_status}
                </span>
                {invoice.status === 'posted' ? (
                  <span className={`invoice-chip invoice-chip--${invoice.fulfilment_status}`}>
                    {FULFILMENT_LABELS[invoice.fulfilment_status] || invoice.fulfilment_status}
                  </span>
                ) : isPickup ? (
                  <span className="invoice-chip invoice-chip--pending">pickup</span>
                ) : null}
              </div>

              <div className="invoice-view__meta">
                <div>
                  <div className="invoice-view__label">Bill to</div>
                  <div className="invoice-view__strong">{invoice.customer?.name || '—'}</div>
                  {invoice.customer?.code ? <div>{invoice.customer.code}</div> : null}
                  {invoice.customer?.phone ? <div>{invoice.customer.phone}</div> : null}
                  {invoice.customer?.email ? <div>{invoice.customer.email}</div> : null}
                </div>
                <dl className="invoice-view__facts">
                  <dt>Invoice date</dt>
                  <dd>{fmtDate(invoice.invoice_date)}</dd>
                  <dt>Due date</dt>
                  <dd>{fmtDate(invoice.due_date)}</dd>
                  <dt>{soldElsewhere ? 'Revenue branch' : 'Branch'}</dt>
                  <dd>{invoice.branch?.name || '—'}</dd>
                  {soldElsewhere ? (
                    <>
                      <dt>Sold at</dt>
                      <dd>{invoice.selling_branch?.name || '—'}</dd>
                    </>
                  ) : null}
                  <dt>{isPickup ? 'Pickup from' : 'Warehouse'}</dt>
                  <dd>
                    {invoice.warehouse?.name || '—'}
                    {isPickup && invoice.warehouse?.branch?.name
                      ? ` (${invoice.warehouse.branch.name})`
                      : ''}
                  </dd>
                  <dt>Sales rep</dt>
                  <dd>{invoice.sales_rep?.name || '—'}</dd>
                  {invoice.posted_at ? (
                    <>
                      <dt>Confirmed</dt>
                      <dd>{fmtDate(invoice.posted_at)}</dd>
                    </>
                  ) : null}
                  {isOpenOrder && isPickup && invoice.reservation_expires_at ? (
                    <>
                      <dt>Stock held until</dt>
                      <dd>{fmtDate(invoice.reservation_expires_at)}</dd>
                    </>
                  ) : null}
                  {invoice.credit_override_reason ? (
                    <>
                      <dt>Credit override</dt>
                      <dd>{invoice.credit_override_reason}</dd>
                    </>
                  ) : null}
                  {invoice.cancel_reason ? (
                    <>
                      <dt>{invoice.status === 'cancelled' ? 'Cancelled' : 'Closed short'}</dt>
                      <dd>{invoice.cancel_reason}</dd>
                    </>
                  ) : null}
                </dl>
              </div>

              <div className="line-items">
                <table className="line-items__table">
                  <thead>
                    <tr>
                      <th className="line-items__index">#</th>
                      <th>Product</th>
                      <th>UoM</th>
                      <th className="num">Qty</th>
                      {isPickup ? <th className="num">Collected</th> : null}
                      <th className="num">Unit price</th>
                      <th className="num">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id}>
                        <td className="line-items__index">{idx + 1}</td>
                        <td>
                          <div className="invoice-view__strong">{it.product?.name || '—'}</div>
                          <div className="invoice-view__sub">
                            {[it.product?.sku, it.variant?.name].filter(Boolean).join(' · ')}
                          </div>
                          {isPickup && it.fulfilment_warehouse && !stockByLine.get(it.id)?.byWh.size ? (
                            <div className="invoice-view__sub">
                              Pickup: {it.fulfilment_warehouse.name}
                              {it.fulfilment_warehouse.branch?.name
                                ? ` (${it.fulfilment_warehouse.branch.name})`
                                : ''}
                            </div>
                          ) : null}
                          {isPickup && stockByLine.get(it.id)?.byWh.size ? (
                            <div className="invoice-view__sub">
                              Reserved:{' '}
                              {[...stockByLine.get(it.id)!.byWh.values()]
                                .map((w) => `${q(w.qty)} at ${w.name}${w.branch ? ` (${w.branch})` : ''}`)
                                .join(' · ')}
                            </div>
                          ) : null}
                          {isOpenOrder && (stockByLine.get(it.id)?.backordered || 0) > 1e-9 ? (
                            <div className="customer-terms__over">
                              {q(stockByLine.get(it.id)!.backordered)} backordered
                            </div>
                          ) : null}
                          {n(it.cancelled_quantity) > 0 ? (
                            <div className="invoice-view__sub">{q(n(it.cancelled_quantity))} cancelled</div>
                          ) : null}
                        </td>
                        <td>{it.uom?.code || it.uom?.name || '—'}</td>
                        <td className="num">{Number(it.quantity).toLocaleString()}</td>
                        {isPickup ? (
                          <td className="num">{Number(it.fulfilled_quantity || 0).toLocaleString()}</td>
                        ) : null}
                        <td className="num">
                          {money(it.unit_price)}
                          {it.gross_unit_price != null && it.discount_percent ? (
                            <div className="line-items__discount-note">
                              −{Number(it.discount_percent)}% · was {money(it.gross_unit_price)}
                            </div>
                          ) : null}
                        </td>
                        <td className="num line-items__subtotal">{money(it.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoice-view__bottom">
                <div className="invoice-view__notes">
                  {invoice.notes ? (
                    <>
                      <div className="invoice-view__label">Notes</div>
                      <div>{invoice.notes}</div>
                    </>
                  ) : null}
                  {allocations.length ? (
                    <div style={{ marginTop: invoice.notes ? '1rem' : 0 }}>
                      <div className="invoice-view__label">Payments</div>
                      {allocations.map((a) => (
                        <div key={a.id} className="invoice-view__payment">
                          <span>
                            {a.payment?.payment_number} · {a.payment?.method} ·{' '}
                            {fmtDate(a.payment?.payment_date)}
                          </span>
                          <span>{money(a.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {isPickup && fulfilments.length ? (
                    <div style={{ marginTop: invoice.notes || allocations.length ? '1rem' : 0 }}>
                      <div className="invoice-view__label">Collections</div>
                      {fulfilments.map((f) => (
                        <div key={f.id} className="invoice-view__payment">
                          <span>
                            {f.fulfilment_number} · {f.warehouse?.name} · {fmtDate(f.fulfilled_at)}
                            {f.collected_by ? ` · ${f.collected_by}` : ''}
                          </span>
                          <span>
                            {(f.items || []).length} line{(f.items || []).length === 1 ? '' : 's'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <dl className="invoice-view__totals">
                  {discountTotal > 0 ? (
                    <>
                      <dt>Branch discount (in prices)</dt>
                      <dd>−{money(discountTotal)}</dd>
                    </>
                  ) : null}
                  <dt>Subtotal</dt>
                  <dd>{money(invoice.subtotal)}</dd>
                  {Number(invoice.discount_amount) > 0 ? (
                    <>
                      <dt>Customer discount −{Number(invoice.discount_percent)}%</dt>
                      <dd>−{money(invoice.discount_amount)}</dd>
                    </>
                  ) : null}
                  {Number(invoice.tax_amount) ? (
                    <>
                      <dt>Tax</dt>
                      <dd>{money(invoice.tax_amount)}</dd>
                    </>
                  ) : null}
                  <dt className="invoice-view__grand">Total</dt>
                  <dd className="invoice-view__grand">{money(invoice.total_amount)}</dd>
                  {n(invoice.cancelled_amount) > 0 ? (
                    <>
                      <dt>Cancelled</dt>
                      <dd>−{money(invoice.cancelled_amount)}</dd>
                    </>
                  ) : null}
                  {invoice.recognition_policy === 'at_fulfilment' && invoice.status === 'posted' ? (
                    <>
                      <dt>Invoiced on hand-over</dt>
                      <dd>{money(invoice.recognised_amount)}</dd>
                    </>
                  ) : null}
                  <dt>Paid</dt>
                  <dd>{money(invoice.amount_paid)}</dd>
                  {n(invoice.deposit_held) > 0 ? (
                    <>
                      <dt>Held as deposit</dt>
                      <dd>{money(invoice.deposit_held)}</dd>
                    </>
                  ) : null}
                  <dt className="invoice-view__balance">Balance due</dt>
                  <dd className="invoice-view__balance">{money(invoice.balance)}</dd>
                </dl>
              </div>
            </>
          ) : null}
        </div>

        {invoice && ((invoice.status === 'draft' && canPost && onPost) || canCancel || canReallocate || canAllocate) ? (
          <div className="modal__footer no-print">
            {canCancel ? (
              <button
                type="button"
                className="btn btn-ghost invoice-view__danger"
                onClick={() => void cancelOrder()}
                disabled={acting}
              >
                {invoice.status === 'posted' && items.some((it) => n(it.fulfilled_quantity) > 0)
                  ? 'Close balance'
                  : 'Cancel order'}
              </button>
            ) : null}
            {canReallocate ? (
              <button type="button" className="btn btn-ghost" onClick={() => void reallocate()} disabled={acting}>
                Reallocate
              </button>
            ) : null}
            {canAllocate ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void allocateBackorders()}
                disabled={acting}
              >
                Allocate backorder
              </button>
            ) : null}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            {invoice.status === 'draft' && canPost && onPost ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handlePost()}
                disabled={posting}
              >
                {posting ? 'Confirming…' : 'Confirm order'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};
