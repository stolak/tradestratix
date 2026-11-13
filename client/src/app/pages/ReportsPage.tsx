import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

type Tab = 'ar' | 'ap' | 'clearing' | 'fulfilment' | 'sales';

const money = (v: unknown) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ReportsPage: React.FC = () => {
  const { can } = useAuth();
  const tabs = useMemo(
    () =>
      [
        can('reports.view', 'sales.view') ? { id: 'ar' as const, label: 'AR aging' } : null,
        can('reports.view', 'purchases.view') ? { id: 'ap' as const, label: 'AP aging' } : null,
        can('reports.view', 'accounting.view')
          ? { id: 'clearing' as const, label: 'Inter-branch clearing' }
          : null,
        can('reports.view', 'sales.view', 'sales.fulfil')
          ? { id: 'fulfilment' as const, label: 'Fulfilment' }
          : null,
        can('reports.view', 'sales.view') ? { id: 'sales' as const, label: 'Sales by branch' } : null
      ].filter(Boolean) as { id: Tab; label: string }[],
    [can]
  );
  const [tab, setTab] = useState<Tab>('ar');
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;

  const [ar, setAr] = useState<any>(null);
  const [ap, setAp] = useState<any>(null);
  const [clearing, setClearing] = useState<any>(null);
  const [fulfilment, setFulfilment] = useState<any>(null);
  const [sales, setSales] = useState<any>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loadAging = async () => {
    try {
      const [a, p] = await Promise.all([
        can('reports.view', 'sales.view') ? api.reports.arAging() : Promise.resolve(null),
        can('reports.view', 'purchases.view') ? api.reports.apAging() : Promise.resolve(null)
      ]);
      setAr(a);
      setAp(p);
    } catch (e: any) {
      await alertError('Reports', e.message);
    }
  };

  const loadPeriod = async () => {
    try {
      const filter = { from: from || undefined, to: to || undefined, consolidated: true };
      const [c, f, s] = await Promise.all([
        can('reports.view', 'accounting.view')
          ? api.reports.interBranchClearing(filter)
          : Promise.resolve(null),
        can('reports.view', 'sales.view', 'sales.fulfil')
          ? api.reports.fulfilmentSummary(filter)
          : Promise.resolve(null),
        can('reports.view', 'sales.view') ? api.reports.salesByBranch(filter) : Promise.resolve(null)
      ]);
      setClearing(c);
      setFulfilment(f);
      setSales(s);
    } catch (e: any) {
      await alertError('Reports', e.message);
    }
  };

  useEffect(() => {
    void loadAging();
    void loadPeriod();
  }, []);

  const data = activeTab === 'ar' ? ar : ap;
  const parties = activeTab === 'ar' ? ar?.customers || [] : ap?.suppliers || [];

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Reports
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Aging, fulfilment pipeline, sales by revenue branch, and inter-branch clearing
          reconciliation.
        </p>
      </header>

      {tabs.length > 1 ? (
        <div className="page-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`page-tabs__tab${activeTab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === 'ar' || activeTab === 'ap' ? (
        <>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => void loadAging()}>
              Refresh
            </button>
          </div>

          {data?.totals ? (
            <div className="card-surface kpi-grid" style={{ padding: '1rem 1.25rem' }}>
              {(
                [
                  ['current', 'Current'],
                  ['1_30', '1–30'],
                  ['31_60', '31–60'],
                  ['61_90', '61–90'],
                  ['90_plus', '90+'],
                  ['total', 'Total']
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{label}</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>
                    {Number(data.totals[key] || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{activeTab === 'ar' ? 'Customer' : 'Supplier'}</th>
                    <th>Current</th>
                    <th>1–30</th>
                    <th>31–60</th>
                    <th>61–90</th>
                    <th>90+</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parties.map((p: any) => (
                    <tr key={p.customer_id || p.supplier_id}>
                      <td>{p.customer_name || p.supplier_name}</td>
                      <td>{Number(p.buckets.current).toLocaleString()}</td>
                      <td>{Number(p.buckets['1_30']).toLocaleString()}</td>
                      <td>{Number(p.buckets['31_60']).toLocaleString()}</td>
                      <td>{Number(p.buckets['61_90']).toLocaleString()}</td>
                      <td>{Number(p.buckets['90_plus']).toLocaleString()}</td>
                      <td>{Number(p.buckets.total).toLocaleString()}</td>
                    </tr>
                  ))}
                  {!parties.length ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                        No open balances
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === 'clearing' || activeTab === 'fulfilment' || activeTab === 'sales' ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void loadPeriod()}>
            Refresh
          </button>
        </div>
      ) : null}

      {activeTab === 'clearing' && clearing ? (
        <>
          <div className="card-surface kpi-grid" style={{ padding: '1rem 1.25rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Company net</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{money(clearing.company_net)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Balanced</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{clearing.balanced ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Open pairs</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{clearing.open_count}</div>
            </div>
          </div>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(clearing.by_branch || []).map((b: any) => (
                    <tr key={b.branch_id}>
                      <td>
                        {b.branch_name} ({b.branch_code})
                      </td>
                      <td className="num">{money(b.debit)}</td>
                      <td className="num">{money(b.credit)}</td>
                      <td className="num">{money(b.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {(clearing.open_pairs || []).length ? (
            <div className="card-surface" style={{ padding: '0.5rem 0' }}>
              <div style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Open / unmatched pairs</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Customer</th>
                      <th className="num">Net</th>
                      <th>Branches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clearing.open_pairs.map((p: any, i: number) => (
                      <tr key={`${p.source_type}-${p.source_id}-${i}`}>
                        <td>
                          {p.source_type || '—'} · {(p.source_id || '').slice(0, 12)}
                        </td>
                        <td>{p.customer?.name || '—'}</td>
                        <td className="num">{money(p.net)}</td>
                        <td>
                          {(p.branches || [])
                            .map((b: any) => `${b.branch_code}: ${money(b.net)}`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === 'fulfilment' && fulfilment ? (
        <>
          <div className="card-surface kpi-grid" style={{ padding: '1rem 1.25rem' }}>
            {Object.entries(fulfilment.status_counts || {}).map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                  {k.replace(/_/g, ' ')}
                </div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{Number(v)}</div>
              </div>
            ))}
          </div>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th className="num">Open qty</th>
                    <th className="num">Recognised</th>
                    <th>Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {(fulfilment.orders || []).map((o: any) => (
                    <tr key={o.id}>
                      <td>{o.invoice_number}</td>
                      <td>{o.customer?.name}</td>
                      <td>{o.fulfilment_mode}</td>
                      <td>{o.fulfilment_status}</td>
                      <td className="num">{Number(o.open_qty).toLocaleString()}</td>
                      <td className="num">{money(o.recognised_amount)}</td>
                      <td>
                        {(o.tasks || [])
                          .map((t: any) => `${t.fulfilment_number} (${t.status})`)
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                  {!(fulfilment.orders || []).length ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                        No pickup / delivery orders in range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === 'sales' && sales ? (
        <>
          <div className="card-surface kpi-grid" style={{ padding: '1rem 1.25rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Net recognised</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{money(sales.totals?.net_recognised)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>COGS</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{money(sales.totals?.cogs)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Returns</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{money(sales.totals?.returns)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>Gross margin</div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{money(sales.totals?.gross_margin)}</div>
            </div>
          </div>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Revenue branch</th>
                    <th className="num">Handovers</th>
                    <th className="num">Recognised</th>
                    <th className="num">Returns</th>
                    <th className="num">COGS</th>
                    <th className="num">Gross margin</th>
                  </tr>
                </thead>
                <tbody>
                  {(sales.branches || []).map((b: any) => (
                    <tr key={b.branch_id}>
                      <td>
                        {b.branch_name} ({b.branch_code})
                      </td>
                      <td className="num">{b.handovers}</td>
                      <td className="num">{money(b.recognised)}</td>
                      <td className="num">{money(b.returns)}</td>
                      <td className="num">{money(b.cogs)}</td>
                      <td className="num">{money(b.gross_margin)}</td>
                    </tr>
                  ))}
                  {!(sales.branches || []).length ? (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                        No hand-overs in range
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
