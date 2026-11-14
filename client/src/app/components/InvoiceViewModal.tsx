import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { ReceiveCustomerPayment } from './ReceiveCustomerPayment';

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

const DELIVERY_LABELS: Record<string, string> = {
  pending: 'to deliver',
  partial: 'part delivered',
  fulfilled: 'delivered'
};

const TASK_LABELS: Record<string, string> = {
  picking: 'picking',
  ready_for_collection: 'ready',
  picked: 'awaiting dispatch',
  dispatched: 'out for delivery',
  released: 'collected',
  delivered: 'delivered',
  cancelled: 'cancelled',
  discrepancy: 'discrepancy'
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
  const [showPay, setShowPay] = useState(false);

  const reloadInvoice = async () => {
    const row = await api.sales.getInvoice(invoiceId);
    setInvoice(row);
    return row;
  };

  useEffect(() => {
    let cancelled = false;
    setInvoice(null);
    setError(null);
    setShowPay(false);
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
  const isDelivery = invoice?.fulfilment_mode === 'delivery';
  const isPickup = invoice?.fulfilment_mode === 'pickup' || isDelivery;
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
  const returnableQty = items.reduce(
    (s, it) => s + Math.max(0, n(it.fulfilled_quantity) - n(it.returned_quantity)),
    0
  );
  const canReturn = can('sales.return') && returnableQty > 1e-9;
  const canAmend =
    can('sales.amend') &&
    isOpenOrder &&
    !(invoice?.fulfilment_mode === 'immediate' && invoice?.fulfilment_status === 'fulfilled');
  const canPay = can('sales.post') && invoice?.status === 'posted' && Boolean(invoice?.customer_id);

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

  const canReissueCode =
    (can('sales.post') || can('sales.approve')) &&
    isOpenOrder &&
    invoice?.fulfilment_mode === 'pickup' &&
    invoice?.fulfilment_status !== 'fulfilled';
  const reissueCode = async () => {
    const r = await Swal.fire({
      title: 'Reissue pickup code?',
      text: 'The old code stops working immediately.',
      input: 'text',
      inputLabel: 'Reason',
      inputValidator: (v) => (String(v || '').trim() ? undefined : 'A reason is required'),
      showCancelButton: true,
      confirmButtonText: 'Reissue',
      confirmButtonColor: '#0f5c4c'
    });
    if (!r.isConfirmed) return;
    try {
      const res = await api.sales.reissuePickupCode(invoice.id, String(r.value).trim());
      setInvoice({ ...invoice, pickup_code: res.pickup_code, pickup_code_expires_at: res.pickup_code_expires_at, pickup_code_failures: 0 });
      await Swal.fire({
        icon: 'success',
        title: 'New pickup code',
        html: `<div class="pickup-code">${res.pickup_code}</div>Share it with the customer.`,
        confirmButtonColor: '#0f5c4c'
      });
    } catch (err: any) {
      await alertError('Reissue failed', err.message);
    }
  };

  const amendOrder = async () => {
    const openLines = items.filter(
      (it) => n(it.quantity) - n(it.fulfilled_quantity) - n(it.cancelled_quantity) > 1e-9
    );
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
    const rows = openLines
      .map(
        (it) => `
        <tr>
          <td style="text-align:left">${esc(it.product?.name || '')}</td>
          <td>${q(n(it.fulfilled_quantity))} / ${q(n(it.quantity) - n(it.cancelled_quantity))}</td>
          <td><input class="swal2-input" data-line="${it.id}" type="number" min="${n(it.fulfilled_quantity)}" step="any" value="${
            n(it.quantity) - n(it.cancelled_quantity)
          }" style="width:5.5rem;margin:0" /></td>
        </tr>`
      )
      .join('');
    const qtyBlock = openLines.length
      ? `<p style="margin:0;color:var(--ink-muted);font-size:0.9rem">
            Lowering quantity cancels the uncollected difference. Raising it reserves more stock (backorder allowed).
            Collected quantities cannot be reduced — use a return.
          </p>
          <table class="table" style="font-size:0.9rem"><thead><tr><th>Product</th><th>Collected / ordered</th><th>New qty</th></tr></thead>
          <tbody>${rows}</tbody></table>`
      : `<p style="margin:0;color:var(--ink-muted);font-size:0.9rem">All lines are fully collected — you can still update notes or delivery details.</p>`;
    const r = await Swal.fire({
      title: 'Amend order',
      width: 560,
      html: `
        <div style="text-align:left;display:grid;gap:10px">
          ${qtyBlock}
          <label>Notes<textarea id="amd-notes" class="swal2-textarea" style="width:100%;min-height:4rem">${esc(invoice.notes)}</textarea></label>
          ${
            isDelivery
              ? `<label>Delivery address<input id="amd-addr" class="swal2-input" style="width:100%" value="${esc(invoice.delivery_address)}" /></label>
                 <label>Delivery contact<input id="amd-contact" class="swal2-input" style="width:100%" value="${esc(invoice.delivery_contact)}" /></label>
                 <label>Delivery phone<input id="amd-phone" class="swal2-input" style="width:100%" value="${esc(invoice.delivery_phone)}" /></label>`
              : ''
          }
          <label>Reason<input id="amd-reason" class="swal2-input" style="width:100%" /></label>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Save amendment',
      confirmButtonColor: '#0f5c4c',
      preConfirm: () => {
        const reason = String((document.getElementById('amd-reason') as HTMLInputElement)?.value || '').trim();
        if (!reason) {
          Swal.showValidationMessage('A reason is required');
          return;
        }
        const lines: { invoice_item_id: string; quantity: number }[] = [];
        for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[data-line]'))) {
          const quantity = Number(input.value);
          if (!(quantity >= 0)) {
            Swal.showValidationMessage('Enter a valid quantity');
            return;
          }
          lines.push({ invoice_item_id: input.dataset.line!, quantity });
        }
        return {
          reason,
          lines,
          notes: String((document.getElementById('amd-notes') as HTMLTextAreaElement)?.value ?? ''),
          delivery_address: String((document.getElementById('amd-addr') as HTMLInputElement)?.value ?? ''),
          delivery_contact: String((document.getElementById('amd-contact') as HTMLInputElement)?.value ?? ''),
          delivery_phone: String((document.getElementById('amd-phone') as HTMLInputElement)?.value ?? '')
        };
      }
    });
    if (!r.isConfirmed || !r.value) return;
    const payload: Record<string, unknown> = {
      reason: r.value.reason,
      notes: r.value.notes,
      allow_backorder: true
    };
    if (r.value.lines.length) payload.lines = r.value.lines;
    if (isDelivery) {
      payload.delivery_address = r.value.delivery_address;
      payload.delivery_contact = r.value.delivery_contact;
      payload.delivery_phone = r.value.delivery_phone;
    }
    await runAction(() => api.sales.amendOrder(invoice.id, payload), 'Order amended');
  };

  const returnGoods = async () => {
    setActing(true);
    try {
      const preview = await api.sales.returnPreview(invoice.id);
      const warehouses = await api.warehouses.list();
      if (!preview.lines?.length) {
        await alertError('Nothing to return', 'All handed-over quantities have already been returned.');
        return;
      }
      const whOptions = warehouses
        .map(
          (w: any) =>
            `<option value="${w.id}">${w.branch?.name || ''} · ${w.code} — ${w.name}${
              w.category && w.category !== 'main' ? ` (${w.category})` : ''
            }</option>`
        )
        .join('');
      const lineRows = preview.lines
        .map(
          (l: any) => `
          <tr>
            <td style="text-align:left">${l.product?.name || ''}<div class="invoice-view__sub">${l.product?.sku || ''}</div></td>
            <td>${q(l.returnable_quantity)}</td>
            <td><input class="swal2-input" data-line="${l.invoice_item_id}" type="number" min="0" max="${l.returnable_quantity}" step="any" value="${l.returnable_quantity}" style="width:5.5rem;margin:0" /></td>
          </tr>`
        )
        .join('');
      const r = await Swal.fire({
        title: 'Return goods',
        width: 640,
        html: `
          <div style="text-align:left;display:grid;gap:10px">
            <label>Receive into warehouse
              <select id="ret-wh" class="swal2-select" style="width:100%">${whOptions}</select>
            </label>
            <label>Condition
              <select id="ret-cond" class="swal2-select" style="width:100%">
                <option value="saleable">Saleable (restock)</option>
                <option value="damaged">Damaged (write-off unless damaged warehouse)</option>
                <option value="quarantine">Quarantine</option>
              </select>
            </label>
            <label>Settlement
              <select id="ret-settle" class="swal2-select" style="width:100%">
                <option value="credit_note">Customer credit / reduce balance</option>
                <option value="refund">Cash / bank refund</option>
              </select>
            </label>
            <table class="table" style="font-size:0.9rem"><thead><tr><th>Product</th><th>Returnable</th><th>Qty</th></tr></thead>
            <tbody>${lineRows}</tbody></table>
            <label>Reason<input id="ret-reason" class="swal2-input" style="width:100%" placeholder="Why are the goods coming back?" /></label>
          </div>`,
        showCancelButton: true,
        confirmButtonText: 'Post return',
        confirmButtonColor: '#0f5c4c',
        preConfirm: () => {
          const warehouse_id = (document.getElementById('ret-wh') as HTMLSelectElement)?.value;
          const condition = (document.getElementById('ret-cond') as HTMLSelectElement)?.value || 'saleable';
          const settlement = (document.getElementById('ret-settle') as HTMLSelectElement)?.value || 'credit_note';
          const reason = String((document.getElementById('ret-reason') as HTMLInputElement)?.value || '').trim();
          if (!reason) {
            Swal.showValidationMessage('A reason is required');
            return;
          }
          const items: { invoice_item_id: string; quantity: number }[] = [];
          for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[data-line]'))) {
            const quantity = Number(input.value);
            if (quantity > 0) items.push({ invoice_item_id: input.dataset.line!, quantity });
          }
          if (!items.length) {
            Swal.showValidationMessage('Enter a quantity on at least one line');
            return;
          }
          return { warehouse_id, condition, settlement, reason, items };
        }
      });
      if (!r.isConfirmed || !r.value) return;
      let refund_account_id: string | undefined;
      if (r.value.settlement === 'refund') {
        const defaults = await api.accounting.defaultAccounts();
        const cash = defaults.find((d: any) => d.setting_key === 'cash' || d.key === 'cash');
        refund_account_id = cash?.account_id || cash?.accountId;
        if (!refund_account_id) {
          await alertError('Refund account missing', 'Map a default Cash account under Accounting → Default accounts.');
          return;
        }
      }
      const draft = await api.sales.createReturn({
        invoice_id: invoice.id,
        warehouse_id: r.value.warehouse_id,
        condition: r.value.condition,
        settlement: r.value.settlement,
        reason: r.value.reason,
        refund_account_id,
        items: r.value.items
      });
      const posted = await api.sales.postReturn(draft.id, {
        reason: r.value.reason,
        settlement: r.value.settlement,
        refund_account_id
      });
      const refreshed = await api.sales.getInvoice(invoice.id);
      setInvoice(refreshed);
      await alertSuccess(
        `Return ${posted.return_number} posted`,
        posted.credit_issued > 0
          ? `${Number(posted.credit_issued).toLocaleString()} held as customer credit`
          : posted.refund_amount > 0
            ? `${Number(posted.refund_amount).toLocaleString()} refunded`
            : 'Invoice balance updated'
      );
      onChanged?.();
    } catch (err: any) {
      await alertError('Return failed', err.message);
    } finally {
      setActing(false);
    }
  };

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
                    {(isDelivery ? DELIVERY_LABELS : FULFILMENT_LABELS)[invoice.fulfilment_status] ||
                      invoice.fulfilment_status}
                  </span>
                ) : isPickup ? (
                  <span className="invoice-chip invoice-chip--pending">{isDelivery ? 'delivery' : 'pickup'}</span>
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
                  <dt>{isDelivery ? 'Ship from' : isPickup ? 'Pickup from' : 'Warehouse'}</dt>
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
                  {isDelivery && invoice.delivery_address ? (
                    <>
                      <dt>Deliver to</dt>
                      <dd>
                        {invoice.delivery_address}
                        {invoice.delivery_contact || invoice.delivery_phone
                          ? ` · ${[invoice.delivery_contact, invoice.delivery_phone].filter(Boolean).join(', ')}`
                          : ''}
                      </dd>
                    </>
                  ) : null}
                  {isOpenOrder && invoice.fulfilment_mode === 'pickup' && invoice.fulfilment_status !== 'fulfilled' &&
                  (invoice.pickup_code || invoice.has_pickup_code) ? (
                    <>
                      <dt>Pickup code</dt>
                      <dd>
                        {invoice.pickup_code ? (
                          <strong style={{ letterSpacing: '0.15em' }}>{invoice.pickup_code}</strong>
                        ) : (
                          'issued (shown to the selling branch)'
                        )}
                        {invoice.pickup_code_failures >= 5 ? <span className="invoice-view__danger"> · locked</span> : null}
                        {invoice.pickup_code_expires_at ? ` · until ${fmtDate(invoice.pickup_code_expires_at)}` : ''}
                        {canReissueCode && invoice.pickup_code ? (
                          <button type="button" className="btn-linkish no-print" style={{ marginLeft: 8 }} onClick={() => void reissueCode()}>
                            Reissue
                          </button>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                  {Array.isArray(invoice.authorised_collectors) && invoice.authorised_collectors.length ? (
                    <>
                      <dt>Also may collect</dt>
                      <dd>{invoice.authorised_collectors.map((c: any) => c.name).join(', ')}</dd>
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
                      {isPickup ? <th className="num">{isDelivery ? 'Delivered' : 'Collected'}</th> : null}
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
                          {n(it.returned_quantity) > 0 ? (
                            <div className="invoice-view__sub">{q(n(it.returned_quantity))} returned</div>
                          ) : null}
                          {(() => {
                            const track =
                              it.tracking ||
                              (it.product?.track_batch ||
                              it.product?.track_expiry ||
                              it.product?.track_serial
                                ? {
                                    track_batch: !!it.product?.track_batch,
                                    track_expiry: !!it.product?.track_expiry,
                                    track_serial: !!it.product?.track_serial,
                                    lots: [],
                                    serial_numbers: []
                                  }
                                : null);
                            if (!track) return null;
                            const lots: any[] = track.lots || [];
                            const serials: string[] = track.serial_numbers || [];
                            const showLot = track.track_batch || track.track_expiry;
                            return (
                              <div className="invoice-view__sub" style={{ marginTop: 4 }}>
                                {showLot ? (
                                  <div>
                                    Batch / expiry:{' '}
                                    {lots.length
                                      ? lots
                                          .map((l: any) => {
                                            const bits = [
                                              l.batch_number && l.batch_number !== 'BULK'
                                                ? l.batch_number
                                                : null,
                                              l.expiry_date ? `exp ${fmtDate(l.expiry_date)}` : null,
                                              Number(l.quantity) > 0
                                                ? `× ${q(Number(l.quantity))}`
                                                : null
                                            ].filter(Boolean);
                                            return bits.length
                                              ? bits.join(' · ')
                                              : l.batch_number || 'lot';
                                          })
                                          .join('; ')
                                      : 'pending pick'}
                                  </div>
                                ) : null}
                                {track.track_serial ? (
                                  <div>
                                    Serials: {serials.length ? serials.join(', ') : 'pending pick'}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}
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
                      <div className="invoice-view__label">Collection history</div>
                      {(() => {
                        const orderedTotal = items.reduce(
                          (s, it) => s + Math.max(0, Number(it.quantity || 0) - Number(it.cancelled_quantity || 0)),
                          0
                        );
                        const handedStatuses = new Set(['released', 'delivered']);
                        let runningCollected = 0;
                        const rows = [...fulfilments].sort(
                          (a, b) =>
                            new Date(a.fulfilled_at || a.dispatched_at || a.picked_at || a.created_at || 0).getTime() -
                            new Date(b.fulfilled_at || b.dispatched_at || b.picked_at || b.created_at || 0).getTime()
                        );
                        return (
                          <div style={{ display: 'grid', gap: 10 }}>
                            {rows.map((f) => {
                              const fItems: any[] = f.items || [];
                              const received = fItems.reduce((s, li) => s + Number(li.quantity || 0), 0);
                              const short = fItems.reduce(
                                (s, li) => s + Number(li.short_quantity || 0) + Number(li.damaged_quantity || 0),
                                0
                              );
                              const planned = fItems.reduce(
                                (s, li) =>
                                  s +
                                  Number(
                                    li.planned_quantity ||
                                      li.picked_quantity ||
                                      li.quantity ||
                                      0
                                  ),
                                0
                              );
                              if (handedStatuses.has(f.status)) runningCollected += received;
                              const balanceAfter = Math.max(0, orderedTotal - runningCollected);
                              return (
                                <div key={f.id} className="invoice-view__fulfil-card">
                                  <div className="invoice-view__payment" style={{ marginBottom: 6 }}>
                                    <span>
                                      <strong>{f.fulfilment_number}</strong>
                                      {f.warehouse?.name ? ` · ${f.warehouse.name}` : ''}
                                      {f.branch?.name ? ` (${f.branch.name})` : ''}
                                      {' · '}
                                      {fmtDate(f.fulfilled_at || f.dispatched_at || f.picked_at || f.created_at)}
                                      {f.collected_by ? ` · ${f.collected_by}` : ''}
                                      {f.delivery_order ? ` · ${f.delivery_order.delivery_number}` : ''}
                                    </span>
                                    <span>{TASK_LABELS[f.status] || f.status}</span>
                                  </div>
                                  <div className="table-wrap">
                                    <table className="table" style={{ margin: 0 }}>
                                      <thead>
                                        <tr>
                                          <th>Product</th>
                                          <th className="num">Received</th>
                                          {!handedStatuses.has(f.status) ? (
                                            <th className="num">Planned</th>
                                          ) : null}
                                          {short > 1e-9 ? <th className="num">Short / damaged</th> : null}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {fItems.map((li) => {
                                          const ii = li.invoice_item || {};
                                          const uom = ii.uom?.code || '';
                                          const name =
                                            ii.product?.name ||
                                            items.find((it) => it.id === li.invoice_item_id)?.product?.name ||
                                            'Line';
                                          const variant =
                                            ii.variant?.name ||
                                            items.find((it) => it.id === li.invoice_item_id)?.variant?.name;
                                          const recv = Number(li.quantity || 0);
                                          const sh =
                                            Number(li.short_quantity || 0) + Number(li.damaged_quantity || 0);
                                          const plan = Number(
                                            li.planned_quantity || li.picked_quantity || li.quantity || 0
                                          );
                                          return (
                                            <tr key={li.invoice_item_id || `${f.id}-${name}`}>
                                              <td>
                                                <div className="invoice-view__strong">{name}</div>
                                                {variant ? (
                                                  <div className="invoice-view__sub">{variant}</div>
                                                ) : null}
                                              </td>
                                              <td className="num">
                                                {recv.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                                {uom ? ` ${uom}` : ''}
                                              </td>
                                              {!handedStatuses.has(f.status) ? (
                                                <td className="num">
                                                  {plan.toLocaleString(undefined, {
                                                    maximumFractionDigits: 4
                                                  })}
                                                  {uom ? ` ${uom}` : ''}
                                                </td>
                                              ) : null}
                                              {short > 1e-9 ? (
                                                <td className="num">
                                                  {sh > 1e-9 ? (
                                                    <span className="invoice-view__danger">
                                                      {sh.toLocaleString(undefined, {
                                                        maximumFractionDigits: 4
                                                      })}
                                                      {uom ? ` ${uom}` : ''}
                                                      {Number(li.damaged_quantity) > 1e-9 ? ' damaged' : ''}
                                                      {Number(li.short_quantity) > 1e-9 ? ' not found' : ''}
                                                    </span>
                                                  ) : (
                                                    '—'
                                                  )}
                                                </td>
                                              ) : null}
                                            </tr>
                                          );
                                        })}
                                        {!fItems.length ? (
                                          <tr>
                                            <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                                              No line detail
                                            </td>
                                          </tr>
                                        ) : null}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="invoice-view__sub" style={{ marginTop: 4 }}>
                                    {handedStatuses.has(f.status)
                                      ? `Received this hand-over: ${received.toLocaleString(undefined, {
                                          maximumFractionDigits: 4
                                        })}${
                                          short > 1e-9
                                            ? ` · Short/damaged: ${short.toLocaleString(undefined, {
                                                maximumFractionDigits: 4
                                              })}`
                                            : ''
                                        } · Order remaining after this: ${balanceAfter.toLocaleString(undefined, {
                                          maximumFractionDigits: 4
                                        })} of ${orderedTotal.toLocaleString(undefined, {
                                          maximumFractionDigits: 4
                                        })}`
                                      : `In progress · planned ${planned.toLocaleString(undefined, {
                                          maximumFractionDigits: 4
                                        })}`}
                                    {f.discrepancy_notes ? (
                                      <span className="invoice-view__danger"> · {f.discrepancy_notes}</span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                            {(() => {
                              const remaining = Math.max(
                                0,
                                orderedTotal -
                                  items.reduce((s, it) => s + Number(it.fulfilled_quantity || 0), 0)
                              );
                              return (
                                <div className="invoice-view__payment" style={{ fontWeight: 600 }}>
                                  <span>Order collection total</span>
                                  <span>
                                    {items
                                      .reduce((s, it) => s + Number(it.fulfilled_quantity || 0), 0)
                                      .toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                                    received
                                    {remaining > 1e-9
                                      ? ` · ${remaining.toLocaleString(undefined, {
                                          maximumFractionDigits: 4
                                        })} remaining`
                                      : ' · complete'}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
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
              {showPay && invoice.customer_id ? (
                <ReceiveCustomerPayment
                  customerId={invoice.customer_id}
                  invoiceId={invoice.id}
                  hideHistory
                  onDone={async () => {
                    await reloadInvoice();
                    onChanged?.();
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {invoice &&
        ((invoice.status === 'draft' && canPost && onPost) ||
          canCancel ||
          canReallocate ||
          canAllocate ||
          canReturn ||
          canAmend ||
          canPay) ? (
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
            {canAmend ? (
              <button type="button" className="btn btn-ghost" onClick={() => void amendOrder()} disabled={acting}>
                Amend
              </button>
            ) : null}
            {canReturn ? (
              <button type="button" className="btn btn-ghost" onClick={() => void returnGoods()} disabled={acting}>
                Return goods
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
            {canPay ? (
              <button
                type="button"
                className={`btn ${showPay ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setShowPay((v) => !v)}
              >
                {showPay ? 'Hide payment' : 'Receive payment'}
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
