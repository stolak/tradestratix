import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab =
  | 'runs'
  | 'reports'
  | 'payslip'
  | 'components'
  | 'grades'
  | 'chart'
  | 'statutory'
  | 'period';

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
    pay_date: end.toISOString().slice(0, 10)
  };
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'reports', label: 'Period report' },
  { id: 'payslip', label: 'Payslip' },
  { id: 'components', label: 'Components' },
  { id: 'grades', label: 'Pay grades' },
  { id: 'chart', label: 'Salary chart' },
  { id: 'statutory', label: 'Statutory' },
  { id: 'period', label: 'Active period' }
];

function money(n: unknown) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export const PayrollPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('runs');
  const [runs, setRuns] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [grades, setGrades] = useState<any[]>([]);
  const [chart, setChart] = useState<any[]>([]);
  const [statutory, setStatutory] = useState<any[]>([]);
  const [period, setPeriod] = useState<any>(null);
  const [form, setForm] = useState(monthBounds());
  const [payMethod, setPayMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [commissionPeriodOnly, setCommissionPeriodOnly] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [periodReport, setPeriodReport] = useState<any>(null);
  const [reportForm, setReportForm] = useState({
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1)
  });
  const [payslip, setPayslip] = useState<any>(null);
  const [payslipRunId, setPayslipRunId] = useState('');
  const [payslipItems, setPayslipItems] = useState<any[]>([]);
  const [ytd, setYtd] = useState<any>(null);

  const [compForm, setCompForm] = useState({
    code: '',
    name: '',
    type: 'earning',
    calculation_method: 'fixed',
    is_taxable: false,
    is_pensionable: false,
    is_primary: false,
    statutory_key: '',
    function_elements: '',
    function_percentage: ''
  });
  const [gradeForm, setGradeForm] = useState({ code: '', name: '', max_step: '10' });
  const [chartForm, setChartForm] = useState({
    pay_grade_id: '',
    step: '1',
    employment_type: 'permanent',
    component_id: '',
    amount: ''
  });
  const [periodForm, setPeriodForm] = useState({
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1)
  });

  const loadRuns = async () => {
    const [r, b] = await Promise.all([api.payroll.runs(), api.banking.accounts()]);
    setRuns(r);
    setBanks(b);
    setBankAccountId((id) => id || b[0]?.id || '');
  };

  const loadConfig = async () => {
    const [c, g, ch, st, p] = await Promise.all([
      api.payroll.components(),
      api.payroll.grades(),
      api.payroll.chart(),
      api.payroll.statutory(),
      api.payroll.period()
    ]);
    setComponents(c);
    setGrades(g);
    setChart(ch);
    setStatutory(st);
    setPeriod(p);
    setPeriodForm({ year: String(p.year), month: String(p.month) });
    setChartForm((f) => ({
      ...f,
      pay_grade_id: f.pay_grade_id || g[0]?.id || '',
      component_id:
        f.component_id ||
        c.find((x: any) => x.calculation_method === 'fixed')?.id ||
        c[0]?.id ||
        ''
    }));
  };

  const loadReport = async () => {
    const data = await api.payroll.periodReport(
      Number(reportForm.year),
      Number(reportForm.month)
    );
    setPeriodReport(data);
  };

  const loadPayslipPicker = async (runId: string) => {
    if (!runId) {
      setPayslipItems([]);
      return;
    }
    const data = await api.payroll.runPayslips(runId);
    setPayslipItems(data.items || []);
  };

  const load = async () => {
    try {
      if (tab === 'runs') await loadRuns();
      else if (tab === 'reports') {
        await loadRuns();
        await loadReport();
      } else if (tab === 'payslip') {
        await loadRuns();
        if (payslipRunId) await loadPayslipPicker(payslipRunId);
      } else await loadConfig();
    } catch (err: any) {
      await alertError('Payroll', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, [tab]);

  const openPayslip = async (payrollItemId: string) => {
    try {
      const slip = await api.payroll.payslip({ payrollItemId });
      setPayslip(slip);
      setTab('payslip');
      if (slip.run?.id) {
        setPayslipRunId(slip.run.id);
        await loadPayslipPicker(slip.run.id);
      }
      if (slip.employee?.id) {
        const year = slip.run?.year || new Date().getFullYear();
        setYtd(await api.payroll.employeeYtd(slip.employee.id, year));
      }
    } catch (err: any) {
      await alertError('Payslip', err.message);
    }
  };

  const ensureDefaults = async () => {
    try {
      await api.payroll.ensureDefaults();
      await alertSuccess('Starter components and statutory rules ready');
      await loadConfig();
      setTab('components');
    } catch (err: any) {
      await alertError('Defaults', err.message);
    }
  };

  const createRun = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const run = await api.payroll.createRun({
        period_start: form.period_start,
        period_end: form.period_end,
        pay_date: form.pay_date,
        commission_period_only: commissionPeriodOnly
      });
      await alertSuccess('Payroll run computed');
      setSelectedRun(run);
      await loadRuns();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const openRun = async (id: string) => {
    try {
      const run = await api.payroll.getRun(id);
      setSelectedRun(run);
    } catch (err: any) {
      await alertError('Load run', err.message);
    }
  };

  const recompute = async (id: string) => {
    try {
      const run = await api.payroll.recomputeRun(id, {
        commission_period_only: commissionPeriodOnly
      });
      await alertSuccess('Run recomputed');
      setSelectedRun(run);
      await loadRuns();
    } catch (err: any) {
      await alertError('Recompute failed', err.message);
    }
  };

  const approve = async (id: string) => {
    try {
      const run = await api.payroll.approveRun(id);
      await alertSuccess('Payroll approved');
      setSelectedRun(run);
      await loadRuns();
    } catch (err: any) {
      await alertError('Approve failed', err.message);
    }
  };

  const unapprove = async (id: string) => {
    try {
      const run = await api.payroll.unapproveRun(id);
      await alertSuccess('Returned to draft');
      setSelectedRun(run);
      await loadRuns();
    } catch (err: any) {
      await alertError('Unapprove failed', err.message);
    }
  };

  const post = async (id: string) => {
    try {
      await api.payroll.postRun(id);
      await alertSuccess('Payroll posted to GL');
      setSelectedRun(null);
      await loadRuns();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const pay = async (id: string) => {
    try {
      await api.payroll.payRun(id, {
        method: payMethod,
        bank_account_id: payMethod === 'bank' ? bankAccountId || undefined : undefined,
        commission_period_only: commissionPeriodOnly
      });
      await alertSuccess('Payroll paid');
      setSelectedRun(null);
      await loadRuns();
    } catch (err: any) {
      await alertError('Pay failed', err.message);
    }
  };

  const createComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.payroll.createComponent({
        ...compForm,
        is_taxable: compForm.is_taxable,
        is_pensionable: compForm.is_pensionable,
        is_primary: compForm.is_primary,
        statutory_key: compForm.statutory_key || undefined,
        function_elements: compForm.function_elements || undefined,
        function_percentage: compForm.function_percentage
          ? Number(compForm.function_percentage)
          : undefined
      });
      await alertSuccess('Component created');
      setCompForm({
        code: '',
        name: '',
        type: 'earning',
        calculation_method: 'fixed',
        is_taxable: false,
        is_pensionable: false,
        is_primary: false,
        statutory_key: '',
        function_elements: '',
        function_percentage: ''
      });
      await loadConfig();
    } catch (err: any) {
      await alertError('Component', err.message);
    }
  };

  const toggleComponent = async (row: any) => {
    try {
      await api.payroll.updateComponent(row.id, { is_active: !row.is_active });
      await loadConfig();
    } catch (err: any) {
      await alertError('Update', err.message);
    }
  };

  const createGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.payroll.createGrade({
        code: gradeForm.code,
        name: gradeForm.name,
        max_step: Number(gradeForm.max_step || 1)
      });
      await alertSuccess('Pay grade created');
      setGradeForm({ code: '', name: '', max_step: '10' });
      await loadConfig();
    } catch (err: any) {
      await alertError('Grade', err.message);
    }
  };

  const saveChart = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.payroll.upsertChart({
        pay_grade_id: chartForm.pay_grade_id,
        step: Number(chartForm.step),
        employment_type: chartForm.employment_type,
        component_id: chartForm.component_id,
        amount: Number(chartForm.amount || 0)
      });
      await alertSuccess('Chart entry saved');
      await loadConfig();
    } catch (err: any) {
      await alertError('Chart', err.message);
    }
  };

  const toggleStatutory = async (row: any) => {
    try {
      await api.payroll.upsertStatutory({
        key: row.key,
        name: row.name,
        method: row.method,
        rate: row.rate != null ? Number(row.rate) : undefined,
        base_key: row.base_key,
        is_active: !row.is_active,
        brackets: row.brackets
      });
      await loadConfig();
    } catch (err: any) {
      await alertError('Statutory', err.message);
    }
  };

  const savePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await api.payroll.setPeriod({
        year: Number(periodForm.year),
        month: Number(periodForm.month)
      });
      setPeriod(p);
      await alertSuccess('Active period updated');
    } catch (err: any) {
      await alertError('Period', err.message);
    }
  };

  const fixedComponents = components.filter((c) => c.calculation_method === 'fixed');

  return (
    <div className="page-stack">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start'
        }}
      >
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Payroll
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            Compute → approve → post → pay. Components drive journals; commissions mark paid on
            pay.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void ensureDefaults()}>
          Seed starter config
        </button>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'runs' ? (
        <>
          <form
            onSubmit={createRun}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New payroll run</div>
            <div className="form-grid">
              <div className="field">
                <label>Period start</label>
                <input
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Period end</label>
                <input
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Pay date</label>
                <input
                  type="date"
                  value={form.pay_date}
                  onChange={(e) => setForm({ ...form, pay_date: e.target.value })}
                  required
                />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={commissionPeriodOnly}
                    onChange={(e) => setCommissionPeriodOnly(e.target.checked)}
                  />{' '}
                  Commissions in period only
                </label>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Compute run
                </button>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)' }}>
              Uses salary components, chart/package/overrides, statutory rules, and accrued sales
              commissions (when enabled on the employee).
            </p>
          </form>

          <div className="card-surface form-grid" style={{ padding: '1rem 1.25rem' }}>
            <div className="field">
              <label>Pay method (for Pay action)</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            {payMethod === 'bank' ? (
              <div className="field">
                <label>Bank account</label>
                <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run #</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Gross</th>
                    <th>Commission</th>
                    <th>Deductions</th>
                    <th>Net</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.run_number}</td>
                      <td>
                        {String(r.period_start).slice(0, 10)} → {String(r.period_end).slice(0, 10)}
                      </td>
                      <td>{r.status}</td>
                      <td>{Number(r.total_gross).toLocaleString()}</td>
                      <td>{Number(r.total_commission || 0).toLocaleString()}</td>
                      <td>{Number(r.total_deductions).toLocaleString()}</td>
                      <td>{Number(r.total_net).toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void openRun(r.id)}
                          >
                            View
                          </button>
                          {r.status === 'draft' ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void recompute(r.id)}
                              >
                                Recompute
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void approve(r.id)}
                              >
                                Approve
                              </button>
                            </>
                          ) : null}
                          {r.status === 'approved' ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void unapprove(r.id)}
                              >
                                Unapprove
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void post(r.id)}
                              >
                                Post
                              </button>
                            </>
                          ) : null}
                          {r.status === 'posted' && !r.payment_journal_entry_id ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void pay(r.id)}
                            >
                              Pay
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!runs.length ? (
                    <tr>
                      <td colSpan={8}>No payroll runs yet — seed config, then compute a run</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRun ? (
            <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {selectedRun.run_number} — {selectedRun.status}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelectedRun(null)}
                >
                  Close
                </button>
              </div>
              {(selectedRun.items || []).map((item: any) => (
                <div key={item.id} style={{ borderTop: '1px solid var(--border, #ddd)', paddingTop: 10 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 6,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center'
                    }}
                  >
                    <span>
                      {item.employee?.full_name || item.employee_id}
                      {item.commission_amount > 0
                        ? ` · Commission ${money(item.commission_amount)}`
                        : ''}
                      {` · Net ${money(item.net_pay)}`}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void openPayslip(item.id)}
                    >
                      Payslip
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(item.lines || []).map((line: any) => (
                          <tr key={line.id}>
                            <td>
                              {line.component_code} — {line.component_name}
                            </td>
                            <td>{line.component_type}</td>
                            <td>{line.calculation_method}</td>
                            <td>{Number(line.amount).toLocaleString()}</td>
                          </tr>
                        ))}
                        {!(item.lines || []).length ? (
                          <tr>
                            <td colSpan={4}>No component lines (legacy flat run)</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'components' ? (
        <>
          <form
            onSubmit={createComponent}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add salary component</div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input
                  value={compForm.code}
                  onChange={(e) => setCompForm({ ...compForm, code: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Name</label>
                <input
                  value={compForm.name}
                  onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Type</label>
                <select
                  value={compForm.type}
                  onChange={(e) => setCompForm({ ...compForm, type: e.target.value })}
                >
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                  <option value="employer_contribution">Employer contribution</option>
                </select>
              </div>
              <div className="field">
                <label>Calculation</label>
                <select
                  value={compForm.calculation_method}
                  onChange={(e) =>
                    setCompForm({ ...compForm, calculation_method: e.target.value })
                  }
                >
                  <option value="fixed">Fixed</option>
                  <option value="percent_of_components">% of components</option>
                  <option value="progressive_tax">Progressive tax</option>
                  <option value="statutory_rate">Statutory rate</option>
                  <option value="sales_commission">Sales commission</option>
                </select>
              </div>
              <div className="field">
                <label>Function elements (codes)</label>
                <input
                  value={compForm.function_elements}
                  onChange={(e) =>
                    setCompForm({ ...compForm, function_elements: e.target.value })
                  }
                  placeholder="BASIC, HOUSING"
                />
              </div>
              <div className="field">
                <label>Function %</label>
                <input
                  value={compForm.function_percentage}
                  onChange={(e) =>
                    setCompForm({ ...compForm, function_percentage: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Statutory key</label>
                <input
                  value={compForm.statutory_key}
                  onChange={(e) => setCompForm({ ...compForm, statutory_key: e.target.value })}
                  placeholder="paye / pension_employee"
                />
              </div>
              <div className="field" style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={compForm.is_taxable}
                    onChange={(e) => setCompForm({ ...compForm, is_taxable: e.target.checked })}
                  />{' '}
                  Taxable
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={compForm.is_pensionable}
                    onChange={(e) =>
                      setCompForm({ ...compForm, is_pensionable: e.target.checked })
                    }
                  />{' '}
                  Pensionable
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={compForm.is_primary}
                    onChange={(e) => setCompForm({ ...compForm, is_primary: e.target.checked })}
                  />{' '}
                  Primary
                </label>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Add component
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
                    <th>Method</th>
                    <th>Flags</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <tr key={c.id}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.type}</td>
                      <td>{c.calculation_method}</td>
                      <td style={{ fontSize: 12 }}>
                        {[
                          c.is_primary ? 'primary' : null,
                          c.is_taxable ? 'taxable' : null,
                          c.is_pensionable ? 'pensionable' : null,
                          c.is_statutory ? 'statutory' : null
                        ]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </td>
                      <td>{c.is_active ? 'Yes' : 'No'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void toggleComponent(c)}
                        >
                          {c.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!components.length ? (
                    <tr>
                      <td colSpan={7}>
                        No components — click “Seed starter config” to create BASIC, PAYE,
                        pension, and sales commission.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'grades' ? (
        <>
          <form
            onSubmit={createGrade}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add pay grade</div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input
                  value={gradeForm.code}
                  onChange={(e) => setGradeForm({ ...gradeForm, code: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Name</label>
                <input
                  value={gradeForm.name}
                  onChange={(e) => setGradeForm({ ...gradeForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Max step</label>
                <input
                  type="number"
                  min={1}
                  value={gradeForm.max_step}
                  onChange={(e) => setGradeForm({ ...gradeForm, max_step: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Add grade
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
                    <th>Max step</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.id}>
                      <td>{g.code}</td>
                      <td>{g.name}</td>
                      <td>{g.max_step}</td>
                      <td>{g.is_active ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                  {!grades.length ? (
                    <tr>
                      <td colSpan={4}>No pay grades yet</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'chart' ? (
        <>
          <form
            onSubmit={saveChart}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Upsert chart amount (fixed components only)</div>
            <div className="form-grid">
              <div className="field">
                <label>Grade</label>
                <select
                  value={chartForm.pay_grade_id}
                  onChange={(e) => setChartForm({ ...chartForm, pay_grade_id: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Step</label>
                <input
                  type="number"
                  min={1}
                  value={chartForm.step}
                  onChange={(e) => setChartForm({ ...chartForm, step: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Employment type</label>
                <select
                  value={chartForm.employment_type}
                  onChange={(e) =>
                    setChartForm({ ...chartForm, employment_type: e.target.value })
                  }
                >
                  <option value="permanent">Permanent</option>
                  <option value="contract">Contract</option>
                  <option value="casual">Casual</option>
                  <option value="intern">Intern</option>
                </select>
              </div>
              <div className="field">
                <label>Component</label>
                <select
                  value={chartForm.component_id}
                  onChange={(e) => setChartForm({ ...chartForm, component_id: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {fixedComponents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={chartForm.amount}
                  onChange={(e) => setChartForm({ ...chartForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Save chart entry
                </button>
              </div>
            </div>
          </form>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Step</th>
                    <th>Type</th>
                    <th>Component</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.map((row) => (
                    <tr key={row.id}>
                      <td>{row.pay_grade?.code || row.payGrade?.code}</td>
                      <td>{row.step}</td>
                      <td>{row.employment_type}</td>
                      <td>{row.component?.code}</td>
                      <td>{Number(row.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                  {!chart.length ? (
                    <tr>
                      <td colSpan={5}>No chart entries yet</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'statutory' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Name</th>
                  <th>Method</th>
                  <th>Rate / brackets</th>
                  <th>Base</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {statutory.map((s) => (
                  <tr key={s.id}>
                    <td>{s.key}</td>
                    <td>{s.name}</td>
                    <td>{s.method}</td>
                    <td>
                      {s.method === 'progressive_brackets'
                        ? `${s.brackets?.length || 0} brackets`
                        : s.rate != null
                          ? `${Number(s.rate)}%`
                          : '—'}
                    </td>
                    <td>{s.base_key || '—'}</td>
                    <td>{s.is_active ? 'Yes' : 'No'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void toggleStatutory(s)}
                      >
                        {s.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!statutory.length ? (
                  <tr>
                    <td colSpan={7}>No statutory rules — seed starter config first</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'reports' ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadReport().catch((err) => alertError('Report', err.message));
            }}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Period payroll matrix</div>
            <div className="form-grid">
              <div className="field">
                <label>Year</label>
                <input
                  type="number"
                  value={reportForm.year}
                  onChange={(e) => setReportForm({ ...reportForm, year: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Month</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={reportForm.month}
                  onChange={(e) => setReportForm({ ...reportForm, month: e.target.value })}
                  required
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Load report
                </button>
              </div>
            </div>
            {periodReport?.run ? (
              <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
                Run {periodReport.run.run_number} · {periodReport.run.status} ·{' '}
                {periodReport.totals?.employees || 0} employees · Net{' '}
                {money(periodReport.totals?.net)}
              </p>
            ) : (
              <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
                No payroll run for this period yet
              </p>
            )}
          </form>

          {periodReport?.rows?.length ? (
            <div className="card-surface" style={{ padding: '0.5rem 0' }}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {(periodReport.period_components || []).map((c: any) => (
                        <th key={c.code} title={c.name}>
                          {c.code}
                        </th>
                      ))}
                      <th>Net</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {periodReport.rows.map((row: any) => (
                      <tr key={row.payroll_item_id}>
                        <td>{row.employee?.full_name || row.employee_id}</td>
                        {(periodReport.period_components || []).map((c: any) => {
                          const amt = (row.amounts || []).find(
                            (a: any) => a.code === c.code
                          )?.amount;
                          return <td key={c.code}>{money(amt || 0)}</td>;
                        })}
                        <td>{money(row.net_pay)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void openPayslip(row.payroll_item_id)}
                          >
                            Payslip
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>Totals</td>
                      {(periodReport.period_components || []).map((c: any) => {
                        const amt = (periodReport.totals?.by_component || []).find(
                          (a: any) => a.code === c.code
                        )?.amount;
                        return (
                          <td key={c.code} style={{ fontWeight: 700 }}>
                            {money(amt || 0)}
                          </td>
                        );
                      })}
                      <td style={{ fontWeight: 700 }}>{money(periodReport.totals?.net)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'payslip' ? (
        <>
          <div
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Employee payslip</div>
            <div className="form-grid">
              <div className="field">
                <label>Payroll run</label>
                <select
                  value={payslipRunId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPayslipRunId(id);
                    setPayslip(null);
                    void loadPayslipPicker(id).catch((err) =>
                      alertError('Payslips', err.message)
                    );
                  }}
                >
                  <option value="">Select run…</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.run_number} · {r.status} · {String(r.period_start).slice(0, 7)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Employee</label>
                <select
                  value={payslip?.item?.id || ''}
                  onChange={(e) => {
                    if (e.target.value) void openPayslip(e.target.value);
                  }}
                >
                  <option value="">Select employee…</option>
                  {payslipItems.map((i) => (
                    <option key={i.payroll_item_id} value={i.payroll_item_id}>
                      {i.employee?.full_name || i.employee_id} · Net {money(i.net_pay)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {payslip ? (
            <div
              className="card-surface"
              style={{ padding: '1.5rem', display: 'grid', gap: 16, maxWidth: 720 }}
            >
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                  {payslip.employee?.full_name}
                </div>
                <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
                  {payslip.employee?.code ? `${payslip.employee.code} · ` : ''}
                  {payslip.employee?.job_title || payslip.employee?.department || 'Employee'}
                  {payslip.employee?.branch
                    ? ` · ${payslip.employee.branch.code}`
                    : ''}
                  <br />
                  Run {payslip.run?.run_number} ·{' '}
                  {String(payslip.run?.period_start).slice(0, 10)} →{' '}
                  {String(payslip.run?.period_end).slice(0, 10)} · Pay{' '}
                  {String(payslip.run?.pay_date).slice(0, 10)} · {payslip.run?.status}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Earnings</div>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {(payslip.lines?.earnings || []).map((l: any) => (
                        <tr key={l.id || l.component_code}>
                          <td>
                            {l.component_code} — {l.component_name}
                          </td>
                          <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ fontWeight: 700 }}>Gross</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {money(payslip.totals?.gross)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Deductions</div>
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {(payslip.lines?.deductions || []).map((l: any) => (
                        <tr key={l.id || l.component_code}>
                          <td>
                            {l.component_code} — {l.component_name}
                          </td>
                          <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ fontWeight: 700 }}>Total deductions</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {money(payslip.totals?.total_deductions)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {(payslip.lines?.employer || []).length ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Employer contributions
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {(payslip.lines?.employer || []).map((l: any) => (
                          <tr key={l.id || l.component_code}>
                            <td>
                              {l.component_code} — {l.component_name}
                            </td>
                            <td style={{ textAlign: 'right' }}>{money(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  borderTop: '1px solid var(--border, #ddd)',
                  paddingTop: 12
                }}
              >
                <span>Net pay</span>
                <span>{money(payslip.totals?.net_pay)}</span>
              </div>

              {payslip.ytd ? (
                <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    Year-to-date (incl. this slip)
                  </div>
                  Gross {money(payslip.ytd.gross)} · Tax {money(payslip.ytd.tax)} · Pension EE{' '}
                  {money(payslip.ytd.pension_employee)} · Commission{' '}
                  {money(payslip.ytd.commission)} · Net {money(payslip.ytd.net)}
                  {ytd?.periods?.length ? (
                    <div style={{ marginTop: 8 }}>
                      Posted periods this year: {ytd.periods.length}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => window.print()}
                >
                  Print
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'period' ? (
        <form
          onSubmit={savePeriod}
          className="card-surface"
          style={{ padding: '1.25rem', display: 'grid', gap: 12, maxWidth: 480 }}
        >
          <div style={{ fontWeight: 700 }}>Active payroll period</div>
          {period ? (
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              Current: {period.month}/{period.year}
            </p>
          ) : null}
          <div className="form-grid">
            <div className="field">
              <label>Year</label>
              <input
                type="number"
                value={periodForm.year}
                onChange={(e) => setPeriodForm({ ...periodForm, year: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Month</label>
              <input
                type="number"
                min={1}
                max={12}
                value={periodForm.month}
                onChange={(e) => setPeriodForm({ ...periodForm, month: e.target.value })}
                required
              />
            </div>
            <div className="form-grid--actions">
              <button className="btn btn-primary" type="submit">
                Set period
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
};
