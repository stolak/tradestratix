import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.dashboard
      .summary()
      .then(setData)
      .catch((e) => alertError('Dashboard', e.message));
  }, []);

  const counts = data?.counts || {};

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.4rem' }}>
          Operations overview
        </h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
          Live counts from your tenant database — not placeholder metrics.
        </p>
      </header>

      <div className="kpi-grid">
        {[
          ['Branches', counts.branches],
          ['Warehouses', counts.warehouses],
          ['Users', counts.users],
          ['Products', counts.products],
          ['GL Accounts', counts.accounts]
        ].map(([label, value]) => (
          <div key={String(label)} className="card-surface" style={{ padding: '1.1rem 1.2rem' }}>
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
              {label}
            </div>
            <div className="display" style={{ fontSize: '2rem', marginTop: 4 }}>
              {value ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <div className="split-2">
        <div className="card-surface" style={{ padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Recent journals</h3>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Status</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_journals || []).map((j: any) => (
                <tr key={j.id}>
                  <td>{j.entry_number}</td>
                  <td>{j.status}</td>
                  <td>{j.memo || '—'}</td>
                </tr>
              ))}
              {!data?.recent_journals?.length ? (
                <tr>
                  <td colSpan={3}>No journals yet</td>
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>
        </div>
        <div className="card-surface" style={{ padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Recent audit</h3>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Action</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_audit || []).map((a: any) => (
                <tr key={a.id}>
                  <td>{a.module}</td>
                  <td>{a.action}</td>
                  <td>{a.summary || '—'}</td>
                </tr>
              ))}
              {!data?.recent_audit?.length ? (
                <tr>
                  <td colSpan={3}>No audit events</td>
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
