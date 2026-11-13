import React, { useMemo } from 'react';
import { AccountingModalShell } from './AccountingModalShell';
import { accountLabel, money } from './shared';

type Props = {
  journal: any;
  accounts: any[];
  onClose: () => void;
  onPost?: (id: string) => void | Promise<void>;
  onReverse?: (id: string) => void | Promise<void>;
};

export function JournalViewModal({ journal, accounts, onClose, onPost, onReverse }: Props) {
  const totals = useMemo(() => {
    return {
      debit: (journal.lines || []).reduce(
        (s: number, l: any) => s + (Number(l.debit) || 0),
        0
      ),
      credit: (journal.lines || []).reduce(
        (s: number, l: any) => s + (Number(l.credit) || 0),
        0
      )
    };
  }, [journal]);

  return (
    <AccountingModalShell
      title={`Journal ${journal.entry_number}`}
      onClose={onClose}
      footer={
        <>
          {journal.status === 'draft' && onPost ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const id = journal.id;
                onClose();
                await onPost(id);
              }}
            >
              Post entry
            </button>
          ) : null}
          {journal.status === 'posted' && onReverse ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const id = journal.id;
                onClose();
                await onReverse(id);
              }}
            >
              Reverse entry
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 16
        }}
      >
        <div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Date</div>
          <div>{String(journal.entry_date).slice(0, 10)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Status</div>
          <div>{journal.status}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Posted</div>
          <div>
            {journal.posted_at
              ? String(journal.posted_at).slice(0, 19).replace('T', ' ')
              : '—'}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Source</div>
          <div>{journal.source_type || 'manual'}</div>
        </div>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)' }}>
        Memo: {journal.memo || '—'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Account</th>
              <th>Description</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(journal.lines || []).map((line: any, idx: number) => (
              <tr key={line.id || idx}>
                <td>{line.line_no ?? idx + 1}</td>
                <td>{accountLabel(accounts, line.account_id, line.account)}</td>
                <td>{line.description || '—'}</td>
                <td className="num">{Number(line.debit) > 0 ? money(line.debit) : '—'}</td>
                <td className="num">{Number(line.credit) > 0 ? money(line.credit) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Totals</strong>
              </td>
              <td className="num">
                <strong>{money(totals.debit)}</strong>
              </td>
              <td className="num">
                <strong>{money(totals.credit)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AccountingModalShell>
  );
}
