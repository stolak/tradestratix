import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'employees' | 'attendance' | 'leave';

type EmpForm = {
  full_name: string;
  staff_number: string;
  department_id: string;
  job_title: string;
  base_salary: string;
  phone: string;
  email: string;
  branch_id: string;
  is_sales_rep: boolean;
  commission_percent: string;
  include_sales_commission: boolean;
  employment_type: string;
  hire_date: string;
  pay_grade_id: string;
  pay_step: string;
  status: string;
};

const emptyEmpForm = (): EmpForm => ({
  full_name: '',
  staff_number: '',
  department_id: '',
  job_title: '',
  base_salary: '',
  phone: '',
  email: '',
  branch_id: '',
  is_sales_rep: false,
  commission_percent: '5',
  include_sales_commission: true,
  employment_type: 'permanent',
  hire_date: new Date().toISOString().slice(0, 10),
  pay_grade_id: '',
  pay_step: '',
  status: 'active'
});

function employeeToForm(r: any): EmpForm {
  return {
    full_name: r.full_name || '',
    staff_number: r.code || r.staff_number || '',
    department_id: r.department_id || r.department_ref?.id || '',
    job_title: r.job_title || '',
    base_salary: r.base_salary != null ? String(r.base_salary) : '',
    phone: r.phone || '',
    email: r.email || '',
    branch_id: r.branch_id || r.branch?.id || '',
    is_sales_rep: Boolean(r.sales_rep),
    commission_percent:
      r.sales_rep?.commission_percent != null ? String(r.sales_rep.commission_percent) : '5',
    include_sales_commission: r.include_sales_commission !== false,
    employment_type: r.employment_type || 'permanent',
    hire_date: r.hire_date ? String(r.hire_date).slice(0, 10) : '',
    pay_grade_id: r.pay_grade_id || r.pay_grade?.id || '',
    pay_step: r.pay_step != null ? String(r.pay_step) : '',
    status: r.status || 'active'
  };
}

