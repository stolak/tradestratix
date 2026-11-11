import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const SalesRepsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState({
    employee_id: '',
    name: '',
    code: '',
    phone: '',
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

  const onEmployeePick = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    setForm((prev) => ({
      ...prev,
      employee_id: employeeId,
      name: emp?.full_name || prev.name,
      code: emp?.code || prev.code,
      phone: emp?.phone || prev.phone
    }));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.salesReps.create({
        employee_id: form.employee_id || undefined,
        name: form.name || undefined,
        code: form.code || undefined,
        phone: form.phone || undefined,
        commission_percent: Number(form.commission_percent) || 0
      });
      await alertSuccess(
        form.employee_id
          ? 'Sales rep linked to employee'
          : 'Sales rep created (employee record created automatically)'
      );
      setForm({ employee_id: '', name: '', code: '', phone: '', commission_percent: '5' });
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
          Every sales rep is also an employee. Link an existing HR employee or create both together.
        </p>
      </header>

      <form
        onSubmit={create}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div className="form-grid">
          <div className="field">
            <label>Existing employee (optional)</label>
            <select
              value={form.employee_id}
              onChange={(e) => onEmployeePick(e.target.value)}
            >
              <option value="">Create new employee from details below</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.code ? `${emp.code} — ` : ''}
                  {emp.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required={!form.employee_id}
            />
          </div>
          <div className="field">
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
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
              Add sales rep
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
                <th>Employee</th>
                <th>Commission %</th>
                <th>Invoices</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.code || '—'}</td>
                  <td>{r.name}</td>
                  <td>
                    {r.employee
                      ? `${r.employee.code || r.employee.id} — ${r.employee.full_name}`
                      : '—'}
                  </td>
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
                  <td>{c.sales_rep?.name}</td>
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
