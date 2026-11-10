import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

type Tab = 'ar' | 'ap';

export const ReportsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('ar');
  const [ar, setAr] = useState<any>(null);
  const [ap, setAp] = useState<any>(null);

  const load = async () => {
    try {
      const [a, p] = await Promise.all([api.reports.arAging(), api.reports.apAging()]);
      setAr(a);
      setAp(p);
    } catch (e: any) {
      await alertError('Reports', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const data = tab === 'ar' ? ar : ap;
  const parties = tab === 'ar' ? ar?.customers || [] : ap?.suppliers || [];

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Statements
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          AR / AP aging from open invoices and supplier bills.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className={tab === 'ar' ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => setTab('ar')}
        >
          AR aging
        </button>
        <button
          type="button"
          className={tab === 'ap' ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => setTab('ap')}
        >
          AP aging
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {data?.totals ? (
        <div
          className="card-surface"
          style={{
            padding: '1rem 1.25rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: 12
          }}
        >
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
        <table className="table">
          <thead>
            <tr>
              <th>{tab === 'ar' ? 'Customer' : 'Supplier'}</th>
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
  );
};
