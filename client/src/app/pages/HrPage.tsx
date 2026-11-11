import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'employees' | 'attendance' | 'leave';

export const HrPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leave, setLeave] = useState<any[]>([]);
  const [empForm, setEmpForm] = useState({
    full_name: '',
    code: '',
    department: '',
    job_title: '',
    base_salary: '',
    phone: '',
    email: '',
    branch_id: '',
    username: '',
    password: '',
    is_sales_rep: false,
    commission_percent: '5',
    hire_date: new Date().toISOString().slice(0, 10)
  });
  const [attForm, setAttForm] = useState({
    employee_id: '',
    work_date: new Date().toISOString().slice(0, 10),
    status: 'present',
    notes: ''
  });
  const [leaveForm, setLeaveForm] = useState({
    employee_id: '',
    leave_type: 'annual',
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: new Date().toISOString().slice(0, 10),
    reason: ''
  });

  const load = async () => {
    try {
      const [e, a, l, b] = await Promise.all([
        api.hr.employees(),
        api.hr.attendance(),
        api.hr.leave(),
        api.branches.list()
      ]);
      setEmployees(e);
      setAttendance(a);
      setLeave(l);
      setBranches(b);
      setAttForm((f) => ({ ...f, employee_id: f.employee_id || e[0]?.id || '' }));
      setLeaveForm((f) => ({ ...f, employee_id: f.employee_id || e[0]?.id || '' }));
    } catch (err: any) {
      await alertError('HR', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.hr.createEmployee({
        full_name: empForm.full_name,
        code: empForm.code || undefined,
        department: empForm.department || undefined,
        job_title: empForm.job_title || undefined,
        base_salary: Number(empForm.base_salary || 0),
        phone: empForm.phone || undefined,
        email: empForm.email || undefined,
        hire_date: empForm.hire_date || undefined,
        branch_id: empForm.branch_id || undefined,
        username: empForm.username || undefined,
        password: empForm.password || undefined,
        is_sales_rep: empForm.is_sales_rep,
        commission_percent: empForm.is_sales_rep
          ? Number(empForm.commission_percent || 0)
          : undefined
      });
      const loginHint = created.login_username
        ? ` Login: ${created.login_username}${
            created.temporary_password ? ` / ${created.temporary_password}` : ''
          }`
        : '';
      await alertSuccess(`Employee created.${loginHint}`);
      setEmpForm((f) => ({
        ...f,
        full_name: '',
        code: '',
        department: '',
        job_title: '',
        base_salary: '',
        phone: '',
        email: '',
        username: '',
        password: '',
        is_sales_rep: false,
        commission_percent: '5'
      }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const makeSalesRep = async (employeeId: string) => {
    try {
      await api.salesReps.create({ employee_id: employeeId, commission_percent: 5 });
      await alertSuccess('Employee promoted to sales rep');
      await load();
    } catch (err: any) {
      await alertError('Promote failed', err.message);
    }
  };

  const upsertAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.hr.upsertAttendance({
        employee_id: attForm.employee_id,
        work_date: attForm.work_date,
        status: attForm.status,
        notes: attForm.notes || undefined
      });
      await alertSuccess('Attendance saved');
      setAttForm((f) => ({ ...f, notes: '' }));
      await load();
      setTab('attendance');
    } catch (err: any) {
      await alertError('Attendance failed', err.message);
    }
  };

  const createLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.hr.createLeave({
        employee_id: leaveForm.employee_id,
        leave_type: leaveForm.leave_type,
        starts_on: leaveForm.starts_on,
        ends_on: leaveForm.ends_on,
        reason: leaveForm.reason || undefined
      });
      await alertSuccess('Leave request created');
      setLeaveForm((f) => ({ ...f, reason: '' }));
      await load();
      setTab('leave');
    } catch (err: any) {
      await alertError('Leave failed', err.message);
    }
  };

  const decideLeave = async (id: string, approve: boolean) => {
    try {
      await api.hr.approveLeave(id, approve);
      await alertSuccess(approve ? 'Leave approved' : 'Leave rejected');
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Human resources
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Employees, daily attendance, and leave requests.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['employees', 'Employees'],
            ['attendance', 'Attendance'],
            ['leave', 'Leave']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'employees' ? (
        <>
          <form
            onSubmit={createEmployee}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add employee</div>
            <div className="form-grid">
              <div className="field">
                <label>Full name</label>
                <input
                  value={empForm.full_name}
                  onChange={(e) => setEmpForm({ ...empForm, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Code</label>
                <input
                  value={empForm.code}
                  onChange={(e) => setEmpForm({ ...empForm, code: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Department</label>
                <input
                  value={empForm.department}
                  onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Job title</label>
                <input
                  value={empForm.job_title}
                  onChange={(e) => setEmpForm({ ...empForm, job_title: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Base salary</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={empForm.base_salary}
                  onChange={(e) => setEmpForm({ ...empForm, base_salary: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Hire date</label>
                <input
                  type="date"
                  value={empForm.hire_date}
                  onChange={(e) => setEmpForm({ ...empForm, hire_date: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Phone</label>
                <input
                  value={empForm.phone}
                  onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={empForm.email}
                  onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Home branch</label>
                <select
                  value={empForm.branch_id}
                  onChange={(e) => setEmpForm({ ...empForm, branch_id: e.target.value })}
                >
                  <option value="">HQ (default)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Login username</label>
                <input
                  value={empForm.username}
                  onChange={(e) => setEmpForm({ ...empForm, username: e.target.value })}
                  placeholder="Auto from name if blank"
                />
              </div>
              <div className="field">
                <label>Login password</label>
                <input
                  type="text"
                  value={empForm.password}
                  onChange={(e) => setEmpForm({ ...empForm, password: e.target.value })}
                  placeholder="Temporary password if blank"
                />
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={empForm.is_sales_rep}
                    onChange={(e) => setEmpForm({ ...empForm, is_sales_rep: e.target.checked })}
                  />{' '}
                  Also make sales rep
                </label>
              </div>
              {empForm.is_sales_rep ? (
                <div className="field">
                  <label>Commission %</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={empForm.commission_percent}
                    onChange={(e) =>
                      setEmpForm({ ...empForm, commission_percent: e.target.value })
                    }
                  />
                </div>
              ) : null}
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create employee
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Branch</th>
                  <th>Login</th>
                  <th>Title</th>
                  <th>Sales rep</th>
                  <th>Salary</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {employees.map((r) => (
                  <tr key={r.id}>
                    <td>{r.full_name}</td>
                    <td>{r.code || '—'}</td>
                    <td>{r.branch?.code || '—'}</td>
                    <td>{r.user?.username || '—'}</td>
                    <td>{r.job_title || '—'}</td>
                    <td>{r.sales_rep ? r.sales_rep.code || 'Yes' : '—'}</td>
                    <td>{Number(r.base_salary).toLocaleString()}</td>
                    <td>{r.status}</td>
                    <td>
                      {!r.sales_rep ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void makeSalesRep(r.id)}
                        >
                          Make sales rep
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'attendance' ? (
        <>
          <form
            onSubmit={upsertAttendance}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Record attendance</div>
            <div className="form-grid">
              <div className="field">
                <label>Employee</label>
                <select
                  value={attForm.employee_id}
                  onChange={(e) => setAttForm({ ...attForm, employee_id: e.target.value })}
                  required
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={attForm.work_date}
                  onChange={(e) => setAttForm({ ...attForm, work_date: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Status</label>
                <select
                  value={attForm.status}
                  onChange={(e) => setAttForm({ ...attForm, status: e.target.value })}
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                  <option value="half_day">Half day</option>
                </select>
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={attForm.notes}
                  onChange={(e) => setAttForm({ ...attForm, notes: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Save attendance
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((r) => (
                  <tr key={r.id}>
                    <td>{String(r.work_date).slice(0, 10)}</td>
                    <td>{r.employee?.full_name || '—'}</td>
                    <td>{r.status}</td>
                    <td>{r.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'leave' ? (
        <>
          <form
            onSubmit={createLeave}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Request leave</div>
            <div className="form-grid">
              <div className="field">
                <label>Employee</label>
                <select
                  value={leaveForm.employee_id}
                  onChange={(e) => setLeaveForm({ ...leaveForm, employee_id: e.target.value })}
                  required
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Type</label>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                >
                  <option value="annual">Annual</option>
                  <option value="sick">Sick</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label>Starts</label>
                <input
                  type="date"
                  value={leaveForm.starts_on}
                  onChange={(e) => setLeaveForm({ ...leaveForm, starts_on: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Ends</label>
                <input
                  type="date"
                  value={leaveForm.ends_on}
                  onChange={(e) => setLeaveForm({ ...leaveForm, ends_on: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Reason</label>
                <input
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Submit leave
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leave.map((r) => (
                  <tr key={r.id}>
                    <td>{r.employee?.full_name || '—'}</td>
                    <td>{r.leave_type}</td>
                    <td>{String(r.starts_on).slice(0, 10)}</td>
                    <td>{String(r.ends_on).slice(0, 10)}</td>
                    <td>{Number(r.days)}</td>
                    <td>{r.status}</td>
                    <td>
                      {r.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void decideLeave(r.id, true)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void decideLeave(r.id, false)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
