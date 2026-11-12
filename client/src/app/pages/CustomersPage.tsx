import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { CustomerBalances } from '../components/CustomerBalances';

const emptyForm = {
  name: '',
  code: '',
  contact_person: '',
  phone: '',
  email: '',
  city: '',
  customer_type: 'retail',
  payment_terms_days: '0',
  credit_limit: '',
  discount_percent: '',
  notes: ''
};

type StatusFilter = 'all' | 'active' | 'inactive';
type Tab = 'directory' | 'balances';

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function transactionCount(c: any) {
  const k = c._count || {};
  return (k.invoices || 0) + (k.payments || 0) + (k.deliveries || 0) + (k.journal_entries || 0);
}

export const CustomersPage: React.FC = () => {
  const { can } = useAuth();
  const canCredit = can('customers.credit');
  const canEdit = can('customers.edit');
  const canDelete = can('customers.delete');
  const tabs = useMemo(
    () =>
      [
        can('customers.view') ? { id: 'directory' as const, label: 'Customers' } : null,
        can('customers.balances') ? { id: 'balances' as const, label: 'Balances & purchases' } : null
      ].filter(Boolean) as { id: Tab; label: string }[],
    [can]
  );
  const [tab, setTab] = useState<Tab>(() => (can('customers.view') ? 'directory' : 'balances'));
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;

  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await api.customers.list(q || undefined));
    } catch (e: any) {
      await alertError('Customers', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((c) => (c.status || 'active') === statusFilter)),
    [rows, statusFilter]
  );
  const activeCount = rows.filter((c) => (c.status || 'active') === 'active').length;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: form.name,
      code: form.code || undefined,
      contact_person: form.contact_person || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      city: form.city || undefined,
      customer_type: form.customer_type,
      payment_terms_days: Number(form.payment_terms_days) || 0,
      notes: form.notes || undefined
    };
    if (canCredit) {
      payload.credit_limit = form.credit_limit.trim() === '' ? null : Number(form.credit_limit);
      payload.discount_percent =
        form.discount_percent.trim() === '' ? null : Number(form.discount_percent);
    }
    try {
      if (editingId) {
        await api.customers.update(editingId, payload);
        await alertSuccess('Customer updated');
      } else {
        await api.customers.create(payload);
        await alertSuccess('Customer created');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  const startEdit = (c: any) => {
    setEditingId(c.id);
    setForm({
      name: c.name || '',
      code: c.code || '',
      contact_person: c.contact_person || '',
      phone: c.phone || '',
      email: c.email || '',
      city: c.city || '',
      customer_type: c.customer_type || 'retail',
      payment_terms_days: String(c.payment_terms_days ?? 0),
      credit_limit: c.credit_limit != null ? String(Number(c.credit_limit)) : '',
      discount_percent: c.discount_percent != null ? String(Number(c.discount_percent)) : '',
      notes: c.notes || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (c: any) => {
    const active = (c.status || 'active') === 'active';
    if (active) {
      const ok = await confirmAction(
        `Disable ${c.name}?`,
        'Disabled customers cannot be selected for new sales or have drafts posted. History is kept.'
      );
      if (!ok) return;
    }
    setBusyId(c.id);
    try {
      if (active) await api.customers.deactivate(c.id);
      else await api.customers.activate(c.id);
      await load();
    } catch (err: any) {
      await alertError(active ? 'Disable failed' : 'Enable failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (c: any) => {
    const ok = await confirmAction(`Delete ${c.name}?`, 'This permanently removes the customer.');
    if (!ok) return;
    setBusyId(c.id);
    try {
      await api.customers.remove(c.id);
      if (editingId === c.id) resetForm();
      await alertSuccess('Customer deleted');
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Customers
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            Customers are shared across branches. Walk-in is a system account (hidden here) — only
            sales representatives can sell to it from Sales / POS.
          </p>
        </div>
        {activeTab === 'directory' ? (
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'end' }}
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <div className="field">
            <label>Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / code / phone" />
          </div>
          <div className="field">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All ({rows.length})</option>
              <option value="active">Active ({activeCount})</option>
              <option value="inactive">Disabled ({rows.length - activeCount})</option>
            </select>
          </div>
          <button type="submit" className="btn btn-ghost">
            Search
          </button>
        </form>
        ) : null}
      </header>

      {tabs.length > 1 ? (
        <div className="page-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`page-tabs__tab${activeTab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === 'balances' ? <CustomerBalances /> : null}

      {activeTab === 'directory' ? (
      <>
      <form
        onSubmit={save}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{editingId ? 'Editing customer' : 'New customer'}</strong>
          {editingId ? (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={form.customer_type}
              onChange={(e) => setForm({ ...form, customer_type: e.target.value })}
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="distributor">Distributor</option>
            </select>
          </div>
          <div className="field">
            <label>Payment terms (days)</label>
            <input
              type="number"
              min="0"
              value={form.payment_terms_days}
              onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label-with-info">
              Credit limit
              <span
                className="info-tip"
                title="Leave blank for unlimited credit. Set 0 for cash-only. Posting an unpaid invoice that takes the outstanding balance above the limit is blocked."
              >
                <Info size={14} />
              </span>
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
              placeholder="Unlimited"
              disabled={!canCredit}
              title={canCredit ? undefined : 'Requires the "customers.credit" privilege'}
            />
          </div>
          <div className="field">
            <label className="field-label-with-info">
              Discount %
              <span
                className="info-tip"
                title="Applied to the whole invoice on every purchase by this customer, after any branch product discount."
              >
                <Info size={14} />
              </span>
            </label>
            <input
              type="number"
              min="0"
              max="99.99"
              step="any"
              value={form.discount_percent}
              onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
              placeholder="None"
              disabled={!canCredit}
              title={canCredit ? undefined : 'Requires the "customers.credit" privilege'}
            />
          </div>
          <div className="field">
            <label>Contact</label>
            <input
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>City</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Save changes' : 'Add customer'}
            </button>
          </div>
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Phone</th>
                <th>Terms</th>
                <th>Discount</th>
                <th>Credit</th>
                <th>Invoices</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const active = (c.status || 'active') === 'active';
                const limit = c.credit_limit != null ? Number(c.credit_limit) : null;
                const outstanding = Number(c.outstanding_balance || 0);
                const usedPct = limit && limit > 0 ? Math.min(100, (outstanding / limit) * 100) : 0;
                const overLimit = limit != null && outstanding > limit;
                const deletable = transactionCount(c) === 0;
                return (
                  <tr key={c.id} className={active ? undefined : 'customers__row--inactive'}>
                    <td>{c.code || '—'}</td>
                    <td>{c.name}</td>
                    <td>{c.customer_type}</td>
                    <td>{c.phone || '—'}</td>
                    <td>{c.payment_terms_days}d</td>
                    <td>
                      {c.discount_percent ? (
                        <span className="branch-pricing__badge branch-pricing__badge--discount">
                          −{Number(c.discount_percent)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {limit == null ? (
                        <div className="customers__credit">
                          <span className="customers__credit-main">Unlimited</span>
                          {outstanding > 0 ? (
                            <span className="customers__credit-sub">Owing {money(outstanding)}</span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="customers__credit" title={`Limit ${money(limit)}`}>
                          <span
                            className={`customers__credit-main${overLimit ? ' customers__credit-main--over' : ''}`}
                          >
                            {money(Math.max(0, limit - outstanding))} available
                          </span>
                          <span className="customers__credit-sub">
                            {money(outstanding)} of {money(limit)}
                          </span>
                          {limit > 0 ? (
                            <span className="customers__credit-bar">
                              <span
                                style={{ width: `${usedPct}%` }}
                                className={usedPct >= 90 ? 'is-high' : undefined}
                              />
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>{c._count?.invoices ?? 0}</td>
                    <td>
                      <span className={`invoice-chip invoice-chip--${active ? 'active' : 'inactive'}`}>
                        {active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busyId === c.id}
                            onClick={() => startEdit(c)}
                          >
                            Edit
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busyId === c.id}
                            onClick={() => void toggleActive(c)}
                          >
                            {active ? 'Disable' : 'Enable'}
                          </button>
                        </>
                      ) : null}
                      {canDelete && deletable ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="btn btn-ghost customers__delete"
                            disabled={busyId === c.id}
                            onClick={() => void remove(c)}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={10} style={{ color: 'var(--ink-muted)' }}>
                    No customers match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      </>
      ) : null}
    </div>
  );
};
