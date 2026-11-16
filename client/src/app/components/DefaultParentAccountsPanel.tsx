import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

type ParentRow = {
  key: string;
  label?: string;
  description?: string;
  mapped_description?: string | null;
  category?: string;
  status?: string;
  account_types?: string[];
  accountTypes?: string[];
  setting_id?: string | null;
  parent_account?: {
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
  parent_id?: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  sales: 'Sales',
  cash: 'Cash & bank',
  inventory: 'Inventory',
  assets: 'Fixed assets',
  payroll: 'Payroll',
  expenses: 'Expenses',
  equity: 'Equity',
  journals: 'Journals',
  custom: 'Custom'
};

const STATUS_LABELS: Record<string, string> = {
  valid: 'Mapped',
  missing: 'Missing',
  inactive: 'Inactive account',
  wrong_type: 'Wrong type',
  invalid: 'Invalid'
};

function expectedTypes(row: ParentRow): string[] {
  return row.account_types || row.accountTypes || [];
}

function statusTone(status?: string): string {
  if (status === 'valid') return 'invoice-chip--active';
  if (status === 'missing') return 'invoice-chip--draft';
  return 'invoice-chip--void';
}

export const DefaultParentAccountsPanel: React.FC = () => {
  const { can } = useAuth();
  const canEdit = can('accounting.edit', 'settings.edit');

  const [rows, setRows] = useState<ParentRow[]>([]);
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
        api.accounting.defaultParentAccountStatus(),
        api.accounting.accounts({ include_inactive: true, postable_only: false })
      ]);
      setRows(status);
      setAccounts(coa);
    } catch (e: any) {
      await alertError('Ledger filters', e.message);
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
      const hay = [
        r.key,
        r.label,
        r.description,
        r.category,
        r.parent_account?.code,
        r.parent_account?.name
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, category, statusFilter, q]);

  const parentsFor = (row: ParentRow) => {
    const types = expectedTypes(row);
    return accounts.filter((a) => {
      if (a.is_active === false) return false;
      if (!types.length) return true;
      return types.includes(String(a.account_type || ''));
    });
  };

  const save = async (key: string, parentAccountId: string) => {
    if (!canEdit || !parentAccountId) return;
    setSavingKey(key);
    try {
      await api.accounting.upsertDefaultParentAccount({
        setting_key: key,
        parent_account_id: parentAccountId
      });
      await alertSuccess('Ledger filter saved');
      await load();
    } catch (e: any) {
      await alertError('Save failed', e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const clear = async (key: string) => {
    if (!canEdit) return;
    setSavingKey(key);
    try {
      await api.accounting.clearDefaultParentAccount(key);
      await alertSuccess('Ledger filter cleared');
      await load();
    } catch (e: any) {
      await alertError('Clear failed', e.message);
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
          { label: 'Filter keys', value: summary.total },
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
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Ledger filter parents</h2>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Map each operation to a chart-of-accounts parent. Pickers then load only ledgers under
            that parent (via <code>parent_setting_key</code>) instead of the full chart.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            className="swal2-input"
            style={{ width: 220, margin: 0 }}
            placeholder="Search key, label, parent…"
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
              View only — need <code>accounting.edit</code> or <code>settings.edit</code> to change
              filters.
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

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Parent account</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const options = parentsFor(row);
                const currentId = row.parent_account?.id || '';
                const busy = savingKey === row.key;
                return (
                  <tr key={row.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.label || row.key}</div>
                      <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                        <code>{row.key}</code>
                      </div>
                    </td>
                    <td style={{ maxWidth: 280, fontSize: '0.88rem', color: 'var(--ink-muted)' }}>
                      {row.description || '—'}
                      {expectedTypes(row).length ? (
                        <div style={{ marginTop: 4, fontSize: '0.75rem' }}>
                          Types: {expectedTypes(row).join(', ')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`invoice-chip ${statusTone(row.status)}`}>
                        {STATUS_LABELS[row.status || ''] || row.status || '—'}
                      </span>
                    </td>
                    <td>
                      <select
                        value={currentId}
                        disabled={!canEdit || busy}
                        onChange={(e) => void save(row.key, e.target.value)}
                        style={{ minWidth: 220, maxWidth: 320 }}
                      >
                        <option value="">Select parent…</option>
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {currentId && canEdit ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void clear(row.key)}
                        >
                          Clear
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>
                    {loading ? 'Loading…' : 'No ledger filters match.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
