import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { api } from '../../utils/api';
import { alertError, alertSuccess, confirmAction } from '../../utils/alerts';
import { SearchSelect } from '../SearchSelect';
import { AccountingModalShell } from './AccountingModalShell';
import { ACCOUNT_TYPES, flattenAccountTree, toggleIdInSet } from './shared';

export type CoaTabHandle = {
  openCreate: (parent?: any | null) => void;
  refresh: () => Promise<void>;
};

export const CoaTab = forwardRef<CoaTabHandle>(function CoaTab(_props, ref) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
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
  const visibleAccountRows = useMemo(() => {
    return accountTreeRows.filter((a) => {
      let parentId: string | null = a.parent_id || null;
      while (parentId) {
        if (!expandedIds.has(parentId)) return false;
        parentId = accountsById.get(parentId)?.parent_id || null;
      }
      return true;
    });
  }, [accountTreeRows, expandedIds, accountsById]);
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

  const toggleExpand = (accountId: string) => {
    setExpandedIds((prev) => toggleIdInSet(prev, accountId));
  };

  const load = async () => {
    try {
      setAccounts(await api.accounting.accounts());
    } catch (e: any) {
      await alertError('Chart of accounts', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreateAccount = (parent?: any | null) => {
    if (parent?.id) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(parent.id);
        return next;
      });
    }
    setAccountForm({
      code: '',
      name: '',
      account_type: parent?.account_type || 'asset',
      parent_id: parent?.id || '',
      description: ''
    });
    setShowAccountModal(true);
  };

  useImperativeHandle(ref, () => ({
    openCreate: openCreateAccount,
    refresh: load
  }));

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

  return (
    <>
      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div
          style={{
            padding: '0.75rem 1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Chart of accounts is a tree: top-level accounts have no parent; children nest under a
            parent (same type). Expand a parent to view its children.
          </div>
          {accountTreeRows.some((a) => a.childCount > 0) ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setExpandedIds(
                    new Set(accountTreeRows.filter((a) => a.childCount > 0).map((a) => a.id))
                  )
                }
              >
                Expand all
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setExpandedIds(new Set())}
              >
                Collapse all
              </button>
            </div>
          ) : null}
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
                visibleAccountRows.map((a) => {
                  const parent = a.parent_id ? accountsById.get(a.parent_id) : null;
                  const isExpanded = expandedIds.has(a.id);
                  return (
                    <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.65 }}>
                      <td>
                        <div
                          style={{
                            paddingLeft: a.depth * 18,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 4
                          }}
                        >
                          {a.childCount > 0 ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => toggleExpand(a.id)}
                              aria-label={isExpanded ? 'Collapse children' : 'Expand children'}
                              title={isExpanded ? 'Collapse children' : 'Expand children'}
                              style={{
                                padding: '0.15rem',
                                marginTop: 1,
                                flexShrink: 0
                              }}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : (
                            <span style={{ width: 26, display: 'inline-block', flexShrink: 0 }} />
                          )}
                          <div>
                            <div style={{ fontWeight: a.childCount > 0 ? 700 : 600 }}>
                              <span
                                style={{ fontFamily: 'ui-monospace, monospace', marginRight: 8 }}
                              >
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
                                  {!isExpanded ? ' · collapsed' : ''}
                                </span>
                              ) : null}
                            </div>
                            {a.description ? (
                              <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                                {a.description}
                              </div>
                            ) : null}
                          </div>
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

      {showAccountModal ? (
        <AccountingModalShell
          title={
            accountForm.parent_id
              ? `New child under ${accountsById.get(accountForm.parent_id)?.code || 'parent'}`
              : 'New ledger account'
          }
          onClose={() => setShowAccountModal(false)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowAccountModal(false)}
              >
                Cancel
              </button>
              <button type="submit" form="create-account-form" className="btn btn-primary">
                Create account
              </button>
            </>
          }
        >
          <form
            id="create-account-form"
            onSubmit={handleCreateAccount}
            style={{ display: 'grid', gap: 12 }}
          >
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
          </form>
        </AccountingModalShell>
      ) : null}
    </>
  );
});
