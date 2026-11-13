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

export function ProfitLossTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pl, setPl] = useState<any>(null);
  const [asAtDate, setAsAtDate] = useState(todayIsoDate);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [reportLoading, setReportLoading] = useState(false);

  const plRevenueTree = useMemo(
    () => buildConsolidatedReportTree(pl?.revenues || pl?.revenue, accounts),
    [pl, accounts]
  );
  const plCogsTree = useMemo(
    () => buildConsolidatedReportTree(pl?.cogs, accounts),
    [pl, accounts]
  );
  const plExpenseTree = useMemo(
    () => buildConsolidatedReportTree(pl?.expenses, accounts),
    [pl, accounts]
  );

  const loadPl = async (asAt = asAtDate) => {
    try {
      setReportLoading(true);
      setPl(await api.accounting.profitLoss(undefined, asAt || undefined));
    } catch (e: any) {
      await alertError('Profit & loss', e.message);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        setAccounts(await api.accounting.accounts());
      } catch (e: any) {
        await alertError('Profit & loss', e.message);
      }
      await loadPl();
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
        onRun={() => void loadPl(asAtDate)}
      />
      {!pl ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
          {reportLoading ? 'Loading P&L…' : 'Run the report to view profit & loss.'}
        </div>
      ) : (
        <div style={{ padding: '0 1.25rem 1.25rem', display: 'grid', gap: 16 }}>
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: 10,
              border: '1px solid var(--line)',
              background:
                Number(pl.net_income ?? pl.totals?.net_profit ?? 0) >= 0
                  ? 'rgba(16, 185, 129, 0.08)'
                  : 'rgba(239, 68, 68, 0.08)',
              fontSize: '0.9rem',
              fontWeight: 600
            }}
          >
            As at {pl.as_at || asAtDate} — Net income{' '}
            {money(pl.net_income ?? pl.totals?.net_profit)} (Revenue{' '}
            {money(pl.total_revenue ?? pl.totals?.revenue)} − COGS{' '}
            {money(pl.total_cogs ?? pl.totals?.cogs)} − Expense{' '}
            {money(pl.total_expense ?? pl.totals?.expenses)})
          </div>

          {(
            [
              ['Revenue', plRevenueTree, pl.total_revenue ?? pl.totals?.revenue, 'credit'],
              ['COGS', plCogsTree, pl.total_cogs ?? pl.totals?.cogs, 'debit'],
              ['Expenses', plExpenseTree, pl.total_expense ?? pl.totals?.expenses, 'debit']
            ] as const
          ).map(([title, tree, total, side]) => (
            <div key={title}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {flattenExpandedReportTree(tree, expandedIds).map((r) => (
                      <tr
                        key={r.row_key}
                        style={
                          r.is_direct ? { background: 'rgba(245, 158, 11, 0.08)' } : undefined
                        }
                      >
                        <td>
                          <ReportNameCell
                            node={r}
                            expandedIds={expandedIds}
                            onToggle={onToggle}
                          />
                        </td>
                        <td className="num">
                          <strong>
                            {money(side === 'credit' ? r.credit - r.debit : r.debit - r.credit)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total {title}</strong>
                      </td>
                      <td className="num">
                        <strong>{money(total)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
            <strong>Gross profit</strong>
            <strong>{money(pl.totals?.gross_profit)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem' }}>
            <strong>Net profit</strong>
            <strong>{money(pl.net_income ?? pl.totals?.net_profit)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
