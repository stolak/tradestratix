import React, { useEffect, useRef, useState } from 'react';
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

type Tab = 'coa' | 'defaults' | 'journals' | 'trial' | 'pl' | 'bs' | 'cf' | 'ledger' | 'periods';

const TABS: { id: Tab; label: string }[] = [
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

export const AccountingPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('coa');
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingCoaCreate, setPendingCoaCreate] = useState(false);
  const [pendingJournalCreate, setPendingJournalCreate] = useState(false);
  const coaRef = useRef<CoaTabHandle>(null);
  const journalsRef = useRef<JournalsTabHandle>(null);

  useEffect(() => {
    if (tab !== 'coa' || !pendingCoaCreate) return;
    coaRef.current?.openCreate(null);
    setPendingCoaCreate(false);
  }, [tab, pendingCoaCreate, refreshKey]);

  useEffect(() => {
    if (tab !== 'journals' || !pendingJournalCreate) return;
    journalsRef.current?.openCreate();
    setPendingJournalCreate(false);
  }, [tab, pendingJournalCreate, refreshKey]);

  const refreshActive = () => {
    if (tab === 'coa') {
      void coaRef.current?.refresh();
      return;
    }
    if (tab === 'journals') {
      void journalsRef.current?.refresh();
      return;
    }
    setRefreshKey((k) => k + 1);
  };

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
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={refreshActive}>
          Refresh
        </button>
      </div>

      {tab === 'coa' ? <CoaTab key={`coa-${refreshKey}`} ref={coaRef} /> : null}
      {tab === 'defaults' ? <DefaultAccountsPanel key={`defaults-${refreshKey}`} /> : null}
      {tab === 'journals' ? <JournalsTab key={`journals-${refreshKey}`} ref={journalsRef} /> : null}
      {tab === 'trial' ? <TrialBalanceTab key={`trial-${refreshKey}`} /> : null}
      {tab === 'pl' ? <ProfitLossTab key={`pl-${refreshKey}`} /> : null}
      {tab === 'bs' ? <BalanceSheetTab key={`bs-${refreshKey}`} /> : null}
      {tab === 'cf' ? <CashFlowTab key={`cf-${refreshKey}`} /> : null}
      {tab === 'ledger' ? <LedgerStatementTab key={`ledger-${refreshKey}`} /> : null}
      {tab === 'periods' ? <PeriodsTab key={`periods-${refreshKey}`} /> : null}
    </div>
  );
};
