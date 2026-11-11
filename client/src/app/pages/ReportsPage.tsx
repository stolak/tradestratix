import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { StockBalanceReport } from '../components/StockBalanceReport';

type Tab = 'ar' | 'ap' | 'stock';

export const ReportsPage: React.FC = () => {
  const { can } = useAuth();
  const tabs = useMemo(
    () =>
      [
        can('reports.view', 'sales.view') ? { id: 'ar' as const, label: 'AR aging' } : null,
        can('reports.view', 'purchases.view') ? { id: 'ap' as const, label: 'AP aging' } : null,
        can('reports.view', 'inventory.view') ? { id: 'stock' as const, label: 'Stock balance' } : null
      ].filter(Boolean) as { id: Tab; label: string }[],
    [can]
  );
  const [tab, setTab] = useState<Tab>('ar');
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;

  const [ar, setAr] = useState<any>(null);
  const [ap, setAp] = useState<any>(null);

  const load = async () => {
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

  useEffect(() => {
    void load();
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
          AR / AP aging from open invoices and supplier bills, and live stock balances by branch and
          warehouse.
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

      {activeTab === 'stock' ? <StockBalanceReport /> : null}

      {activeTab === 'ar' || activeTab === 'ap' ? (
        <>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => void load()}>
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
    </div>
  );
};
