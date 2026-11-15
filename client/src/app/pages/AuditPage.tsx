import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export const AuditPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.audit
      .list()
      .then(setRows)
      .catch((e) => alertError('Audit', e.message));
  }, []);

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Audit log
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Updates show field-level before → after changes when available.
        </p>
      </header>
      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Module</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changeEntries = Object.entries(
                  (r.changes && typeof r.changes === 'object' ? r.changes : {}) as Record<
                    string,
                    { from?: unknown; to?: unknown }
                  >
                );
                const open = expandedId === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td>{String(r.created_at).replace('T', ' ').slice(0, 19)}</td>
                      <td>{r.module}</td>
                      <td>{r.action}</td>
                      <td>{r.summary || '—'}</td>
                      <td>
                        {changeEntries.length ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setExpandedId(open ? null : r.id)}
                          >
                            {open ? 'Hide' : `${changeEntries.length} field${changeEntries.length === 1 ? '' : 's'}`}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={5} style={{ background: 'rgba(15,92,76,0.04)' }}>
                          <div className="table-wrap">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>From</th>
                                  <th>To</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changeEntries.map(([field, diff]) => (
                                  <tr key={field}>
                                    <td>
                                      <code>{field}</code>
                                    </td>
                                    <td>{formatValue(diff?.from)}</td>
                                    <td>{formatValue(diff?.to)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                    No audit events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
