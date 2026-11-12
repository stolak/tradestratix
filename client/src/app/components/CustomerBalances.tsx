import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { InvoiceViewModal } from './InvoiceViewModal';

type Filter = { branch_id: string; from: string; to: string; q: string };
type SortKey = 'name' | 'balance' | 'purchases';

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

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PRESETS: { id: string; label: string; range: () => [string, string] }[] = [
  {
    id: 'month',
    label: 'This month',
    range: () => {
      const now = new Date();
      return [isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), isoDay(now)];
    }
  },
  {
    id: '30d',
    label: 'Last 30 days',
    range: () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return [isoDay(start), isoDay(now)];
    }
  },
  {
    id: 'year',
    label: 'This year',
    range: () => {
      const now = new Date();
      return [isoDay(new Date(now.getFullYear(), 0, 1)), isoDay(now)];
    }
  },
  { id: 'all', label: 'All time', range: () => ['', ''] }
];

const CustomerInvoices: React.FC<{
  customerId: string;
  filter: Filter;
  onOpen: (invoiceId: string) => void;
}> = ({ customerId, filter, onOpen }) => {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.customers
      .invoices(customerId, { branch_id: filter.branch_id, from: filter.from, to: filter.to })
      .then((d) => !cancelled && setData(d))
      .catch((e: any) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [customerId, filter.branch_id, filter.from, filter.to]);

  if (error) return <div className="cust-bal__empty cust-bal__empty--error">{error}</div>;
  if (!data) return <div className="cust-bal__empty">Loading invoices…</div>;
  if (!data.invoices.length) {
    return <div className="cust-bal__empty">No posted invoices for this branch and date range.</div>;
  }

  return (
    <table className="cust-bal__invoices">
      <thead>
        <tr>
          <th>Invoice #</th>
          <th>Date</th>
          <th>Branch</th>
          <th>Channel</th>
          <th>Rep</th>
          <th className="num">Lines</th>
          <th className="num">Total</th>
          <th className="num">Paid</th>
          <th className="num">Balance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {data.invoices.map((inv: any) => (
          <tr key={inv.id} onClick={() => onOpen(inv.id)} className="cust-bal__invoice-row">
            <td>
              <button
                type="button"
                className="invoice-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(inv.id);
                }}
              >
                {inv.invoice_number}
              </button>
            </td>
            <td>{fmtDate(inv.invoice_date)}</td>
            <td>{inv.branch?.code || inv.branch?.name || '—'}</td>
            <td style={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>{inv.channel}</td>
            <td>{inv.sales_rep_name || '—'}</td>
            <td className="num">{inv.lines}</td>
            <td className="num">{money(inv.total_amount)}</td>
            <td className="num">{money(inv.amount_paid)}</td>
            <td className="num">{money(inv.balance)}</td>
            <td>
              <span className={`invoice-chip invoice-chip--${inv.payment_status}`}>
                {inv.payment_status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={6}>Purchases in range ({data.invoices.length})</td>
          <td className="num">{money(data.purchases_total)}</td>
          <td colSpan={3} />
        </tr>
      </tfoot>
    </table>
  );
};

export const CustomerBalances: React.FC = () => {
  const { branches } = useAuth();
  const [draft, setDraft] = useState<Filter>({ branch_id: '', from: '', to: '', q: '' });
  const [applied, setApplied] = useState<Filter>(draft);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('balance');
  const [onlyOwing, setOnlyOwing] = useState(false);
  const [onlyBuyers, setOnlyBuyers] = useState(false);

  const load = async (f: Filter) => {
    setLoading(true);
    try {
      setData(await api.customers.balances(f));
      setApplied(f);
    } catch (e: any) {
      await alertError('Customer balances', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(draft);
  }, []);

  const rows = useMemo(() => {
    let list: any[] = data?.customers || [];
    if (onlyOwing) list = list.filter((c) => Number(c.balance) > 0.005);
    if (onlyBuyers) list = list.filter((c) => c.purchases_count > 0);
    const sorted = [...list];
    if (sort === 'balance') sorted.sort((a, b) => Number(b.balance) - Number(a.balance));
    else if (sort === 'purchases') sorted.sort((a, b) => Number(b.purchases_total) - Number(a.purchases_total));
    else sorted.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return sorted;
  }, [data, onlyOwing, onlyBuyers, sort]);

  const branchLabel = applied.branch_id
    ? branches.find((b) => b.id === applied.branch_id)?.name || 'Selected branch'
    : 'All my branches';
  const rangeLabel =
    applied.from || applied.to
      ? `${applied.from ? fmtDate(applied.from) : 'start'} – ${applied.to ? fmtDate(applied.to) : 'today'}`
      : 'All time';

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const [from, to] = preset.range();
    const next = { ...draft, from, to };
    setDraft(next);
    void load(next);
  };

  return (
    <div className="page-stack" style={{ gap: '1rem' }}>
      <form
        className="card-surface cust-bal__filters"
        onSubmit={(e) => {
          e.preventDefault();
          setExpandedId(null);
          void load(draft);
        }}
      >
        <div className="field">
          <label>Branch</label>
          <select
            value={draft.branch_id}
            onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}
          >
            <option value="">All my branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code ? `${b.code} — ${b.name}` : b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div className="field">
          <label>To</label>
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Customer</label>
          <input
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Name / code / phone"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
        <div className="cust-bal__presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn-linkish" onClick={() => applyPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </form>

      <div className="cust-bal__cards">
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">
            Total owed by customers
            <span
              className="info-tip"
              title="Sum of journal lines stamped with this customer (AR control lines). Stable if the default AR account mapping changes. All branches · live · date filters do not change it."
            >
              <Info size={13} />
            </span>
          </div>
          <div className="cust-bal__card-value">{money(data?.totals?.balance)}</div>
          <div className="cust-bal__card-sub">Live · all branches · as of now</div>
        </div>
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">Purchases</div>
          <div className="cust-bal__card-value">{money(data?.totals?.purchases_total)}</div>
          <div className="cust-bal__card-sub">
            {branchLabel} · {rangeLabel}
          </div>
        </div>
        <div className="card-surface cust-bal__card">
          <div className="cust-bal__card-label">Posted invoices</div>
          <div className="cust-bal__card-value">{data?.totals?.purchases_count ?? 0}</div>
          <div className="cust-bal__card-sub">
            {branchLabel} · {rangeLabel}
          </div>
        </div>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="cust-bal__toolbar">
          <label className="cust-bal__toggle">
            <input type="checkbox" checked={onlyOwing} onChange={(e) => setOnlyOwing(e.target.checked)} />
            Owing only
          </label>
          <label className="cust-bal__toggle">
            <input type="checkbox" checked={onlyBuyers} onChange={(e) => setOnlyBuyers(e.target.checked)} />
            With purchases in range
          </label>
          <label className="cust-bal__toggle">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="balance">Highest balance</option>
              <option value="purchases">Highest purchases</option>
              <option value="name">Name</option>
            </select>
          </label>
          <span className="cust-bal__count">{rows.length} customers</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Customer</th>
                <th>Type</th>
                <th className="num">Current balance</th>
                <th className="num">Credit available</th>
                <th className="num">Purchases</th>
                <th className="num">Invoices</th>
                <th>Last purchase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const open = expandedId === c.id;
                const balance = Number(c.balance);
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      className={`cust-bal__row${open ? ' is-open' : ''}${c.status !== 'active' ? ' customers__row--inactive' : ''}`}
                      onClick={() => setExpandedId(open ? null : c.id)}
                    >
                      <td className="cust-bal__chev">
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div className="invoice-view__sub">{c.code || '—'}</div>
                      </td>
                      <td>{c.customer_type}</td>
                      <td
                        className={`num cust-bal__balance${balance > 0.005 ? ' is-owing' : balance < -0.005 ? ' is-credit' : ''}`}
                      >
                        {money(balance)}
                        {balance < -0.005 ? <div className="invoice-view__sub">in credit</div> : null}
                      </td>
                      <td className="num">
                        {c.credit_limit == null ? (
                          <span className="invoice-view__sub">Unlimited</span>
                        ) : (
                          <span className={Number(c.available_credit) < 0 ? 'customer-terms__over' : undefined}>
                            {money(c.available_credit)}
                          </span>
                        )}
                      </td>
                      <td className="num">{money(c.purchases_total)}</td>
                      <td className="num">{c.purchases_count}</td>
                      <td>{fmtDate(c.last_purchase_at)}</td>
                    </tr>
                    {open ? (
                      <tr className="cust-bal__detail">
                        <td colSpan={8}>
                          <CustomerInvoices
                            customerId={c.id}
                            filter={applied}
                            onOpen={setViewInvoiceId}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--ink-muted)' }}>
                    {loading ? 'Loading…' : 'No customers match.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {viewInvoiceId ? (
        <InvoiceViewModal invoiceId={viewInvoiceId} onClose={() => setViewInvoiceId(null)} />
      ) : null}
    </div>
  );
};
