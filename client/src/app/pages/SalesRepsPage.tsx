import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const SalesRepsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState({
    employee_id: '',
    code: '',
    commission_percent: '5'
  });

  const load = async () => {
    try {
      const [reps, comm, emps] = await Promise.all([
        api.salesReps.list(),
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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employee_id) {
      await alertError('Create failed', 'Select an employee first');
      return;
    }
    try {
      await api.salesReps.create({
        employee_id: form.employee_id,
        code: form.code || undefined,
        commission_percent: Number(form.commission_percent) || 0
      });
      await alertSuccess('Employee promoted to sales rep');
      setForm({ employee_id: '', code: '', commission_percent: '5' });
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Sales reps
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Promote an existing employee. Identity comes from HR; commission lives here.
        </p>
      </header>

      <form
        onSubmit={create}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div className="form-grid">
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
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              Make sales rep
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
                <th>Home branch</th>
                <th>Login</th>
                <th>Commission %</th>
                <th>Invoices</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.code || r.employee?.code || '—'}</td>
                  <td>{r.name || r.employee?.full_name}</td>
                  <td>{r.branch?.code || r.employee?.branch?.code || '—'}</td>
                  <td>{r.employee?.user?.username || '—'}</td>
                  <td>{Number(r.commission_percent)}%</td>
                  <td>{r._count?.invoices ?? 0}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
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
