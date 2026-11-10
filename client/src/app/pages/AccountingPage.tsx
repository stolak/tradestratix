import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const AccountingPage: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [trial, setTrial] = useState<any>(null);
  const [tab, setTab] = useState<'coa' | 'journals' | 'trial'>('coa');

  useEffect(() => {
    Promise.all([
      api.accounting.accounts(),
      api.accounting.journals(),
      api.accounting.trialBalance()
    ])
      .then(([a, j, t]) => {
        setAccounts(a);
        setJournals(j);
        setTrial(t);
      })
      .catch((e) => alertError('Accounting', e.message));
  }, []);

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Accounting
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Double-entry chart of accounts and posting engine foundation.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        {(
          [
            ['coa', 'Chart of accounts'],
            ['journals', 'Journals'],
            ['trial', 'Trial balance']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'coa' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td>
                  <td>{a.name}</td>
                  <td>{a.account_type}</td>
                  <td>{a.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'journals' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Status</th>
                <th>Source</th>
                <th>Lines</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.id}>
                  <td>{j.entry_number}</td>
                  <td>{String(j.entry_date).slice(0, 10)}</td>
                  <td>{j.status}</td>
                  <td>
                    {j.source_type || '—'}
                    {j.source_id ? ` / ${j.source_id}` : ''}
                  </td>
                  <td>{j.lines?.length ?? 0}</td>
                </tr>
              ))}
              {!journals.length ? (
                <tr>
                  <td colSpan={5}>No journals posted yet</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'trial' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {(trial?.rows || []).map((r: any) => (
                <tr key={r.account_id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.balance_debit}</td>
                  <td>{r.balance_credit}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}>
                  <strong>Totals {trial?.balanced ? '(balanced)' : '(unbalanced)'}</strong>
                </td>
                <td>
                  <strong>{trial?.total_debit ?? 0}</strong>
                </td>
                <td>
                  <strong>{trial?.total_credit ?? 0}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};
