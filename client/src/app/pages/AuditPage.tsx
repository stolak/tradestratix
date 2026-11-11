import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const AuditPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);

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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{String(r.created_at).replace('T', ' ').slice(0, 19)}</td>
                <td>{r.module}</td>
                <td>{r.action}</td>
                <td>{r.summary || '—'}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
