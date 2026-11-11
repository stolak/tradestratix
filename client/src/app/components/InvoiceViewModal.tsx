import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { api } from '../utils/api';

type Props = {
  invoiceId: string;
  onClose: () => void;
  /** Resolve `false` to keep the modal open (e.g. post failed). */
  onPost?: (id: string) => Promise<boolean | void> | boolean | void;
  canPost?: boolean;
};

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDate(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export const InvoiceViewModal: React.FC<Props> = ({ invoiceId, onClose, onPost, canPost }) => {
  const [invoice, setInvoice] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

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
                <span className={`invoice-chip invoice-chip--${invoice.status}`}>{invoice.status}</span>
                <span className={`invoice-chip invoice-chip--${invoice.payment_status}`}>
                  {invoice.payment_status}
                </span>
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
                  <dt>Branch</dt>
                  <dd>{invoice.branch?.name || '—'}</dd>
                  <dt>Warehouse</dt>
                  <dd>{invoice.warehouse?.name || '—'}</dd>
                  <dt>Sales rep</dt>
                  <dd>{invoice.sales_rep?.name || '—'}</dd>
                  {invoice.posted_at ? (
                    <>
                      <dt>Posted</dt>
                      <dd>{fmtDate(invoice.posted_at)}</dd>
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
                        </td>
                        <td>{it.uom?.code || it.uom?.name || '—'}</td>
                        <td className="num">{Number(it.quantity).toLocaleString()}</td>
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
                </div>

                <dl className="invoice-view__totals">
                  {discountTotal > 0 ? (
                    <>
                      <dt>Branch discount</dt>
                      <dd>−{money(discountTotal)}</dd>
                    </>
                  ) : null}
                  <dt>Subtotal</dt>
                  <dd>{money(invoice.subtotal)}</dd>
                  {Number(invoice.tax_amount) ? (
                    <>
                      <dt>Tax</dt>
                      <dd>{money(invoice.tax_amount)}</dd>
                    </>
                  ) : null}
                  <dt className="invoice-view__grand">Total</dt>
                  <dd className="invoice-view__grand">{money(invoice.total_amount)}</dd>
                  <dt>Paid</dt>
                  <dd>{money(invoice.amount_paid)}</dd>
                  <dt className="invoice-view__balance">Balance due</dt>
                  <dd className="invoice-view__balance">{money(invoice.balance)}</dd>
                </dl>
              </div>
            </>
          ) : null}
        </div>

        {invoice?.status === 'draft' && canPost && onPost ? (
          <div className="modal__footer no-print">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handlePost()}
              disabled={posting}
            >
              {posting ? 'Posting…' : 'Post invoice'}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};
