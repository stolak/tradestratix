import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { DefaultAccountsPanel } from '../components/DefaultAccountsPanel';

type Tab = 'coa' | 'defaults' | 'journals' | 'trial' | 'pl' | 'bs' | 'cf' | 'periods';

function yearStartIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function money(n: number | undefined | null) {
  return Number(n ?? 0).toLocaleString();
}

export const AccountingPage: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [trial, setTrial] = useState<any>(null);
  const [pl, setPl] = useState<any>(null);
  const [bs, setBs] = useState<any>(null);
  const [cf, setCf] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('defaults');
  const [cfFrom, setCfFrom] = useState(yearStartIsoDate);
  const [cfTo, setCfTo] = useState(todayIsoDate);

  const load = async (from = cfFrom, to = cfTo) => {
    try {
      const [a, j, t, p, b, c, per] = await Promise.all([
        api.accounting.accounts(),
        api.accounting.journals(),
        api.accounting.trialBalance(),
        api.accounting.profitLoss(),
        api.accounting.balanceSheet(),
        api.accounting.cashFlow(from || undefined, to || undefined),
        api.accounting.periods()
      ]);
      setAccounts(a);
      setJournals(j);
      setTrial(t);
      setPl(p);
      setBs(b);
      setCf(c);
      setPeriods(per);
    } catch (e: any) {
      await alertError('Accounting', e.message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    { id: 'cf', label: 'Cash flow' },
    { id: 'periods', label: 'Periods' }
  ];

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Accounting
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Chart of accounts, default posting maps, journals, trial balance, P&amp;L, balance sheet, cash
          flow and period locks.
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

      {tab === 'defaults' ? <DefaultAccountsPanel /> : null}

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
                  <td>
                    {j.sales_representative?.name ||
                      j.sales_representative?.employee?.full_name ||
                      '—'}
                  </td>
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

      {tab === 'cf' && cf ? (
        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>From</span>
              <input
                type="date"
                value={cfFrom}
                onChange={(e) => setCfFrom(e.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>To</span>
              <input type="date" value={cfTo} onChange={(e) => setCfTo(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void load(cfFrom, cfTo)}
            >
              Apply
            </button>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Cash pool</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th style={{ textAlign: 'right' }}>Opening</th>
                    <th style={{ textAlign: 'right' }}>Closing</th>
                    <th style={{ textAlign: 'right' }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(cf.cash_accounts || []).map((r: any) => (
                    <tr key={r.account_id}>
                      <td>
                        {r.code} — {r.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(r.opening)}</td>
                      <td style={{ textAlign: 'right' }}>{money(r.closing)}</td>
                      <td style={{ textAlign: 'right' }}>{money(r.net)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total cash</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{money(cf.totals?.opening_cash)}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{money(cf.totals?.closing_cash)}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{money(cf.totals?.net_change)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {(
            [
              ['Operating', cf.operating],
              ['Investing', cf.investing],
              ['Financing', cf.financing]
            ] as const
          ).map(([title, section]) => (
            <div key={title}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {(section?.inflows || []).map((r: any) => (
                      <tr key={`in-${r.key}`}>
                        <td>{r.label}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.amount)}</td>
                      </tr>
                    ))}
                    {(section?.outflows || []).map((r: any) => (
                      <tr key={`out-${r.key}`}>
                        <td>{r.label}</td>
                        <td style={{ textAlign: 'right' }}>({money(r.amount)})</td>
                      </tr>
                    ))}
                    {!section?.inflows?.length && !section?.outflows?.length ? (
                      <tr>
                        <td colSpan={2} style={{ color: 'var(--ink-muted)' }}>
                          No movements
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td>
                        <strong>Net {title.toLowerCase()}</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{money(section?.net)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {(cf.internal_transfers?.lines || []).length ? (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Internal transfers</div>
              <p style={{ color: 'var(--ink-muted)', margin: '0 0 6px', fontSize: 13 }}>
                Moves within the cash pool (till ↔ bank, bank transfers). Net effect on total cash is
                zero.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {cf.internal_transfers.lines.map((r: any) => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
            <strong>Net change in cash</strong>
            <strong>{money(cf.totals?.net_change)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem' }}>
            <strong>Closing cash</strong>
            <strong>{money(cf.totals?.closing_cash)}</strong>
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
            {cf.totals?.closing_reconciles
              ? 'Opening + net change reconciles to closing cash.'
              : 'Opening + net change does not match closing — check unclassified journals.'}
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
