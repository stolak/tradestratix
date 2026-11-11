import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'coa' | 'defaults' | 'journals' | 'trial' | 'pl' | 'bs' | 'periods';

export const AccountingPage: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [defaultStatus, setDefaultStatus] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [trial, setTrial] = useState<any>(null);
  const [pl, setPl] = useState<any>(null);
  const [bs, setBs] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('coa');

  const load = async () => {
    try {
      const [a, j, t, p, b, per, defaults] = await Promise.all([
        api.accounting.accounts(),
        api.accounting.journals(),
        api.accounting.trialBalance(),
        api.accounting.profitLoss(),
        api.accounting.balanceSheet(),
        api.accounting.periods(),
        api.accounting.defaultAccountStatus()
      ]);
      setAccounts(a);
      setJournals(j);
      setTrial(t);
      setPl(p);
      setBs(b);
      setPeriods(per);
      setDefaultStatus(defaults);
    } catch (e: any) {
      await alertError('Accounting', e.message);
    }
  };

  const saveDefault = async (key: string, accountId: string) => {
    try {
      await api.accounting.upsertDefaultAccount({ setting_key: key, account_id: accountId });
      await alertSuccess('Default account saved');
      await load();
    } catch (e: any) {
      await alertError('Save failed', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleLock = async (id: string, locked: boolean) => {
    try {
      await api.accounting.lockPeriod(id, locked);
      await alertSuccess(locked ? 'Period locked' : 'Period unlocked');
      await load();
    } catch (e: any) {
      await alertError('Period update failed', e.message);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'coa', label: 'Chart of accounts' },
    { id: 'defaults', label: 'Default accounts' },
    { id: 'journals', label: 'Journals' },
    { id: 'trial', label: 'Trial balance' },
    { id: 'pl', label: 'Profit & loss' },
    { id: 'bs', label: 'Balance sheet' },
    { id: 'periods', label: 'Periods' }
  ];

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Accounting
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Full GL — journals, trial balance, P&amp;L, balance sheet and period locks.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'coa' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
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
        </div>
      ) : null}

      {tab === 'defaults' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>S/N</th>
                  <th>Key</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Mapped account</th>
                  <th>Assign</th>
                </tr>
              </thead>
              <tbody>
                {defaultStatus.map((row, index) => (
                  <tr key={row.key}>
                    <td>{index + 1}</td>
                    <td>
                      <div>{row.label || row.key}</div>
                      <div style={{ color: 'var(--ink-muted)', fontSize: '0.78rem' }}>{row.key}</div>
                    </td>
                    <td>{row.category}</td>
                    <td>{row.status}</td>
                    <td>
                      {row.account
                        ? `${row.account.code} — ${row.account.name}`
                        : '—'}
                    </td>
                    <td>
                      <select
                        defaultValue={row.account?.id || ''}
                        onChange={(e) => {
                          if (e.target.value) void saveDefault(row.key, e.target.value);
                        }}
                        style={{ maxWidth: 220 }}
                      >
                        <option value="">Select account…</option>
                        {accounts
                          .filter((a) => a.is_active !== false)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'journals' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Supplier</th>
                <th>Sales rep</th>
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
                  <td>{j.customer?.name || '—'}</td>
                  <td>{j.supplier?.name || '—'}</td>
                  <td>{j.sales_representative?.name || '—'}</td>
                  <td>
                    {j.source_type || '—'}
                    {j.source_id ? ` / ${j.source_id}` : ''}
                  </td>
                  <td>{j.lines?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {tab === 'trial' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
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
        </div>
      ) : null}

      {tab === 'pl' && pl ? (
        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16 }}>
          {(
            [
              ['Revenue', pl.revenue, pl.totals.revenue],
              ['COGS', pl.cogs, pl.totals.cogs],
              ['Expenses', pl.expenses, pl.totals.expenses]
            ] as const
          ).map(([title, rows, total]) => (
            <div key={title}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
              <div className="table-wrap">
                <table className="table">
                <tbody>
                  {(rows || []).map((r: any) => (
                    <tr key={r.code}>
                      <td>
                        {r.code} — {r.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>{Number(r.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total {title}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{Number(total).toLocaleString()}</strong>
                    </td>
                  </tr>
                </tbody>
                </table>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
            <strong>Gross profit</strong>
            <strong>{Number(pl.totals.gross_profit).toLocaleString()}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem' }}>
            <strong>Net profit</strong>
            <strong>{Number(pl.totals.net_profit).toLocaleString()}</strong>
          </div>
        </div>
      ) : null}

      {tab === 'bs' && bs ? (
        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16 }}>
          {(
            [
              ['Assets', bs.assets, bs.totals.assets],
              ['Liabilities', bs.liabilities, bs.totals.liabilities],
              ['Equity', bs.equity, bs.totals.equity]
            ] as const
          ).map(([title, rows, total]) => (
            <div key={title}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
              <div className="table-wrap">
                <table className="table">
                <tbody>
                  {(rows || []).map((r: any) => (
                    <tr key={r.code}>
                      <td>
                        {r.code} — {r.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>{Number(r.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total {title}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{Number(total).toLocaleString()}</strong>
                    </td>
                  </tr>
                </tbody>
                </table>
              </div>
            </div>
          ))}
          <div style={{ color: 'var(--ink-muted)' }}>
            Liabilities + equity: {Number(bs.totals.liabilities_and_equity).toLocaleString()}{' '}
            {bs.totals.balanced ? '(balanced)' : '(check net income fold)'}
          </div>
        </div>
      ) : null}

      {tab === 'periods' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Year</th>
                <th>Start</th>
                <th>End</th>
                <th>Locked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.financial_year?.name || '—'}</td>
                  <td>{String(p.starts_on).slice(0, 10)}</td>
                  <td>{String(p.ends_on).slice(0, 10)}</td>
                  <td>{p.is_locked ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void toggleLock(p.id, !p.is_locked)}
                    >
                      {p.is_locked ? 'Unlock' : 'Lock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
