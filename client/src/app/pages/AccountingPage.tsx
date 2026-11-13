import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DefaultAccountsPanel } from '../components/DefaultAccountsPanel';
import {
  BalanceSheetTab,
  CashFlowTab,
  CoaTab,
  type CoaTabHandle,
  JournalsTab,
  type JournalsTabHandle,
  LedgerStatementTab,
  PeriodsTab,
  ProfitLossTab,
  TrialBalanceTab
} from '../components/accounting';
import {
  ACCOUNTING_TABS,
  type AccountingTabId
} from '../components/accounting/tabPermissions';
import { useAuth } from '../context/AuthContext';

export const AccountingPage: React.FC = () => {
  const { can } = useAuth();
  const tabs = useMemo(
    () => ACCOUNTING_TABS.filter((t) => can(t.perm)),
    [can]
  );
  const [tab, setTab] = useState<AccountingTabId>('coa');
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingCoaCreate, setPendingCoaCreate] = useState(false);
  const [pendingJournalCreate, setPendingJournalCreate] = useState(false);
  const coaRef = useRef<CoaTabHandle>(null);
  const journalsRef = useRef<JournalsTabHandle>(null);

  const canCoa = can('accounting.coa');
  const canJournals = can('accounting.journals');
  const canCreateAccount = can('accounting.create');
  const canPostJournal = can('accounting.post');

  useEffect(() => {
    if (activeTab !== 'coa' || !pendingCoaCreate) return;
    coaRef.current?.openCreate(null);
    setPendingCoaCreate(false);
  }, [activeTab, pendingCoaCreate, refreshKey]);

  useEffect(() => {
    if (activeTab !== 'journals' || !pendingJournalCreate) return;
    journalsRef.current?.openCreate();
    setPendingJournalCreate(false);
  }, [activeTab, pendingJournalCreate, refreshKey]);

  const refreshActive = () => {
    if (activeTab === 'coa') {
      void coaRef.current?.refresh();
      return;
    }
    if (activeTab === 'journals') {
      void journalsRef.current?.refresh();
      return;
    }
    setRefreshKey((k) => k + 1);
  };

  if (!tabs.length) {
    return (
      <div className="page-stack">
        <header>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Accounting
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            You can open Accounting, but your role has no tab permissions. Ask an admin to grant
            specific tabs (for example Chart of accounts or Journals) under Roles.
          </p>
        </header>
      </div>
    );
  }

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
          {canCoa && canCreateAccount ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setTab('coa');
                setPendingCoaCreate(true);
              }}
            >
              New ledger account
            </button>
          ) : null}
          {canJournals && canPostJournal ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setTab('journals');
                setPendingJournalCreate(true);
              }}
            >
              Create journal entry
            </button>
          ) : null}
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={activeTab === t.id ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={refreshActive}>
          Refresh
        </button>
      </div>

      {activeTab === 'coa' ? <CoaTab key={`coa-${refreshKey}`} ref={coaRef} /> : null}
      {activeTab === 'defaults' ? <DefaultAccountsPanel key={`defaults-${refreshKey}`} /> : null}
      {activeTab === 'journals' ? (
        <JournalsTab key={`journals-${refreshKey}`} ref={journalsRef} />
      ) : null}
      {activeTab === 'trial' ? <TrialBalanceTab key={`trial-${refreshKey}`} /> : null}
      {activeTab === 'pl' ? <ProfitLossTab key={`pl-${refreshKey}`} /> : null}
      {activeTab === 'bs' ? <BalanceSheetTab key={`bs-${refreshKey}`} /> : null}
      {activeTab === 'cf' ? <CashFlowTab key={`cf-${refreshKey}`} /> : null}
      {activeTab === 'ledger' ? <LedgerStatementTab key={`ledger-${refreshKey}`} /> : null}
      {activeTab === 'periods' ? <PeriodsTab key={`periods-${refreshKey}`} /> : null}
    </div>
  );
};
