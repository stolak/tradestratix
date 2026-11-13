import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../utils/api';
import { alertError, alertSuccess, confirmAction } from '../../utils/alerts';
import { SearchSelect } from '../SearchSelect';
import { AccountingModalShell } from './AccountingModalShell';
import { JournalViewModal } from './JournalViewModal';
import { money } from './shared';

export type JournalsTabHandle = {
  openCreate: () => void;
  refresh: () => Promise<void>;
};

export const JournalsTab = forwardRef<JournalsTabHandle>(function JournalsTab(_props, ref) {
  const { can } = useAuth();
  const canPost = can('accounting.post');
  const canReverse = can('accounting.reverse');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [journalsLoading, setJournalsLoading] = useState(false);

  const [journalStart, setJournalStart] = useState('');
  const [journalEnd, setJournalEnd] = useState('');
  const [journalEntryNumber, setJournalEntryNumber] = useState('');
  const [journalStatus, setJournalStatus] = useState('');

  const [showJournalModal, setShowJournalModal] = useState(false);
  const [viewingJournal, setViewingJournal] = useState<any | null>(null);

  const [journalMemo, setJournalMemo] = useState('');
  const [journalLines, setJournalLines] = useState<
    { account_id: string; description: string; debit: string; credit: string }[]
  >([
    { account_id: '', description: '', debit: '', credit: '' },
    { account_id: '', description: '', debit: '', credit: '' }
  ]);

  const activeAccountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.is_active)
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  );

  const journalDebitTotal = useMemo(
    () => journalLines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
    [journalLines]
  );
  const journalCreditTotal = useMemo(
    () => journalLines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
    [journalLines]
  );

  const loadJournals = async (
    filters?: Partial<{
      from: string;
      to: string;
      entry_number: string;
      status: string;
    }>
  ) => {
    try {
      setJournalsLoading(true);
      const from = filters && 'from' in filters ? filters.from : journalStart;
      const to = filters && 'to' in filters ? filters.to : journalEnd;
      const entry_number =
        filters && 'entry_number' in filters ? filters.entry_number : journalEntryNumber;
      const status = filters && 'status' in filters ? filters.status : journalStatus;
      setJournals(
        await api.accounting.journals({
          from: from || undefined,
          to: to || undefined,
          entry_number: entry_number?.trim() || undefined,
          status: status || undefined
        })
      );
    } catch (e: any) {
      await alertError('Journals', e.message);
    } finally {
      setJournalsLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const a = await api.accounting.accounts();
      setAccounts(a);
      const active = a.filter((x: any) => x.is_active);
      if (active.length) {
        setJournalLines((lines) =>
          lines.every((l) => !l.account_id)
            ? [
                {
                  account_id: active[0].id,
                  description: '',
                  debit: '',
                  credit: ''
                },
                {
                  account_id: active[Math.min(1, active.length - 1)].id,
                  description: '',
                  debit: '',
                  credit: ''
                }
              ]
            : lines
        );
      }
    } catch (e: any) {
      await alertError('Accounts', e.message);
    }
  };

  useEffect(() => {
    void loadJournals();
    void loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load
  }, []);

  useImperativeHandle(ref, () => ({
    openCreate: () => {
      if (!canPost) return;
      setShowJournalModal(true);
    },
    refresh: loadJournals
  }));

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.accounting.createJournal({
        memo: journalMemo || undefined,
        post: false,
        lines: journalLines.map((l) => ({
          account_id: l.account_id,
          description: l.description || undefined,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0
        }))
      });
      setShowJournalModal(false);
      setJournalMemo('');
      await alertSuccess('Draft journal saved');
      await loadJournals();
    } catch (err: any) {
      await alertError('Create journal failed', err.message);
    }
  };

  const handlePost = async (id: string) => {
    try {
      await api.accounting.postJournal(id);
      await alertSuccess('Journal posted');
      await loadJournals();
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
      await loadJournals();
    } catch (err: any) {
      await alertError('Reverse failed', err.message);
    }
  };

  return (
    <>
      <div style={{ display: 'grid', gap: 12 }}>
        <form
          className="card-surface cust-bal__filters"
          onSubmit={(e) => {
            e.preventDefault();
            void loadJournals();
          }}
        >
          <div className="field">
            <label>Entry number</label>
            <input
              value={journalEntryNumber}
              onChange={(e) => setJournalEntryNumber(e.target.value)}
              placeholder="e.g. JE-… or partial"
            />
          </div>
          <div className="field">
            <label>From</label>
            <input
              type="date"
              value={journalStart}
              onChange={(e) => setJournalStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={journalEnd} onChange={(e) => setJournalEnd(e.target.value)} />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={journalStatus} onChange={(e) => setJournalStatus(e.target.value)}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={journalsLoading}>
            {journalsLoading ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={journalsLoading}
            onClick={() => {
              setJournalStart('');
              setJournalEnd('');
              setJournalEntryNumber('');
              setJournalStatus('');
              void loadJournals({ from: '', to: '', entry_number: '', status: '' });
            }}
          >
            Clear
          </button>
        </form>

        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div style={{ padding: '0.5rem 1rem', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            {journalsLoading
              ? 'Loading journals…'
              : `${journals.length} journal(s)${
                  journalStart || journalEnd || journalEntryNumber || journalStatus
                    ? ' matching filters'
                    : ''
                }`}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entry #</th>
                  <th>Date</th>
                  <th>Memo</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Supplier</th>
                  <th>Sales rep</th>
                  <th>Source</th>
                  <th>Lines</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {journals.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ color: 'var(--ink-muted)' }}>
                      No journal entries.
                    </td>
                  </tr>
                ) : (
                  journals.map((j) => (
                    <tr
                      key={j.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setViewingJournal(j)}
                    >
                      <td style={{ fontFamily: 'ui-monospace, monospace' }}>{j.entry_number}</td>
                      <td>{String(j.entry_date).slice(0, 10)}</td>
                      <td>{j.memo || '—'}</td>
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setViewingJournal(j)}
                          >
                            <Eye size={14} /> View
                          </button>
                          {j.status === 'draft' && canPost ? (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => void handlePost(j.id)}
                            >
                              Post
                            </button>
                          ) : null}
                          {j.status === 'posted' && canReverse ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void handleReverse(j.id)}
                            >
                              Reverse
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewingJournal ? (
        <JournalViewModal
          journal={viewingJournal}
          accounts={accounts}
          onClose={() => setViewingJournal(null)}
          onPost={canPost ? handlePost : undefined}
          onReverse={canReverse ? handleReverse : undefined}
        />
      ) : null}

      {showJournalModal && canPost ? (
        <AccountingModalShell
          title="Create journal entry"
          onClose={() => setShowJournalModal(false)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowJournalModal(false)}
              >
                Cancel
              </button>
              <button type="submit" form="create-journal-form" className="btn btn-primary">
                Save draft journal
              </button>
            </>
          }
        >
          <form
            id="create-journal-form"
            onSubmit={handleCreateJournal}
            style={{ display: 'grid', gap: 12 }}
          >
            <div className="field">
              <label>Memo</label>
              <input
                value={journalMemo}
                onChange={(e) => setJournalMemo(e.target.value)}
                placeholder="e.g. Monthly depreciation accrual"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>Line items (debit / credit must balance)</div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const activeId = activeAccountOptions[0]?.value || '';
                  setJournalLines([
                    ...journalLines,
                    { account_id: activeId, description: '', debit: '', credit: '' }
                  ]);
                }}
              >
                + Add line
              </button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {journalLines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(160px, 2fr) minmax(120px, 1.5fr) 1fr 1fr auto',
                    gap: 8,
                    alignItems: 'end'
                  }}
                >
                  <div className="field" style={{ margin: 0 }}>
                    {idx === 0 ? <label>Account</label> : null}
                    <SearchSelect
                      required
                      value={line.account_id}
                      options={activeAccountOptions}
                      placeholder="Search account…"
                      onChange={(account_id) => {
                        const updated = [...journalLines];
                        updated[idx] = { ...updated[idx], account_id };
                        setJournalLines(updated);
                      }}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    {idx === 0 ? <label>Description</label> : null}
                    <input
                      value={line.description}
                      onChange={(e) => {
                        const updated = [...journalLines];
                        updated[idx] = { ...updated[idx], description: e.target.value };
                        setJournalLines(updated);
                      }}
                      placeholder="Description"
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    {idx === 0 ? <label>Debit</label> : null}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit}
                      onChange={(e) => {
                        const updated = [...journalLines];
                        updated[idx] = { ...updated[idx], debit: e.target.value, credit: '' };
                        setJournalLines(updated);
                      }}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    {idx === 0 ? <label>Credit</label> : null}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit}
                      onChange={(e) => {
                        const updated = [...journalLines];
                        updated[idx] = { ...updated[idx], credit: e.target.value, debit: '' };
                        setJournalLines(updated);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={journalLines.length <= 2}
                    onClick={() => setJournalLines(journalLines.filter((_, i) => i !== idx))}
                    style={{ color: 'var(--danger)' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
              Debit: {money(journalDebitTotal)} · Credit: {money(journalCreditTotal)}
              {Math.abs(journalDebitTotal - journalCreditTotal) > 0.001 ? (
                <span style={{ color: 'var(--danger)', marginLeft: 8 }}>(unbalanced)</span>
              ) : null}
            </div>
          </form>
        </AccountingModalShell>
      ) : null}
    </>
  );
});
