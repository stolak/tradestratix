import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

const emptyForm = {
  employee_id: '',
  code: '',
  commission_percent: '5'
};

export const SalesRepsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    try {
      const [reps, comm, emps] = await Promise.all([
        api.salesReps.list(undefined, { all: true, withBalances: true }),
        api.salesReps.commissions(),
        api.hr.employees('active')
      ]);
      setRows(reps);
      setCommissions(comm);
      setEmployees(emps.filter((e: any) => !e.sales_rep));
    } catch (e: any) {
      await alertError('Sales reps', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const startEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      employee_id: r.employee_id || r.employee?.id || '',
      code: r.code || '',
      commission_percent: String(Number(r.commission_percent ?? 0))
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.salesReps.update(editingId, {
          code: form.code || null,
          commission_percent: Number(form.commission_percent) || 0
        });
        await alertSuccess('Sales rep updated');
      } else {
        if (!form.employee_id) {
          await alertError('Create failed', 'Select an employee first');
          return;
        }
        await api.salesReps.create({
          employee_id: form.employee_id,
          code: form.code || undefined,
          commission_percent: Number(form.commission_percent) || 0
        });
        await alertSuccess('Employee promoted to sales rep');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  const toggleActive = async (r: any) => {
    const enabling = r.status !== 'active';
    const name = r.name || r.employee?.full_name || r.code || r.id;
    const ok = await confirmAction(
      enabling ? 'Enable sales rep?' : 'Disable sales rep?',
      enabling
        ? `${name} can be assigned to new sales again.`
        : `${name} will be blocked from new sales. Employee record and history stay intact.`
    );
    if (!ok) return;

    setBusyId(r.id);
    try {
      if (enabling) {
        await api.salesReps.activate(r.id);
        await alertSuccess('Sales rep enabled');
      } else {
        await api.salesReps.deactivate(r.id);
        await alertSuccess('Sales rep disabled');
      }
      if (editingId === r.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError(enabling ? 'Enable failed' : 'Disable failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: any) => {
    if (!r.can_delete) return;
    const name = r.name || r.employee?.full_name || r.code || r.id;
    const ok = await confirmAction(
      'Remove sales rep?',
      `${name} has no invoices, commissions, or journals. This only removes the sales-rep profile; the employee remains.`
    );
    if (!ok) return;

    setBusyId(r.id);
    try {
      await api.salesReps.remove(r.id);
      await alertSuccess('Sales rep removed');
      if (editingId === r.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError('Remove failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const visible = rows.filter((r) => {
    if (statusFilter === 'all') return true;
    return statusFilter === 'active' ? r.status === 'active' : r.status !== 'active';
  });

  const editingRow = editingId ? rows.find((r) => r.id === editingId) : null;

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Sales reps
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Promote an existing employee. Walk-in sales are attributed to the logged-in rep and count toward their
          balance. Edit commission, disable anytime; remove only with no activity.
        </p>
      </header>

      <form
        onSubmit={save}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div style={{ fontWeight: 700 }}>{editingId ? 'Edit sales rep' : 'Make sales rep'}</div>
        <div className="form-grid">
          {editingId ? (
            <div className="field">
              <label>Employee</label>
              <input
                value={editingRow?.name || editingRow?.employee?.full_name || '—'}
                disabled
              />
            </div>
          ) : (
            <div className="field">
              <label>Employee</label>
              <select
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                required
              >
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code ? `${emp.code} — ` : ''}
                    {emp.full_name}
                    {emp.branch?.code ? ` (${emp.branch.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Sales rep code (optional)</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="field">
            <label>Commission %</label>
            <input
              type="number"
              min="0"
              step="any"
              value={form.commission_percent}
              onChange={(e) => setForm({ ...form, commission_percent: e.target.value })}
            />
          </div>
          <div className="form-grid--actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Save changes' : 'Make sales rep'}
            </button>
            {editingId ? (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </form>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>Status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Disabled</option>
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>S/N</th>
                <th>Code</th>
                <th>Name</th>
                <th>Home branch</th>
                <th>Operates in</th>
                <th>Commission %</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, index) => {
                const active = r.status === 'active';
                const homeCode = r.branch?.code || r.employee?.branch?.code;
                const balance = Number(r.balance || 0);
                const operating = (r.operating_branches ||
                  r.employee?.user?.user_branches
                    ?.map((ub: any) => ub.branch)
                    .filter(Boolean) ||
                  []) as any[];
                return (
                  <tr key={r.id}>
                    <td>{index + 1}</td>
                    <td>{r.code || r.employee?.code || '—'}</td>
                    <td>{r.name || r.employee?.full_name}</td>
                    <td>{homeCode || '—'}</td>
                    <td>
                      {operating.length ? (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {operating.map((b: any) => {
                            const isHome = homeCode && b.code === homeCode;
                            return (
                              <span
                                key={b.id || b.code}
                                title={b.name || b.code}
                                style={{
                                  display: 'inline-block',
                                  fontSize: '0.75rem',
                                  fontWeight: isHome ? 700 : 500,
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: 4,
                                  background: isHome
                                    ? 'color-mix(in srgb, var(--brand, #0f5c4c) 14%, transparent)'
                                    : 'color-mix(in srgb, var(--ink-muted, #6b7280) 10%, transparent)',
                                  color: isHome
                                    ? 'var(--brand, #0f5c4c)'
                                    : 'var(--ink, #1f2937)',
                                  border: `1px solid ${
                                    isHome
                                      ? 'color-mix(in srgb, var(--brand, #0f5c4c) 35%, transparent)'
                                      : 'color-mix(in srgb, var(--ink-muted, #6b7280) 28%, transparent)'
                                  }`
                                }}
                              >
                                {b.code || b.name}
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{Number(r.commission_percent)}%</td>
                    <td
                      className="num"
                      style={
                        Math.abs(balance) > 0.005
                          ? { fontWeight: 600, color: balance > 0 ? 'var(--danger, #b42318)' : 'var(--ok, #027a48)' }
                          : undefined
                      }
                    >
                      {balance.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                          padding: '0.2rem 0.55rem',
                          borderRadius: 4,
                          background: active
                            ? 'color-mix(in srgb, var(--brand, #0f5c4c) 14%, transparent)'
                            : 'color-mix(in srgb, var(--ink-muted, #6b7280) 16%, transparent)',
                          color: active ? 'var(--brand, #0f5c4c)' : 'var(--ink-muted, #6b7280)',
                          border: `1px solid ${
                            active
                              ? 'color-mix(in srgb, var(--brand, #0f5c4c) 35%, transparent)'
                              : 'color-mix(in srgb, var(--ink-muted, #6b7280) 35%, transparent)'
                          }`
                        }}
                      >
                        {active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === r.id}
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === r.id}
                        onClick={() => void toggleActive(r)}
                      >
                        {active ? 'Disable' : 'Enable'}
                      </button>
                      {r.can_delete ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busyId === r.id}
                          onClick={() => void remove(r)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--ink-muted)' }}>
                    No sales reps match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card-surface" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Accrued commissions</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Invoice</th>
                <th>Base</th>
                <th>%</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id}>
                  <td>{c.sales_rep?.name || c.sales_rep?.employee?.full_name}</td>
                  <td>{c.invoice?.invoice_number}</td>
                  <td>{Number(c.base_amount).toLocaleString()}</td>
                  <td>{Number(c.commission_percent)}%</td>
                  <td>{Number(c.commission_amount).toLocaleString()}</td>
                  <td>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
