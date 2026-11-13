import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { alertError, alertSuccess, confirmAction } from '../../utils/alerts';
import { SearchSelect } from '../SearchSelect';
import { JournalViewModal } from './JournalViewModal';
import { flattenAccountTree, money, todayIsoDate, yearStartIsoDate } from './shared';

export function LedgerStatementTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerStart, setLedgerStart] = useState(yearStartIsoDate);
  const [ledgerEnd, setLedgerEnd] = useState(todayIsoDate);
  const [ledgerStatement, setLedgerStatement] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [viewingJournal, setViewingJournal] = useState<any | null>(null);

  const accountTreeRows = useMemo(() => flattenAccountTree(accounts), [accounts]);
  const ledgerAccountOptions = useMemo(
    () =>
      accountTreeRows.map((a) => ({
        value: a.id,
        label: `${'— '.repeat(a.depth)}${a.code} — ${a.name}${a.is_active ? '' : ' (disabled)'}`
      })),
    [accountTreeRows]
  );

  const loadLedgerStatement = async () => {
    if (!ledgerAccountId) {
      await alertError('Ledger statement', 'Select a ledger account');
      return;
    }
    try {
      setLedgerLoading(true);
      setLedgerStatement(
        await api.accounting.ledgerStatement({
          account_id: ledgerAccountId,
          start: ledgerStart || undefined,
          end: ledgerEnd || undefined
        })
      );
    } catch (e: any) {
      await alertError('Ledger statement', e.message);
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const a = await api.accounting.accounts();
        setAccounts(a);
        const active = a.filter((x: any) => x.is_active);
        if (active.length) {
          setLedgerAccountId((prev) => prev || active[0].id);
        }
      } catch (e: any) {
        await alertError('Ledger statement', e.message);
      }
    })();
  }, []);

  const handlePost = async (id: string) => {
    try {
      await api.accounting.postJournal(id);
      await alertSuccess('Journal posted');
      await loadLedgerStatement();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const handleReverse = async (id: string) => {
    const ok = await confirmAction(
      'Reverse journal?',
      'This creates a reversing posted entry and marks the original as reversed.'
    );
    if (!ok) return;
    try {
      await api.accounting.reverseJournal(id);
      await alertSuccess('Journal reversed');
      await loadLedgerStatement();
    } catch (err: any) {
      await alertError('Reverse failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <form
        className="card-surface cust-bal__filters"
        onSubmit={(e) => {
          e.preventDefault();
          void loadLedgerStatement();
        }}
      >
        <div className="field" style={{ minWidth: 240, flex: 1 }}>
          <label>Ledger</label>
          <SearchSelect
            value={ledgerAccountId}
            options={ledgerAccountOptions}
            required
            placeholder="Search account…"
            onChange={setLedgerAccountId}
          />
        </div>
        <div className="field">
          <label>From</label>
          <input
            type="date"
            value={ledgerStart}
            onChange={(e) => setLedgerStart(e.target.value)}
          />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={ledgerEnd} onChange={(e) => setLedgerEnd(e.target.value)} />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={ledgerLoading || !ledgerAccountId}
        >
          {ledgerLoading ? 'Loading…' : 'Run statement'}
        </button>
      </form>

      {ledgerLoading && !ledgerStatement ? (
        <div
          className="card-surface"
          style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}
        >
          Loading statement…
        </div>
      ) : !ledgerStatement ? (
        <div
          className="card-surface"
          style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}
        >
          Select a ledger and date range, then run the statement.
        </div>
      ) : (
        <>
          <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16 }}>
            <div>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Account</div>
              <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                {ledgerStatement.account.code} — {ledgerStatement.account.name}
              </div>
              <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                {ledgerStatement.account.account_type}
                {!ledgerStatement.account.is_active ? ' · disabled' : ''}
                {ledgerStart || ledgerEnd
                  ? ` · ${ledgerStart || '…'} → ${ledgerEnd || '…'}`
                  : ''}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12
              }}
            >
              {(
                [
                  ['Opening balance', ledgerStatement.opening_balance],
                  ['Period debit', ledgerStatement.period_debit],
                  ['Period credit', ledgerStatement.period_credit],
                  ['Closing balance', ledgerStatement.closing_balance]
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '0.75rem 0.85rem'
                  }}
                >
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>{label}</div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontFamily: 'ui-monospace, monospace',
                      marginTop: 4
                    }}
                  >
                    {money(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ padding: '0.5rem 1rem', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              {(ledgerStatement.rows || []).length} movement(s) in period · balance is debit −
              credit
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entry #</th>
                    <th>Description</th>
                    <th>Contra</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--ink-muted)' }}>
                      Opening balance
                      {ledgerStart ? ` (before ${ledgerStart})` : ''}
                    </td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">
                      <strong>{money(ledgerStatement.opening_balance)}</strong>
                    </td>
                  </tr>
                  {(ledgerStatement.rows || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>
                        No posted transactions in this range.
                      </td>
                    </tr>
                  ) : (
                    ledgerStatement.rows.map((r: any) => (
                      <tr key={r.line_id}>
                        <td>{String(r.entry_date).slice(0, 10)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              padding: '0.1rem 0.35rem',
                              fontFamily: 'ui-monospace, monospace',
                              fontWeight: 700
                            }}
                            onClick={async () => {
                              try {
                                const found = await api.accounting.journals({
                                  entry_number: r.entry_number
                                });
                                const je =
                                  found.find((j: any) => j.id === r.entry_id) || found[0];
                                if (je) setViewingJournal(je);
                                else await alertError('Journal', 'Journal not found');
                              } catch (err: any) {
                                await alertError('Journal', err.message);
                              }
                            }}
                          >
                            {r.entry_number}
                          </button>
                        </td>
                        <td>
                          <div>{r.description || r.memo || '—'}</div>
                          {r.source_type ? (
                            <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                              {String(r.source_type).replace(/_/g, ' ')}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {(r.counterparts || []).length === 0
                            ? '—'
                            : r.counterparts
                                .slice(0, 3)
                                .map((c: any) => c.code)
                                .join(', ') +
                              (r.counterparts.length > 3
                                ? ` +${r.counterparts.length - 3}`
                                : '')}
                        </td>
                        <td className="num">{r.debit ? money(r.debit) : '—'}</td>
                        <td className="num">{r.credit ? money(r.credit) : '—'}</td>
                        <td className="num">
                          <strong>{money(r.balance)}</strong>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr>
                    <td colSpan={4}>
                      <strong>Closing balance</strong>
                    </td>
                    <td className="num">
                      <strong>{money(ledgerStatement.period_debit)}</strong>
                    </td>
                    <td className="num">
                      <strong>{money(ledgerStatement.period_credit)}</strong>
                    </td>
                    <td className="num">
                      <strong>{money(ledgerStatement.closing_balance)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewingJournal ? (
        <JournalViewModal
          journal={viewingJournal}
          accounts={accounts}
          onClose={() => setViewingJournal(null)}
          onPost={handlePost}
          onReverse={handleReverse}
        />
      ) : null}
    </div>
  );
}
