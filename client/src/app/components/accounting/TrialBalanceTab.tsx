import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { alertError } from '../../utils/alerts';
import {
  buildConsolidatedReportTree,
  flattenExpandedReportTree
} from '../../utils/accountReportTree';
import { AsAtToolbar } from './AsAtToolbar';
import { ReportNameCell } from './ReportNameCell';
import { money, todayIsoDate, toggleIdInSet } from './shared';

export function TrialBalanceTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [trial, setTrial] = useState<any>(null);
  const [asAtDate, setAsAtDate] = useState(todayIsoDate);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [reportLoading, setReportLoading] = useState(false);

  const trialTree = useMemo(
    () => buildConsolidatedReportTree(trial?.rows, accounts),
    [trial, accounts]
  );
  const trialDisplayRows = useMemo(
    () => flattenExpandedReportTree(trialTree, expandedIds),
    [trialTree, expandedIds]
  );

  const loadTrial = async (asAt = asAtDate) => {
    try {
      setReportLoading(true);
      setTrial(await api.accounting.trialBalance(asAt || undefined));
    } catch (e: any) {
      await alertError('Trial balance', e.message);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        setAccounts(await api.accounting.accounts());
      } catch (e: any) {
        await alertError('Trial balance', e.message);
      }
      await loadTrial();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onToggle = (accountId: string) => {
    setExpandedIds((prev) => toggleIdInSet(prev, accountId));
  };

  return (
    <div className="card-surface" style={{ padding: '0.5rem 0', display: 'grid', gap: 0 }}>
      <AsAtToolbar
        asAtDate={asAtDate}
        onAsAtChange={setAsAtDate}
        loading={reportLoading}
        onRun={() => void loadTrial(asAtDate)}
      />
      {!trial ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
          {reportLoading ? 'Loading trial balance…' : 'Run the report to view trial balance.'}
        </div>
      ) : (
        <>
          <div
            style={{
              margin: '0 1rem 0.75rem',
              padding: '0.65rem 0.85rem',
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: trial.balanced
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
              fontSize: '0.9rem',
              fontWeight: 600
            }}
          >
            As at {trial.as_at || asAtDate} — Trial balance{' '}
            {trial.balanced ? 'is balanced' : 'is NOT balanced'} — Debits{' '}
            {money(trial.total_debit)} / Credits {money(trial.total_credit)}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {trialDisplayRows.map((r) => (
                  <tr
                    key={r.row_key}
                    style={
                      r.is_direct
                        ? { background: 'rgba(245, 158, 11, 0.08)' }
                        : r.has_children
                          ? { background: 'rgba(15, 23, 42, 0.02)' }
                          : undefined
                    }
                  >
                    <td>
                      <ReportNameCell node={r} expandedIds={expandedIds} onToggle={onToggle} />
                    </td>
                    <td>{r.account_type}</td>
                    <td className="num">{money(r.debit)}</td>
                    <td className="num">{money(r.credit)}</td>
                    <td className="num">
                      <strong>{money(r.balance)}</strong>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <strong>Totals</strong>
                  </td>
                  <td className="num">
                    <strong>{money(trial.total_debit)}</strong>
                  </td>
                  <td className="num">
                    <strong>{money(trial.total_credit)}</strong>
                  </td>
                  <td className="num">
                    <strong>
                      {money(Number(trial.total_debit || 0) - Number(trial.total_credit || 0))}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
