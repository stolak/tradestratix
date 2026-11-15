import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { ROUTES, setRouteInLocation } from '../routes';
import { InsightsPanel } from './InsightsPage';

type PageTab = 'overview' | 'insights';

type DashboardPageProps = {
  initialTab?: PageTab;
};

const OverviewPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.dashboard
      .summary()
      .then(setData)
      .catch((e) => alertError('Dashboard', e.message));
  }, []);

  const counts = data?.counts || {};

  return (
    <>
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
    </>
  );
};

export const DashboardPage: React.FC<DashboardPageProps> = ({ initialTab = 'overview' }) => {
  const { can } = useAuth();
  const canOverview = can('dashboard.view');
  const canInsights = can('reports.view');
  const availableTabs = useMemo(() => {
    const tabs: PageTab[] = [];
    if (canOverview) tabs.push('overview');
    if (canInsights) tabs.push('insights');
    return tabs;
  }, [canOverview, canInsights]);

  const [tab, setTab] = useState<PageTab>(() =>
    availableTabs.includes(initialTab) ? initialTab : availableTabs[0] || 'overview'
  );

  useEffect(() => {
    const next = availableTabs.includes(initialTab) ? initialTab : availableTabs[0];
    if (next) setTab(next);
  }, [initialTab, availableTabs]);

  const selectTab = (next: PageTab) => {
    setTab(next);
    setRouteInLocation(next === 'insights' ? ROUTES.INSIGHTS : ROUTES.DASHBOARD);
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.4rem' }}>
          Dashboard
        </h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
          {tab === 'insights'
            ? 'Business intelligence KPIs across sales, purchases, expenses, stock and logistics.'
            : 'Live counts from your tenant database — not placeholder metrics.'}
        </p>
      </header>

      {availableTabs.length > 1 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canOverview ? (
            <button
              type="button"
              className={`btn ${tab === 'overview' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => selectTab('overview')}
            >
              Overview
            </button>
          ) : null}
          {canInsights ? (
            <button
              type="button"
              className={`btn ${tab === 'insights' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => selectTab('insights')}
            >
              Insights
            </button>
          ) : null}
        </div>
      ) : null}

      {!availableTabs.length ? (
        <div className="card-surface" style={{ padding: '1rem', color: 'var(--ink-muted)' }}>
          You do not have permission to view the dashboard.
        </div>
      ) : tab === 'insights' ? (
        <InsightsPanel />
      ) : (
        <OverviewPanel />
      )}
    </div>
  );
};
