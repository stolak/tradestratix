import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'employees' | 'attendance' | 'leave';

export const HrPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<any[]>([]);
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
      const [e, a, l] = await Promise.all([
        api.hr.employees(),
        api.hr.attendance(),
        api.hr.leave()
      ]);
      setEmployees(e);
      setAttendance(a);
      setLeave(l);
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
      await api.hr.createEmployee({
        full_name: empForm.full_name,
        code: empForm.code || undefined,
        department: empForm.department || undefined,
        job_title: empForm.job_title || undefined,
        base_salary: Number(empForm.base_salary || 0),
        phone: empForm.phone || undefined,
        email: empForm.email || undefined,
        hire_date: empForm.hire_date || undefined
      });
      await alertSuccess('Employee created');
      setEmpForm((f) => ({
        ...f,
        full_name: '',
        code: '',
        department: '',
        job_title: '',
        base_salary: '',
        phone: '',
        email: ''
      }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
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
    <div style={{ display: 'grid', gap: '1.25rem' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
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
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Create employee
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Department</th>
                  <th>Title</th>
                  <th>Salary</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((r) => (
                  <tr key={r.id}>
                    <td>{r.full_name}</td>
                    <td>{r.code || '—'}</td>
                    <td>{r.department || '—'}</td>
                    <td>{r.job_title || '—'}</td>
                    <td>{Number(r.base_salary).toLocaleString()}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
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
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Save attendance
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
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
            </div>
            <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
              Submit leave
            </button>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
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
        </>
      ) : null}
    </div>
  );
};
