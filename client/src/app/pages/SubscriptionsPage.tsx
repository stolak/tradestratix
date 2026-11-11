import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const SubscriptionsPage: React.FC = () => {
  const [current, setCurrent] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);

  const load = async () => {
    try {
      const [c, p] = await Promise.all([
        api.subscriptions.current(),
        api.subscriptions.plans()
      ]);
      setCurrent(c);
      setPlans(p);
    } catch (err: any) {
      await alertError('Subscriptions', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Subscriptions
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Current plan for this business and available SaaS tiers.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="card-surface" style={{ padding: '1.25rem' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Current plan</div>
        {current ? (
          <div className="kpi-grid">
            <div>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Plan</div>
              <div className="display" style={{ fontSize: '1.5rem' }}>
                {current.plan?.name || '—'}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Status</div>
              <div style={{ fontWeight: 600 }}>{current.status}</div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Starts</div>
              <div>{current.starts_at ? String(current.starts_at).slice(0, 10) : '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Ends / trial</div>
              <div>
                {current.ends_at
                  ? String(current.ends_at).slice(0, 10)
                  : current.trial_ends_at
                    ? `Trial → ${String(current.trial_ends_at).slice(0, 10)}`
                    : '—'}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--ink-muted)', margin: 0 }}>No active subscription on file.</p>
        )}
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Code</th>
              <th>Monthly</th>
              <th>Yearly</th>
              <th>Users</th>
              <th>Branches</th>
              <th>Warehouses</th>
              <th>Modules</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr
                key={p.id}
                style={{
                  background:
                    current?.plan_id === p.id || current?.plan?.id === p.id
                      ? 'rgba(15, 92, 76, 0.08)'
                      : undefined
                }}
              >
                <td>{p.name}</td>
                <td>{p.code}</td>
                <td>{Number(p.monthly_price).toLocaleString()}</td>
                <td>{Number(p.yearly_price).toLocaleString()}</td>
                <td>{p.max_users}</td>
                <td>{p.max_branches}</td>
                <td>{p.max_warehouses}</td>
                <td>
                  {Array.isArray(p.modules)
                    ? p.modules.join(', ')
                    : p.modules_json || '—'}
                </td>
              </tr>
            ))}
            {!plans.length ? (
              <tr>
                <td colSpan={8}>No plans available</td>
              </tr>
            ) : null}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
