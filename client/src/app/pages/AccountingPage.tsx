import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Eye, Plus, X } from 'lucide-react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';
import { DefaultAccountsPanel } from '../components/DefaultAccountsPanel';
import { SearchSelect } from '../components/SearchSelect';
import {
  buildConsolidatedReportTree,
  flattenExpandedReportTree,
  type ConsolidatedReportNode
} from '../utils/accountReportTree';

type Tab = 'coa' | 'defaults' | 'journals' | 'trial' | 'pl' | 'bs' | 'cf' | 'ledger' | 'periods';

const ACCOUNT_TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'cogs', label: 'COGS' },
  { value: 'expense', label: 'Expense' }
] as const;

type AccountTreeRow = any & { depth: number; childCount: number };

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

/** Flatten accounts into a depth-first tree ordered by code. */
function flattenAccountTree(accounts: any[]): AccountTreeRow[] {
  type Node = any & { children: Node[] };
  const byId = new Map<string, Node>();
  for (const a of accounts) {
    byId.set(a.id, { ...a, children: [] });
  }
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: Node[]) => {
    nodes.sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    );
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  const rows: AccountTreeRow[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      rows.push({ ...n, depth, childCount: n.children.length });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

export const AccountingPage: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [trial, setTrial] = useState<any>(null);
  const [pl, setPl] = useState<any>(null);
  const [bs, setBs] = useState<any>(null);
  const [cf, setCf] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>('coa');
  const [cfFrom, setCfFrom] = useState(yearStartIsoDate);
  const [cfTo, setCfTo] = useState(todayIsoDate);
  const [asAtDate, setAsAtDate] = useState(todayIsoDate);
  const [expandedReportIds, setExpandedReportIds] = useState<Set<string>>(() => new Set());
  const [reportLoading, setReportLoading] = useState(false);

  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledgerStart, setLedgerStart] = useState(yearStartIsoDate);
  const [ledgerEnd, setLedgerEnd] = useState(todayIsoDate);
  const [ledgerStatement, setLedgerStatement] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [journalStart, setJournalStart] = useState('');
  const [journalEnd, setJournalEnd] = useState('');
  const [journalEntryNumber, setJournalEntryNumber] = useState('');
  const [journalStatus, setJournalStatus] = useState('');

  const [showJournalModal, setShowJournalModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [viewingJournal, setViewingJournal] = useState<any | null>(null);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);

  const [journalMemo, setJournalMemo] = useState('');
  const [journalLines, setJournalLines] = useState<
    { account_id: string; description: string; debit: string; credit: string }[]
  >([
    { account_id: '', description: '', debit: '', credit: '' },
    { account_id: '', description: '', debit: '', credit: '' }
  ]);

  const [accountForm, setAccountForm] = useState({
    code: '',
    name: '',
    account_type: 'asset',
    parent_id: '',
    description: ''
  });

  const accountTreeRows = useMemo(() => flattenAccountTree(accounts), [accounts]);
  const accountsById = useMemo(() => {
    const map = new Map<string, any>();
    accounts.forEach((a) => map.set(a.id, a));
    return map;
  }, [accounts]);

  const trialTree = useMemo(
    () => buildConsolidatedReportTree(trial?.rows, accounts),
    [trial, accounts]
  );
  const trialDisplayRows = useMemo(
    () => flattenExpandedReportTree(trialTree, expandedReportIds),
    [trialTree, expandedReportIds]
  );
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

  const activeAccountOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.is_active)
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts]
  );

  const parentAccountOptions = useMemo(
    () =>
      accountTreeRows
        .filter((a) => a.is_active)
        .map((a) => ({
          value: a.id,
          label: `${'— '.repeat(a.depth)}${a.code} — ${a.name}`
        })),
    [accountTreeRows]
  );

  const journalDebitTotal = useMemo(
    () => journalLines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
    [journalLines]
  );
  const journalCreditTotal = useMemo(
    () => journalLines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
    [journalLines]
  );

  const viewingTotals = useMemo(() => {
    if (!viewingJournal) return { debit: 0, credit: 0 };
    return {
      debit: (viewingJournal.lines || []).reduce(
        (s: number, l: any) => s + (Number(l.debit) || 0),
        0
      ),
      credit: (viewingJournal.lines || []).reduce(
        (s: number, l: any) => s + (Number(l.credit) || 0),
        0
      )
    };
  }, [viewingJournal]);

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

  const load = async (from = cfFrom, to = cfTo) => {
    try {
      const [a, c, per] = await Promise.all([
        api.accounting.accounts(),
        api.accounting.cashFlow(from || undefined, to || undefined),
        api.accounting.periods()
      ]);
      await loadJournals();
      setAccounts(a);
      setCf(c);
      setPeriods(per);
      if (tab === 'trial') await loadTrial();
      if (tab === 'pl') await loadPl();
      if (tab === 'bs') await loadBs();
      const active = a.filter((x: any) => x.is_active);
      if (active.length) {
        setLedgerAccountId((prev) => prev || active[0].id);
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
      await alertError('Accounting', e.message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'trial') void loadTrial();
    if (tab === 'pl') void loadPl();
    if (tab === 'bs') void loadBs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const toggleReportExpand = (accountId: string) => {
    setExpandedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const renderReportName = (node: ConsolidatedReportNode) => {
    if (node.is_direct) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: node.depth * 14,
            fontStyle: 'italic',
            color: 'var(--ink-muted)'
          }}
          title="Amounts journaled directly to this parent ledger (not via children)"
        >
          {node.name}
        </span>
      );
    }

    return (
      <button
        type="button"
        disabled={!node.has_children}
        onClick={() => node.has_children && toggleReportExpand(node.account_id)}
        className="btn btn-ghost"
        style={{
          padding: '0.15rem 0.35rem',
          justifyContent: 'flex-start',
          paddingLeft: node.depth * 14,
          fontWeight: node.has_children ? 700 : 500,
          cursor: node.has_children ? 'pointer' : 'default'
        }}
        title={
          node.has_children
            ? expandedReportIds.has(node.account_id)
              ? 'Hide breakdown'
              : 'Show breakdown (direct + children)'
            : undefined
        }
      >
        {node.has_children ? (
          expandedReportIds.has(node.account_id) ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <span>
          {node.code} — {node.name}
        </span>
        {node.has_children && !expandedReportIds.has(node.account_id) ? (
          <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--ink-muted)' }}>
            total
          </span>
        ) : null}
      </button>
    );
  };

  const asAtToolbar = (onRun: () => void) => (
    <div
      style={{
        padding: '0.75rem 1rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'end',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
        Parent totals = direct postings on the parent + all children. Expand a parent to see each
        part.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>As at</label>
          <input type="date" value={asAtDate} onChange={(e) => setAsAtDate(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" disabled={reportLoading} onClick={onRun}>
          {reportLoading ? 'Running…' : 'Run report'}
        </button>
      </div>
    </div>
  );

  useEffect(() => {
    if (!showAccountModal && !showJournalModal && !viewingJournal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowAccountModal(false);
      setShowJournalModal(false);
      setViewingJournal(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [showAccountModal, showJournalModal, viewingJournal]);

  const openCreateAccount = (parent?: any | null) => {
    setAccountForm({
      code: '',
      name: '',
      account_type: parent?.account_type || 'asset',
      parent_id: parent?.id || '',
      description: ''
    });
    setShowAccountModal(true);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.accounting.createAccount({
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        account_type: accountForm.account_type,
        parent_id: accountForm.parent_id || null,
        description: accountForm.description.trim() || undefined,
        is_active: true
      });
      setShowAccountModal(false);
      await alertSuccess('Account created');
      await load();
      setTab('coa');
    } catch (err: any) {
      await alertError('Create account failed', err.message);
    }
  };

  const handleToggleAccountActive = async (account: any) => {
    const nextActive = !account.is_active;
    const ok = await confirmAction(
      nextActive ? 'Enable account?' : 'Disable account?',
      nextActive
        ? `Enable ledger "${account.code} — ${account.name}"?`
        : `Disable ledger "${account.code} — ${account.name}"? It will no longer appear for new journal lines.`
    );
    if (!ok) return;
    try {
      setTogglingAccountId(account.id);
      await api.accounting.updateAccount(account.id, { is_active: nextActive });
      await alertSuccess(nextActive ? 'Account enabled' : 'Account disabled');
      await load();
    } catch (err: any) {
      await alertError('Account update failed', err.message);
    } finally {
      setTogglingAccountId(null);
    }
  };

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
      await load();
      setTab('journals');
    } catch (err: any) {
      await alertError('Create journal failed', err.message);
    }
  };

  const handlePost = async (id: string) => {
    try {
      await api.accounting.postJournal(id);
      await alertSuccess('Journal posted');
      await load();
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
      await load();
    } catch (err: any) {
      await alertError('Reverse failed', err.message);
    }
  };

  const accountLabel = (accountId: string, lineAccount?: { code: string; name: string } | null) => {
    if (lineAccount?.code) return `${lineAccount.code} — ${lineAccount.name}`;
    const a = accounts.find((x) => x.id === accountId);
    return a ? `${a.code} — ${a.name}` : accountId;
  };

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
    { id: 'ledger', label: 'Ledger statement' },
    { id: 'periods', label: 'Periods' }
  ];

  const ledgerAccountOptions = useMemo(
    () =>
      accountTreeRows.map((a) => ({
        value: a.id,
        label: `${'— '.repeat(a.depth)}${a.code} — ${a.name}${a.is_active ? '' : ' (disabled)'}`
      })),
    [accountTreeRows]
  );

  const renderModalShell = (
    title: string,
    onClose: () => void,
    body: React.ReactNode,
    footer?: React.ReactNode
  ) =>
    createPortal(
      <div
        className="modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="modal invoice-view" role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal__header">
            <div>
              <div className="invoice-view__eyebrow">Accounting</div>
              <h2 className="display invoice-view__number">{title}</h2>
            </div>
            <div className="modal__actions">
              <button type="button" className="line-items__remove" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="modal__body">{body}</div>
          {footer ? <div className="modal__footer">{footer}</div> : null}
        </div>
      </div>,
      document.body
    );

  return (
    <div className="page-stack">
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Accounting
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            Chart of accounts, default posting maps, journals, trial balance, P&amp;L, balance sheet,
            cash flow and period locks.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => openCreateAccount(null)}>
            New ledger account
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setShowJournalModal(true)}>
            Create journal entry
          </button>
        </div>
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
          <div style={{ padding: '0.75rem 1rem', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Chart of accounts is a tree: top-level accounts have no parent; children nest under a
            parent (same type). Use <strong>Add child</strong> or pick a parent when creating.
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Parent</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountTreeRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                      No ledger accounts yet. Create one to get started.
                    </td>
                  </tr>
                ) : (
                  accountTreeRows.map((a) => {
                    const parent = a.parent_id ? accountsById.get(a.parent_id) : null;
                    return (
                      <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.65 }}>
                        <td>
                          <div style={{ paddingLeft: a.depth * 18 }}>
                            <div style={{ fontWeight: 600 }}>
                              <span style={{ fontFamily: 'ui-monospace, monospace', marginRight: 8 }}>
                                {a.code}
                              </span>
                              {a.name}
                              {a.childCount > 0 ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    color: 'var(--ink-muted)',
                                    fontSize: '0.75rem',
                                    fontWeight: 500
                                  }}
                                >
                                  {a.childCount} child{a.childCount === 1 ? '' : 'ren'}
                                </span>
                              ) : null}
                            </div>
                            {a.description ? (
                              <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                                {a.description}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {parent ? (
                            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{parent.code}</span>
                          ) : (
                            <span style={{ color: 'var(--ink-muted)' }}>Top level</span>
                          )}
                        </td>
                        <td>{a.account_type}</td>
                        <td>{a.is_active ? 'Active' : 'Disabled'}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => openCreateAccount(a)}
                            >
                              <Plus size={14} /> Add child
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={togglingAccountId === a.id}
                              onClick={() => void handleToggleAccountActive(a)}
                              style={a.is_active ? { color: 'var(--danger)' } : undefined}
                            >
                              {a.is_active ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'defaults' ? <DefaultAccountsPanel /> : null}

      {tab === 'journals' ? (
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
                            {j.status === 'draft' ? (
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void handlePost(j.id)}
                              >
                                Post
                              </button>
                            ) : null}
                            {j.status === 'posted' ? (
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
      ) : null}

      {tab === 'trial' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0', display: 'grid', gap: 0 }}>
          {asAtToolbar(() => void loadTrial(asAtDate))}
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
                        <td>{renderReportName(r)}</td>
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
      ) : null}

      {tab === 'pl' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0', display: 'grid', gap: 0 }}>
          {asAtToolbar(() => void loadPl(asAtDate))}
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
                        {flattenExpandedReportTree(tree, expandedReportIds).map((r) => (
                          <tr
                            key={r.row_key}
                            style={
                              r.is_direct ? { background: 'rgba(245, 158, 11, 0.08)' } : undefined
                            }
                          >
                            <td>{renderReportName(r)}</td>
                            <td className="num">
                              <strong>
                                {money(
                                  side === 'credit' ? r.credit - r.debit : r.debit - r.credit
                                )}
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
      ) : null}

      {tab === 'bs' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0', display: 'grid', gap: 0 }}>
          {asAtToolbar(() => void loadBs(asAtDate))}
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
                As at {bs.as_at || asAtDate} — Assets {money(bs.total_assets ?? bs.totals?.assets)}{' '}
                vs Liabilities + Equity{' '}
                {money(bs.totals?.liabilities_and_equity)}{' '}
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
                        {flattenExpandedReportTree(tree, expandedReportIds).map((r) => (
                          <tr
                            key={r.row_key}
                            style={
                              r.is_direct ? { background: 'rgba(245, 158, 11, 0.08)' } : undefined
                            }
                          >
                            <td>{renderReportName(r)}</td>
                            <td className="num">
                              <strong>
                                {money(
                                  side === 'debit' ? r.debit - r.credit : r.credit - r.debit
                                )}
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
      ) : null}

      {tab === 'cf' && cf ? (
        <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>From</span>
              <input type="date" value={cfFrom} onChange={(e) => setCfFrom(e.target.value)} />
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

      {tab === 'ledger' ? (
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
            <div className="card-surface" style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
              Loading statement…
            </div>
          ) : !ledgerStatement ? (
            <div className="card-surface" style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
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
                      <div style={{ fontWeight: 800, fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
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

      {viewingJournal
        ? renderModalShell(
            `Journal ${viewingJournal.entry_number}`,
            () => setViewingJournal(null),
            <>
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
                  <div>{String(viewingJournal.entry_date).slice(0, 10)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Status</div>
                  <div>{viewingJournal.status}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Posted</div>
                  <div>
                    {viewingJournal.posted_at
                      ? String(viewingJournal.posted_at).slice(0, 19).replace('T', ' ')
                      : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>Source</div>
                  <div>{viewingJournal.source_type || 'manual'}</div>
                </div>
              </div>
              <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)' }}>
                Memo: {viewingJournal.memo || '—'}
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
                    {(viewingJournal.lines || []).map((line: any, idx: number) => (
                      <tr key={line.id || idx}>
                        <td>{line.line_no ?? idx + 1}</td>
                        <td>{accountLabel(line.account_id, line.account)}</td>
                        <td>{line.description || '—'}</td>
                        <td className="num">
                          {Number(line.debit) > 0 ? money(line.debit) : '—'}
                        </td>
                        <td className="num">
                          {Number(line.credit) > 0 ? money(line.credit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        <strong>Totals</strong>
                      </td>
                      <td className="num">
                        <strong>{money(viewingTotals.debit)}</strong>
                      </td>
                      <td className="num">
                        <strong>{money(viewingTotals.credit)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>,
            <>
              {viewingJournal.status === 'draft' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const id = viewingJournal.id;
                    setViewingJournal(null);
                    await handlePost(id);
                  }}
                >
                  Post entry
                </button>
              ) : null}
              {viewingJournal.status === 'posted' ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    const id = viewingJournal.id;
                    setViewingJournal(null);
                    await handleReverse(id);
                  }}
                >
                  Reverse entry
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost" onClick={() => setViewingJournal(null)}>
                Close
              </button>
            </>
          )
        : null}

      {showAccountModal
        ? renderModalShell(
            accountForm.parent_id
              ? `New child under ${accountsById.get(accountForm.parent_id)?.code || 'parent'}`
              : 'New ledger account',
            () => setShowAccountModal(false),
            <form id="create-account-form" onSubmit={handleCreateAccount} style={{ display: 'grid', gap: 12 }}>
              <div className="field">
                <label>Parent account</label>
                <SearchSelect
                  value={accountForm.parent_id}
                  allowEmpty
                  emptyLabel="None — top level"
                  placeholder="None — top level"
                  options={parentAccountOptions}
                  onChange={(parentId) => {
                    const parent = parentId ? accountsById.get(parentId) : null;
                    setAccountForm({
                      ...accountForm,
                      parent_id: parentId,
                      account_type: parent?.account_type || accountForm.account_type
                    });
                  }}
                />
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Code</label>
                  <input
                    required
                    value={accountForm.code}
                    onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })}
                    placeholder="e.g. 1110"
                  />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select
                    required
                    value={accountForm.account_type}
                    disabled={!!accountForm.parent_id}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, account_type: e.target.value })
                    }
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Name</label>
                <input
                  required
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  placeholder="e.g. Cash on Hand"
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input
                  value={accountForm.description}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, description: e.target.value })
                  }
                  placeholder="Optional notes"
                />
              </div>
            </form>,
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAccountModal(false)}>
                Cancel
              </button>
              <button type="submit" form="create-account-form" className="btn btn-primary">
                Create account
              </button>
            </>
          )
        : null}

      {showJournalModal
        ? renderModalShell(
            'Create journal entry',
            () => setShowJournalModal(false),
            <form id="create-journal-form" onSubmit={handleCreateJournal} style={{ display: 'grid', gap: 12 }}>
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
            </form>,
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setShowJournalModal(false)}>
                Cancel
              </button>
              <button type="submit" form="create-journal-form" className="btn btn-primary">
                Save draft journal
              </button>
            </>
          )
        : null}
    </div>
  );
};
