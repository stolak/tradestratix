export type AccountingTabId =
  | 'coa'
  | 'defaults'
  | 'journals'
  | 'trial'
  | 'pl'
  | 'bs'
  | 'cf'
  | 'ledger'
  | 'periods';

/** Permission required to show each Accounting tab (menu still needs accounting.view). */
export const ACCOUNTING_TAB_PERMISSIONS: Record<AccountingTabId, string> = {
  coa: 'accounting.coa',
  defaults: 'accounting.defaults',
  journals: 'accounting.journals',
  trial: 'accounting.trial',
  pl: 'accounting.pl',
  bs: 'accounting.bs',
  cf: 'accounting.cf',
  ledger: 'accounting.ledger',
  periods: 'accounting.periods'
};

export const ACCOUNTING_TABS: { id: AccountingTabId; label: string; perm: string }[] = [
  { id: 'coa', label: 'Chart of accounts', perm: ACCOUNTING_TAB_PERMISSIONS.coa },
  { id: 'defaults', label: 'Default accounts', perm: ACCOUNTING_TAB_PERMISSIONS.defaults },
  { id: 'journals', label: 'Journals', perm: ACCOUNTING_TAB_PERMISSIONS.journals },
  { id: 'trial', label: 'Trial balance', perm: ACCOUNTING_TAB_PERMISSIONS.trial },
  { id: 'pl', label: 'Profit & loss', perm: ACCOUNTING_TAB_PERMISSIONS.pl },
  { id: 'bs', label: 'Balance sheet', perm: ACCOUNTING_TAB_PERMISSIONS.bs },
  { id: 'cf', label: 'Cash flow', perm: ACCOUNTING_TAB_PERMISSIONS.cf },
  { id: 'ledger', label: 'Ledger statement', perm: ACCOUNTING_TAB_PERMISSIONS.ledger },
  { id: 'periods', label: 'Periods', perm: ACCOUNTING_TAB_PERMISSIONS.periods }
];
