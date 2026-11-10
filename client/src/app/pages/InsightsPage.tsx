import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const InsightsPage: React.FC = () => {
  const [data, setData] = useState<any>(null);

  const load = async () => {
    try {
      setData(await api.bi.insights());
    } catch (err: any) {
      await alertError('Insights', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const kpis = [
    ['Sales', data?.sales?.total_amount, `${data?.sales?.count ?? 0} invoices`],
    ['Purchases', data?.purchases?.total_amount, `${data?.purchases?.count ?? 0} bills`],
    ['Expenses', data?.expenses?.total_amount, `${data?.expenses?.count ?? 0} posted`],
    ['Open AR', data?.open_ar?.balance, `${data?.open_ar?.count ?? 0} invoices`],
    ['Open AP', data?.open_ap?.balance, `${data?.open_ap?.count ?? 0} bills`],
    ['Low stock', data?.low_stock_count, 'products at/below reorder'],
    [
      'Deliveries open',
      (data?.deliveries_by_status?.draft || 0) +
        (data?.deliveries_by_status?.scheduled || 0) +
        (data?.deliveries_by_status?.dispatched || 0),
      'draft / scheduled / dispatched'
    ],
    ['Expiry (90d)', data?.upcoming_expiry_lots_90d, 'lots near expiry']
  ] as const;

  const deliveryRows = Object.entries(data?.deliveries_by_status || {});

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Insights
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Business intelligence KPIs across sales, purchases, expenses, stock and logistics.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.85rem'
        }}
      >
        {kpis.map(([label, value, hint]) => (
          <div key={label} className="card-surface" style={{ padding: '1.1rem 1.2rem' }}>
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
              {label}
            </div>
            <div className="display" style={{ fontSize: '1.85rem', marginTop: 4 }}>
              {value == null
                ? '—'
                : typeof value === 'number'
                  ? value.toLocaleString()
                  : String(value)}
            </div>
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem', marginTop: 4 }}>
              {hint}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="card-surface" style={{ padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Deliveries by status</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {deliveryRows.map(([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{Number(count).toLocaleString()}</td>
                </tr>
              ))}
              {!deliveryRows.length ? (
                <tr>
                  <td colSpan={2}>No deliveries yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="card-surface" style={{ padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Last payroll run</h3>
          {data?.payroll_last_run ? (
            <table className="table">
              <tbody>
                <tr>
                  <th>Run #</th>
                  <td>{data.payroll_last_run.run_number}</td>
                </tr>
                <tr>
                  <th>Status</th>
                  <td>{data.payroll_last_run.status}</td>
                </tr>
                <tr>
                  <th>Net</th>
                  <td>{Number(data.payroll_last_run.total_net).toLocaleString()}</td>
                </tr>
                <tr>
                  <th>Period</th>
                  <td>
                    {String(data.payroll_last_run.period_start).slice(0, 10)} →{' '}
                    {String(data.payroll_last_run.period_end).slice(0, 10)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--ink-muted)', margin: 0 }}>No payroll runs yet</p>
          )}
          <p style={{ color: 'var(--ink-muted)', fontSize: 13, marginTop: 12 }}>
            Budgets on file: {data?.budget_count ?? '—'}
          </p>
        </div>
      </div>
    </div>
  );
};