export const HrPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [leave, setLeave] = useState<any[]>([]);
  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [empSaving, setEmpSaving] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [empForm, setEmpForm] = useState<EmpForm>(emptyEmpForm);
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

  const selectedGrade = useMemo(
    () => grades.find((g) => g.id === empForm.pay_grade_id) || null,
    [grades, empForm.pay_grade_id]
  );

  const stepOptions = useMemo(() => {
    const max = Number(selectedGrade?.max_step || selectedGrade?.maxStep || 0);
    if (!max || max < 1) return [];
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [selectedGrade]);

  const load = async () => {
    try {
      const [e, a, l, b, g, d] = await Promise.all([
        api.hr.employees(),
        api.hr.attendance(),
        api.hr.leave(),
        api.branches.list(),
        api.payroll.grades(false).catch(() => []),
        api.hr.departments(false).catch(() => [])
      ]);
      setEmployees(e);
      setAttendance(a);
      setLeave(l);
      setBranches(b);
      setGrades(Array.isArray(g) ? g : []);
      setDepartments(Array.isArray(d) ? d : []);
      setAttForm((f) => ({ ...f, employee_id: f.employee_id || e[0]?.id || '' }));
      setLeaveForm((f) => ({ ...f, employee_id: f.employee_id || e[0]?.id || '' }));
    } catch (err: any) {
      await alertError('HR', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!empModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeEmpModal();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [empModalOpen]);

  const openCreateModal = () => {
    setEditingEmpId(null);
    setEmpForm(emptyEmpForm());
    setEmpModalOpen(true);
  };

  const openEditModal = (row: any) => {
    setEditingEmpId(row.id);
    setEmpForm(employeeToForm(row));
    setEmpModalOpen(true);
  };

  const closeEmpModal = (force = false) => {
    if (empSaving && !force) return;
    setEmpModalOpen(false);
    setEditingEmpId(null);
    setEmpForm(emptyEmpForm());
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      full_name: empForm.full_name,
      staff_number: empForm.staff_number,
      department_id: empForm.department_id || null,
      job_title: empForm.job_title || undefined,
      base_salary: Number(empForm.base_salary || 0),
      phone: empForm.phone || undefined,
      email: empForm.email,
      hire_date: empForm.hire_date || undefined,
      branch_id: empForm.branch_id || undefined,
      is_sales_rep: empForm.is_sales_rep,
      commission_percent: empForm.is_sales_rep
        ? Number(empForm.commission_percent || 0)
        : undefined,
      include_sales_commission: empForm.include_sales_commission,
      employment_type: empForm.employment_type,
      pay_grade_id: empForm.pay_grade_id || null,
      pay_step: empForm.pay_grade_id && empForm.pay_step !== '' ? Number(empForm.pay_step) : null
    };
    if (editingEmpId) payload.status = empForm.status;
    return payload;
  };

  const saveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpSaving(true);
    try {
      const payload = buildPayload();
      if (editingEmpId) {
        await api.hr.updateEmployee(editingEmpId, payload);
        await alertSuccess('Employee updated');
      } else {
        const created = await api.hr.createEmployee(payload);
        const mailNote = created.invite_email_sent
          ? ' Password setup link emailed.'
          : created.invite_link
            ? ` Invite link: ${created.invite_link}`
            : '';
        await alertSuccess(
          `Employee created. Username (staff number): ${created.login_username || empForm.staff_number}.${mailNote}`
        );
      }
      setEmpSaving(false);
      closeEmpModal(true);
      await load();
    } catch (err: any) {
      await alertError(editingEmpId ? 'Update failed' : 'Create failed', err.message);
    } finally {
      setEmpSaving(false);
    }
  };

  const addDepartmentQuick = async () => {
    const name = newDepartmentName.trim();
    if (!name) return;
    try {
      const created = await api.hr.createDepartment({ name });
      setNewDepartmentName('');
      await load();
      setEmpForm((f) => ({ ...f, department_id: created.id }));
      await alertSuccess('Department added');
    } catch (err: any) {
      await alertError('Department', err.message);
    }
  };

  const resendInvite = async () => {
    if (!editingEmpId) return;
    try {
      const res = await api.hr.resendInvite(editingEmpId);
      const note = res.invite_email_sent
        ? 'Invite email resent.'
        : res.invite_link
          ? `Invite link: ${res.invite_link}`
          : 'Invite created.';
      await alertSuccess(note);
    } catch (err: any) {
      await alertError('Resend invite failed', err.message);
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
        {tab === 'employees' ? (
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            Add employee
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'employees' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Staff no.</th>
                  <th>Department</th>
                  <th>Branch</th>
                  <th>Title</th>
                  <th>Grade</th>
                  <th>Step</th>
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
                    <td>{r.department_ref?.name || r.department || '—'}</td>
                    <td>{r.branch?.code || '—'}</td>
                    <td>{r.job_title || '—'}</td>
                    <td>{r.pay_grade?.code || '—'}</td>
                    <td>{r.pay_step != null ? r.pay_step : '—'}</td>
                    <td>{r.sales_rep ? r.sales_rep.code || 'Yes' : '—'}</td>
                    <td>{Number(r.base_salary).toLocaleString()}</td>
                    <td>{r.status}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => openEditModal(r)}
                        >
                          Edit
                        </button>
                        {!r.sales_rep ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void makeSalesRep(r.id)}
                          >
                            Make sales rep
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {empModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeEmpModal}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingEmpId ? 'Edit employee' : 'Add employee'}
            style={{ width: 'min(720px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                  {editingEmpId ? 'Edit employee' : 'Add employee'}
                </h2>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>
                  Staff number is unique and becomes the login username. A password setup link is
                  emailed to the staff member.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Close"
                onClick={closeEmpModal}
                style={{ fontSize: '1.25rem', lineHeight: 1, padding: '0.35rem 0.65rem' }}
              >
                ×
              </button>
            </div>
            <form onSubmit={saveEmployee}>
              <div className="modal__body">
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
                    <label>Staff number</label>
                    <input
                      value={empForm.staff_number}
                      onChange={(e) =>
                        setEmpForm({
                          ...empForm,
                          staff_number: e.target.value.replace(/\s/g, '')
                        })
                      }
                      required
                      placeholder="Unique staff ID / username"
                    />
                  </div>
                  <div className="field">
                    <label>Department (optional)</label>
                    <select
                      value={empForm.department_id}
                      onChange={(e) =>
                        setEmpForm({ ...empForm, department_id: e.target.value })
                      }
                    >
                      <option value="">None</option>
                      {departments
                        .filter(
                          (d) =>
                            d.is_active !== false || d.id === empForm.department_id
                        )
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.code ? `${d.code} — ${d.name}` : d.name}
                          </option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input
                        value={newDepartmentName}
                        onChange={(e) => setNewDepartmentName(e.target.value)}
                        placeholder="New department name"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void addDepartmentQuick()}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>Job title</label>
                    <input
                      value={empForm.job_title}
                      onChange={(e) => setEmpForm({ ...empForm, job_title: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Base salary (fallback)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={empForm.base_salary}
                      onChange={(e) => setEmpForm({ ...empForm, base_salary: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Employment type</label>
                    <select
                      value={empForm.employment_type}
                      onChange={(e) =>
                        setEmpForm({ ...empForm, employment_type: e.target.value })
                      }
                    >
                      <option value="permanent">Permanent</option>
                      <option value="contract">Contract</option>
                      <option value="casual">Casual</option>
                      <option value="intern">Intern</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Grade level (optional)</label>
                    <select
                      value={empForm.pay_grade_id}
                      onChange={(e) =>
                        setEmpForm({
                          ...empForm,
                          pay_grade_id: e.target.value,
                          pay_step: ''
                        })
                      }
                    >
                      <option value="">None</option>
                      {grades
                        .filter(
                          (g) =>
                            g.is_active !== false ||
                            g.id === empForm.pay_grade_id
                        )
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.code} — {g.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Step (optional)</label>
                    <select
                      value={empForm.pay_step}
                      onChange={(e) => setEmpForm({ ...empForm, pay_step: e.target.value })}
                      disabled={!empForm.pay_grade_id}
                    >
                      <option value="">None</option>
                      {stepOptions.map((step) => (
                        <option key={step} value={String(step)}>
                          Step {step}
                        </option>
                      ))}
                    </select>
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
                      required
                    />
                    <div style={{ color: 'var(--ink-muted)', fontSize: '0.82rem', marginTop: 4 }}>
                      Required — used to send the password setup link.
                    </div>
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
                      value={empForm.staff_number || '—'}
                      disabled
                      title="Same as staff number"
                    />
                  </div>
                  {editingEmpId ? (
                    <div className="field">
                      <label>Status</label>
                      <select
                        value={empForm.status}
                        onChange={(e) => setEmpForm({ ...empForm, status: e.target.value })}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="terminated">Terminated</option>
                      </select>
                    </div>
                  ) : null}
                  <div className="field">
                    <label>
                      <input
                        type="checkbox"
                        checked={empForm.is_sales_rep}
                        disabled={Boolean(editingEmpId && empForm.is_sales_rep)}
                        onChange={(e) =>
                          setEmpForm({ ...empForm, is_sales_rep: e.target.checked })
                        }
                      />{' '}
                      {editingEmpId && empForm.is_sales_rep
                        ? 'Sales rep'
                        : editingEmpId
                          ? 'Also make sales rep'
                          : 'Also make sales rep'}
                    </label>
                  </div>
                  <div className="field">
                    <label>
                      <input
                        type="checkbox"
                        checked={empForm.include_sales_commission}
                        onChange={(e) =>
                          setEmpForm({
                            ...empForm,
                            include_sales_commission: e.target.checked
                          })
                        }
                      />{' '}
                      Include sales commission in payroll
                    </label>
                  </div>
                  {empForm.is_sales_rep && !editingEmpId ? (
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
                </div>
              </div>
              <div className="modal__footer">
                {editingEmpId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void resendInvite()}
                    disabled={empSaving}
                  >
                    Resend password link
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeEmpModal}
                  disabled={empSaving}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={empSaving}>
                  {empSaving
                    ? 'Saving…'
                    : editingEmpId
                      ? 'Save changes'
                      : 'Create employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
