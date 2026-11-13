import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../utils/api';
import { alertError } from '../../utils/alerts';
import {
  buildCashPositionTree,
  flattenExpandedCashPositionTree
} from '../../utils/accountReportTree';
import { money, roundMoneySafe, todayIsoDate, toggleIdInSet, yearStartIsoDate } from './shared';

function renderCashFlowSection(
  title: string,
  section:
    | {
        inflow?: number;
        outflow?: number;
        net?: number;
        rows?: any[];
        inflows?: any[];
        outflows?: any[];
      }
    | undefined
) {
  if (!section) return null;
  const rows =
    section.rows ||
    [
      ...(section.inflows || []).map((r: any) => ({
        account_id: r.key,
        code: r.key,
        name: r.label,
        inflow: r.amount,
        outflow: 0
      })),
      ...(section.outflows || []).map((r: any) => ({
        account_id: r.key,
        code: r.key,
        name: r.label,
        inflow: 0,
        outflow: r.amount
      }))
    ];
  const inflow =
    section.inflow ??
    roundMoneySafe(rows.reduce((s: number, r: any) => s + (Number(r.inflow) || 0), 0));
  const outflow =
    section.outflow ??
    roundMoneySafe(rows.reduce((s: number, r: any) => s + (Number(r.outflow) || 0), 0));
  const net = section.net ?? roundMoneySafe(inflow - outflow);

  return (
    <div className="card-surface" style={{ padding: '0.5rem 0' }}>
      <div
        style={{
          padding: '0.75rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          borderBottom: '1px solid var(--line)'
        }}
      >
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
          Net {money(net)}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Inflow</th>
              <th className="num">Outflow</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                  No movements in this category.
                </td>
              </tr>
            ) : (
              rows.map((r: any) => (
                <tr key={`${title}-${r.account_id || r.code}-${r.name}`}>
                  <td>
                    {r.code && r.code !== r.name ? `${r.code} — ${r.name}` : r.name || r.label}
                  </td>
                  <td className="num">{r.inflow ? money(r.inflow) : '—'}</td>
                  <td className="num">{r.outflow ? money(r.outflow) : '—'}</td>
                </tr>
              ))
            )}
            <tr>
              <td>
                <strong>Section total</strong>
              </td>
              <td className="num">
                <strong>{money(inflow)}</strong>
              </td>
              <td className="num">
                <strong>{money(outflow)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CashFlowTab() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cf, setCf] = useState<any>(null);
  const [cfFrom, setCfFrom] = useState(yearStartIsoDate);
  const [cfTo, setCfTo] = useState(todayIsoDate);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [reportLoading, setReportLoading] = useState(false);

  const cashPositionTree = useMemo(
    () => buildCashPositionTree(cf?.by_account || cf?.cash_accounts, accounts),
    [cf, accounts]
  );
  const cashPositionRows = useMemo(
    () => flattenExpandedCashPositionTree(cashPositionTree, expandedIds),
    [cashPositionTree, expandedIds]
  );

  const loadCashFlow = async (from = cfFrom, to = cfTo) => {
    try {
      setReportLoading(true);
      setCf(await api.accounting.cashFlow(from || undefined, to || undefined));
    } catch (e: any) {
      await alertError('Cash flow', e.message);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        setAccounts(await api.accounting.accounts());
      } catch (e: any) {
        await alertError('Cash flow', e.message);
      }
      await loadCashFlow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (accountId: string) => {
    setExpandedIds((prev) => toggleIdInSet(prev, accountId));
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Cash flow statement</div>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            Direct method from posted journals on cash / bank / till ledgers (and their children).
            Transfers between cash accounts are shown separately.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>From</label>
            <input type="date" value={cfFrom} onChange={(e) => setCfFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>To</label>
            <input type="date" value={cfTo} onChange={(e) => setCfTo(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={reportLoading}
            onClick={() => void loadCashFlow(cfFrom, cfTo)}
          >
            {reportLoading ? 'Running…' : 'Run report'}
          </button>
        </div>
      </div>

      {!cf ? (
        <div
          className="card-surface"
          style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}
        >
          {reportLoading ? 'Loading cash flow…' : 'Run the report to view cash flow.'}
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12
            }}
          >
            {(
              [
                ['Opening cash', cf.opening_balance ?? cf.totals?.opening_cash],
                ['Net change', cf.net_change ?? cf.totals?.net_change],
                ['Closing cash', cf.closing_balance ?? cf.totals?.closing_cash],
                ['From activities', cf.period_net_from_activities ?? cf.totals?.net_change]
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="card-surface" style={{ padding: '0.85rem 1rem' }}>
                <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>{label}</div>
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '1.05rem'
                  }}
                >
                  {money(value)}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {renderCashFlowSection('Operating activities', cf.operating)}
            {renderCashFlowSection('Investing activities', cf.investing)}
            {renderCashFlowSection('Financing activities', cf.financing)}
            {renderCashFlowSection(
              'Cash transfers (internal)',
              cf.transfers || cf.internal_transfers
            )}
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ padding: '0.75rem 1rem' }}>
              <div style={{ fontWeight: 700 }}>Cash position by account</div>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                Parent totals roll up children. Expand to see direct postings on the parent.
              </p>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Opening</th>
                    <th className="num">Inflow</th>
                    <th className="num">Outflow</th>
                    <th className="num">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {cashPositionRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>
                        No cash / bank activity in this period.
                      </td>
                    </tr>
                  ) : (
                    cashPositionRows.map((r) => (
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
                          {r.is_direct ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                paddingLeft: r.depth * 14,
                                fontStyle: 'italic',
                                color: 'var(--ink-muted)'
                              }}
                            >
                              {r.name}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!r.has_children}
                              className="btn btn-ghost"
                              onClick={() => r.has_children && toggleExpand(r.account_id)}
                              style={{
                                padding: '0.15rem 0.35rem',
                                justifyContent: 'flex-start',
                                paddingLeft: r.depth * 14,
                                fontWeight: r.has_children ? 700 : 500,
                                cursor: r.has_children ? 'pointer' : 'default'
                              }}
                            >
                              {r.has_children ? (
                                expandedIds.has(r.account_id) ? (
                                  <ChevronDown size={14} />
                                ) : (
                                  <ChevronRight size={14} />
                                )
                              ) : (
                                <span style={{ width: 14, display: 'inline-block' }} />
                              )}
                              <span>
                                {r.code} — {r.name}
                              </span>
                            </button>
                          )}
                        </td>
                        <td className="num">{money(r.opening)}</td>
                        <td className="num">{r.inflow ? money(r.inflow) : '—'}</td>
                        <td className="num">{r.outflow ? money(r.outflow) : '—'}</td>
                        <td className="num">
                          <strong>{money(r.closing)}</strong>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
              <strong>Net change in cash</strong>
              <strong>{money(cf.net_change ?? cf.totals?.net_change)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem' }}>
              <strong>Closing cash</strong>
              <strong>{money(cf.closing_balance ?? cf.totals?.closing_cash)}</strong>
            </div>
            <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
              {cf.totals?.closing_reconciles
                ? 'Opening + net change reconciles to closing cash.'
                : 'Opening + net change does not match closing — check unclassified journals.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
