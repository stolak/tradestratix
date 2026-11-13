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

export function BalanceSheetTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [bs, setBs] = useState<any>(null);
  const [asAtDate, setAsAtDate] = useState(todayIsoDate);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [reportLoading, setReportLoading] = useState(false);

  const balanceAssetTree = useMemo(
    () => buildConsolidatedReportTree(bs?.assets, accounts),
    [bs, accounts]
  );
  const balanceLiabilityTree = useMemo(
    () => buildConsolidatedReportTree(bs?.liabilities, accounts),
    [bs, accounts]
  );
  const balanceEquityTree = useMemo(
    () =>
      buildConsolidatedReportTree(
        (bs?.equity || []).filter((r: any) => r.account_id !== '__net_income__'),
        accounts
      ),
    [bs, accounts]
  );

  const loadBs = async (asAt = asAtDate) => {
    try {
      setReportLoading(true);
      setBs(await api.accounting.balanceSheet(asAt || undefined));
    } catch (e: any) {
      await alertError('Balance sheet', e.message);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        setAccounts(await api.accounting.accounts());
      } catch (e: any) {
        await alertError('Balance sheet', e.message);
      }
      await loadBs();
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
        onRun={() => void loadBs(asAtDate)}
      />
      {!bs ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
          {reportLoading ? 'Loading balance sheet…' : 'Run the report to view balance sheet.'}
        </div>
      ) : (
        <div style={{ padding: '0 1.25rem 1.25rem', display: 'grid', gap: 16 }}>
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: bs.totals?.balanced
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
              fontSize: '0.9rem',
              fontWeight: 600
            }}
          >
            As at {bs.as_at || asAtDate} — Assets {money(bs.total_assets ?? bs.totals?.assets)} vs
            Liabilities + Equity {money(bs.totals?.liabilities_and_equity)}{' '}
            {bs.totals?.balanced ? '(balanced)' : '(does not balance)'}
          </div>

          {(
            [
              ['Assets', balanceAssetTree, bs.total_assets ?? bs.totals?.assets, 'debit'],
              [
                'Liabilities',
                balanceLiabilityTree,
                bs.total_liabilities ?? bs.totals?.liabilities,
                'credit'
              ],
              ['Equity', balanceEquityTree, bs.total_equity ?? bs.totals?.equity, 'credit']
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
                            {money(side === 'debit' ? r.debit - r.credit : r.credit - r.debit)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                    {title === 'Equity' && Number(bs.retained_earnings || 0) !== 0 ? (
                      <tr>
                        <td>Retained earnings (YTD)</td>
                        <td className="num">
                          <strong>{money(bs.retained_earnings)}</strong>
                        </td>
                      </tr>
                    ) : null}
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

          <div style={{ color: 'var(--ink-muted)' }}>
            Liabilities + equity: {money(bs.totals?.liabilities_and_equity)}{' '}
            {bs.totals?.balanced ? '(balanced)' : '(check net income fold)'}
          </div>
        </div>
      )}
    </div>
  );
}
