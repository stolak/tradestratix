import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

type DefaultRow = {
  key: string;
  label?: string;
  description?: string;
  mapped_description?: string | null;
  category?: string;
  status?: string;
  account_types?: string[];
  accountTypes?: string[];
  setting_id?: string | null;
  account?: {
    id: string;
    code: string;
    name: string;
    account_type?: string;
    is_active?: boolean;
  } | null;
};

type AccountRow = {
  id: string;
  code: string;
  name: string;
  account_type?: string;
  is_active?: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  sales: 'Sales',
  cash: 'Cash & bank',
  inventory: 'Inventory',
  sales_rep: 'Sales reps',
  assets: 'Fixed assets',
  payroll: 'Payroll',
  expenses: 'Expenses',
  equity: 'Equity',
  custom: 'Custom'
};

const STATUS_LABELS: Record<string, string> = {
  valid: 'Mapped',
  missing: 'Missing',
  inactive: 'Inactive account',
  wrong_type: 'Wrong type',
  invalid: 'Invalid'
};

function expectedTypes(row: DefaultRow): string[] {
  return row.account_types || row.accountTypes || [];
}

function statusTone(status?: string): string {
  if (status === 'valid') return 'invoice-chip--active';
  if (status === 'missing') return 'invoice-chip--draft';
  return 'invoice-chip--void';
}

export const DefaultAccountsPanel: React.FC = () => {
  const { can } = useAuth();
  const canEdit = can('accounting.edit', 'settings.edit');

  const [rows, setRows] = useState<DefaultRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues' | 'mapped'>('all');
  const [q, setQ] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [status, coa] = await Promise.all([
        api.accounting.defaultAccountStatus(),
        api.accounting.accounts()
      ]);
      setRows(status);
      setAccounts(coa);
    } catch (e: any) {
      await alertError('Default accounts', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category || 'custom'));
    return ['all', ...Array.from(set)];
  }, [rows]);

  const summary = useMemo(() => {
    const mapped = rows.filter((r) => r.status === 'valid').length;
    const missing = rows.filter((r) => r.status === 'missing').length;
    const issues = rows.filter((r) => r.status && r.status !== 'valid' && r.status !== 'missing').length;
    return { total: rows.length, mapped, missing, issues };
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== 'all' && (r.category || 'custom') !== category) return false;
      if (statusFilter === 'mapped' && r.status !== 'valid') return false;
      if (statusFilter === 'issues' && r.status === 'valid') return false;
      if (!needle) return true;
      const hay = [r.key, r.label, r.description, r.category, r.account?.code, r.account?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, category, statusFilter, q]);

  const accountsFor = (row: DefaultRow) => {
    const types = expectedTypes(row);
    return accounts.filter((a) => {
      if (a.is_active === false) return false;
      if (!types.length) return true;
      return types.includes(String(a.account_type || ''));
    });
  };

  const save = async (key: string, accountId: string) => {
    if (!canEdit || !accountId) return;
    setSavingKey(key);
    try {
      await api.accounting.upsertDefaultAccount({ setting_key: key, account_id: accountId });
      await alertSuccess('Default account saved');
      await load();
    } catch (e: any) {
      await alertError('Save failed', e.message);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10
        }}
      >
        {[
          { label: 'Catalog keys', value: summary.total },
          { label: 'Mapped', value: summary.mapped },
          { label: 'Missing', value: summary.missing },
          { label: 'Needs attention', value: summary.issues }
        ].map((card) => (
          <div
            key={card.label}
            className="card-surface"
            style={{ padding: '0.85rem 1rem', display: 'grid', gap: 4 }}
          >
            <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>{card.label}</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Default account mappings</h2>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Each posting workflow resolves GL accounts through these keys (
            <code>DefaultAccountSetting</code>). Missing or wrong-type mappings block posting.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            className="swal2-input"
            style={{ width: 220, margin: 0 }}
            placeholder="Search key, label, account…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ minWidth: 150 }}
          >
            <option value="all">All statuses</option>
            <option value="issues">Missing / issues</option>
            <option value="mapped">Mapped only</option>
          </select>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {!canEdit ? (
            <span style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              View only — need <code>accounting.edit</code> or <code>settings.edit</code> to change mappings.
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? 'btn btn-primary' : 'btn btn-ghost'}
              onClick={() => setCategory(c)}
            >
              {c === 'all' ? 'All categories' : CATEGORY_LABELS[c] || c}
            </button>
          ))}
        </div>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>S/N</th>
                <th>Setting</th>
                <th>Category</th>
                <th>Expected type</th>
                <th>Status</th>
                <th>Mapped account</th>
                <th style={{ minWidth: 240 }}>Assign</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                    Loading default account settings…
                  </td>
                </tr>
              ) : null}
              {!loading && !visible.length ? (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                    No mappings match this filter.
                  </td>
                </tr>
              ) : null}
              {visible.map((row, index) => {
                const types = expectedTypes(row);
                const options = accountsFor(row);
                const currentId = row.account?.id || '';
                const currentInOptions = options.some((a) => a.id === currentId);
                return (
                  <tr key={row.key}>
                    <td>{index + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.label || row.key}</div>
                      <div style={{ color: 'var(--ink-muted)', fontSize: '0.78rem' }}>{row.key}</div>
                      {row.description ? (
                        <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem', marginTop: 4 }}>
                          {row.description}
                        </div>
                      ) : null}
                    </td>
                    <td>{CATEGORY_LABELS[row.category || ''] || row.category || '—'}</td>
                    <td>
                      {types.length
                        ? types.map((t) => (
                            <span key={t} className="invoice-chip" style={{ marginRight: 4 }}>
                              {t}
                            </span>
                          ))
                        : '—'}
                    </td>
                    <td>
                      <span className={`invoice-chip ${statusTone(row.status)}`}>
                        {STATUS_LABELS[row.status || ''] || row.status || '—'}
                      </span>
                    </td>
                    <td>
                      {row.account ? (
                        <>
                          <div>
                            {row.account.code} — {row.account.name}
                          </div>
                          <div style={{ color: 'var(--ink-muted)', fontSize: '0.78rem' }}>
                            {row.account.account_type}
                            {row.account.is_active === false ? ' · inactive' : ''}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <select
                        value={currentId}
                        disabled={!canEdit || savingKey === row.key}
                        onChange={(e) => {
                          if (e.target.value) void save(row.key, e.target.value);
                        }}
                        style={{ width: '100%', maxWidth: 280 }}
                      >
                        <option value="">
                          {savingKey === row.key ? 'Saving…' : 'Select account…'}
                        </option>
                        {!currentInOptions && row.account ? (
                          <option value={row.account.id}>
                            {row.account.code} — {row.account.name} (current)
                          </option>
                        ) : null}
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                      {!options.length ? (
                        <div style={{ color: 'var(--danger)', fontSize: '0.78rem', marginTop: 4 }}>
                          No active {types.join(' / ') || 'matching'} accounts in the chart.
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
