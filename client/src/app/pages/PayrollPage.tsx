import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';
import { SalaryChartSetupSection } from '../components/payroll/SalaryChartSetupSection';
import { StaffSalaryOverrideTab } from '../components/payroll/StaffSalaryOverrideTab';

type Tab =
  | 'runs'
  | 'reports'
  | 'payslip'
  | 'components'
  | 'grades'
  | 'chart'
  | 'overrides'
  | 'statutory'
  | 'period';

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function periodLabel(year: number, month: number) {
  const name = MONTH_LABELS[month - 1] || `Month ${month}`;
  return `${name} ${year}`;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'reports', label: 'Period report' },
  { id: 'payslip', label: 'Payslip' },
  { id: 'components', label: 'Components' },
  { id: 'grades', label: 'Pay grades' },
  { id: 'chart', label: 'Salary chart' },
  { id: 'overrides', label: 'Staff overrides' },
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
  const [statutory, setStatutory] = useState<any[]>([]);
  const [period, setPeriod] = useState<any>(null);
  const [payMethod, setPayMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [commissionPeriodOnly, setCommissionPeriodOnly] = useState(false);
  const [computing, setComputing] = useState(false);
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

  const emptyCompForm = () => ({
    code: '',
    name: '',
    type: 'earning',
    calculation_method: 'fixed',
    is_taxable: false,
    is_pensionable: false,
    is_primary: false,
    is_statutory: false,
    statutory_key: '',
    function_element_codes: [] as string[],
    function_percentage: ''
  });
  const [compForm, setCompForm] = useState(emptyCompForm);
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [statutoryModalOpen, setStatutoryModalOpen] = useState(false);
  const [statutoryForm, setStatutoryForm] = useState({
    key: '',
    name: '',
    method: 'progressive_brackets',
    rate: '',
    base_key: 'taxable',
    is_active: true,
    brackets: [] as { upper_limit: string; rate: string; open_ended: boolean }[]
  });
  const [taxPreviewMonthly, setTaxPreviewMonthly] = useState('500000');
  const [gradeForm, setGradeForm] = useState({ code: '', name: '', max_step: '10' });
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
    const [c, g, st, p] = await Promise.all([
      api.payroll.components(),
      api.payroll.grades(),
      api.payroll.statutory(),
      api.payroll.period()
    ]);
    setComponents(c);
    setGrades(g);
    setStatutory(st);
    setPeriod(p);
    setPeriodForm({ year: String(p.year), month: String(p.month) });
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

  const loadPeriodOnly = async () => {
    const p = await api.payroll.period();
    setPeriod(p);
    setPeriodForm({ year: String(p.year), month: String(p.month) });
  };

  const load = async () => {
    try {
      if (tab === 'runs') {
        await Promise.all([loadRuns(), loadPeriodOnly()]);
      } else if (tab === 'reports') {
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

  const periodDirty =
    !period ||
    Number(periodForm.year) !== Number(period.year) ||
    Number(periodForm.month) !== Number(period.month);

  const existingDraftForActivePeriod = runs.filter(
    (r) =>
      Number(r.year) === Number(period?.year) &&
      Number(r.month) === Number(period?.month) &&
      r.status === 'draft'
  );
  const approvedForActivePeriod = runs.some(
    (r) =>
      Number(r.year) === Number(period?.year) &&
      Number(r.month) === Number(period?.month) &&
      r.status === 'approved'
  );

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

  const saveActivePeriodFromRuns = async () => {
    try {
      const p = await api.payroll.setPeriod({
        year: Number(periodForm.year),
        month: Number(periodForm.month)
      });
      setPeriod(p);
      setPeriodForm({ year: String(p.year), month: String(p.month) });
      await alertSuccess('Active period updated');
    } catch (err: any) {
      await alertError('Set period failed', err.message);
    }
  };

  const computeActivePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (periodDirty) {
      await alertError(
        'Save the active period first',
        'Computation always uses the period saved on the server. Click Set period, then Compute.'
      );
      return;
    }
    if (!period) {
      await alertError('Active period', 'No active payroll period is set');
      return;
    }
    const label = periodLabel(Number(period.year), Number(period.month));
    if (approvedForActivePeriod) {
      await alertError(
        'Unapprove first',
        `${label} has an approved run. Unapprove it before computing or recomputing.`
      );
      return;
    }
    if (existingDraftForActivePeriod.length) {
      const ok = await confirmAction(
        'Replace existing payroll?',
        `A draft run already exists for ${label}. It will be removed and replaced with a new computation.`
      );
      if (!ok) return;
    } else {
      const ok = await confirmAction(
        `Compute payroll for ${label}?`,
        'Uses salary components, chart/package/overrides, statutory rules, and commissions for the active period.'
      );
      if (!ok) return;
    }
    setComputing(true);
    try {
      const result = await api.payroll.compute({
        commission_period_only: commissionPeriodOnly
      });
      await alertSuccess(
        'Payroll computed',
        result.message || `${result.employee_count || 0} employees`
      );
      setSelectedRun(result.run || result);
      await loadRuns();
    } catch (err: any) {
      await alertError('Compute failed', err.message);
    } finally {
      setComputing(false);
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
    const target = runs.find((r) => r.id === id);
    const label =
      target?.year && target?.month
        ? periodLabel(Number(target.year), Number(target.month))
        : 'this period';
    if (target?.status === 'approved') {
      await alertError('Unapprove first', 'Unapprove this run before recomputing.');
      return;
    }
    const ok = await confirmAction(
      'Recompute and replace?',
      `The draft payroll for ${label} will be removed and a new run created.`
    );
    if (!ok) return;
    try {
      const result = await api.payroll.recomputeRun(id, {
        commission_period_only: commissionPeriodOnly
      });
      await alertSuccess('Run recomputed', result.message);
      setSelectedRun(result.run || result);
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

  const parseFunctionElements = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(/[,;\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
    }
    return [];
  };

  const ensureStatutoryLoaded = async () => {
    if (statutory.length) return;
    try {
      setStatutory(await api.payroll.statutory());
    } catch {
      /* optional for fixed components */
    }
  };

  const openAddComponent = () => {
    setEditingCompId(null);
    setCompForm(emptyCompForm());
    void ensureStatutoryLoaded();
    setCompModalOpen(true);
  };

  const openEditComponent = (row: any) => {
    setEditingCompId(row.id);
    setCompForm({
      code: row.code || '',
      name: row.name || '',
      type: row.type || 'earning',
      calculation_method: row.calculation_method || 'fixed',
      is_taxable: Boolean(row.is_taxable),
      is_pensionable: Boolean(row.is_pensionable),
      is_primary: Boolean(row.is_primary),
      is_statutory: Boolean(row.is_statutory),
      statutory_key: row.statutory_key || '',
      function_element_codes: parseFunctionElements(row.function_elements),
      function_percentage:
        row.function_percentage != null && row.function_percentage !== ''
          ? String(row.function_percentage)
          : ''
    });
    void ensureStatutoryLoaded();
    setCompModalOpen(true);
  };

  const closeCompModal = () => {
    setCompModalOpen(false);
    setEditingCompId(null);
    setCompForm(emptyCompForm());
  };

  const toggleFunctionElement = (code: string) => {
    setCompForm((f) => {
      const has = f.function_element_codes.includes(code);
      return {
        ...f,
        function_element_codes: has
          ? f.function_element_codes.filter((c) => c !== code)
          : [...f.function_element_codes, code]
      };
    });
  };

  const saveComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    const needsElements = ['percent_of_components', 'progressive_tax', 'statutory_rate'].includes(
      compForm.calculation_method
    );
    const needsRule = ['progressive_tax', 'statutory_rate'].includes(
      compForm.calculation_method
    );
    if (needsElements && !compForm.function_element_codes.length) {
      await alertError('Component', 'Select at least one earning for the calculation base');
      return;
    }
    if (needsRule && !compForm.statutory_key) {
      await alertError('Component', 'Select a statutory rule (PAYE, pension, etc.)');
      return;
    }
    const body = {
      name: compForm.name,
      type: compForm.type,
      calculation_method: compForm.calculation_method,
      is_taxable: compForm.is_taxable,
      is_pensionable: compForm.is_pensionable,
      is_primary: compForm.is_primary,
      is_statutory: compForm.is_statutory,
      statutory_key: compForm.statutory_key || null,
      function_elements: compForm.function_element_codes,
      function_percentage: compForm.function_percentage
        ? Number(compForm.function_percentage)
        : null
    };
    try {
      if (editingCompId) {
        await api.payroll.updateComponent(editingCompId, body);
        await alertSuccess('Component updated');
      } else {
        await api.payroll.createComponent({ ...body, code: compForm.code });
        await alertSuccess('Component created');
      }
      closeCompModal();
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

  useEffect(() => {
    if (!compModalOpen) return;
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [compModalOpen]);

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

  const emptyBracketRow = () => ({
    upper_limit: '',
    rate: '',
    open_ended: false
  });

  const openEditStatutory = (row: any) => {
    const brackets = (row.brackets || [])
      .slice()
      .sort(
        (a: any, b: any) =>
          Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0)
      )
      .map((b: any) => ({
        upper_limit:
          b.upper_limit != null && b.upper_limit !== ''
            ? String(b.upper_limit)
            : '',
        rate: b.rate != null ? String(b.rate) : '',
        open_ended: b.upper_limit == null || b.upper_limit === ''
      }));
    setStatutoryForm({
      key: row.key || '',
      name: row.name || '',
      method: row.method || 'flat_rate',
      rate: row.rate != null ? String(row.rate) : '',
      base_key: row.base_key || 'taxable',
      is_active: row.is_active !== false,
      brackets: brackets.length
        ? brackets
        : row.method === 'progressive_brackets'
          ? [emptyBracketRow(), { upper_limit: '', rate: '', open_ended: true }]
          : []
    });
    setStatutoryModalOpen(true);
  };

  const closeStatutoryModal = () => {
    setStatutoryModalOpen(false);
  };

  const updateBracket = (
    index: number,
    patch: Partial<{ upper_limit: string; rate: string; open_ended: boolean }>
  ) => {
    setStatutoryForm((f) => {
      const brackets = f.brackets.map((b, i) => (i === index ? { ...b, ...patch } : b));
      if (patch.open_ended) {
        for (let i = 0; i < brackets.length; i++) {
          if (i !== index) brackets[i] = { ...brackets[i], open_ended: false };
          else brackets[i] = { ...brackets[i], open_ended: true, upper_limit: '' };
        }
      }
      return { ...f, brackets };
    });
  };

  const addBracket = () => {
    setStatutoryForm((f) => {
      const closed = f.brackets.filter((b) => !b.open_ended);
      const open = f.brackets.filter((b) => b.open_ended);
      return {
        ...f,
        brackets: [
          ...closed,
          emptyBracketRow(),
          ...(open.length ? open : [{ upper_limit: '', rate: '', open_ended: true }])
        ]
      };
    });
  };

  const removeBracket = (index: number) => {
    setStatutoryForm((f) => ({
      ...f,
      brackets: f.brackets.filter((_, i) => i !== index)
    }));
  };

  /** Client-side preview matching server progressiveMonthlyTax. */
  const previewProgressiveTax = (monthlyTaxable: number) => {
    if (monthlyTaxable <= 0 || !statutoryForm.brackets.length) return 0;
    const annual = monthlyTaxable * 12;
    const sorted = statutoryForm.brackets
      .map((b) => ({
        upperLimit: b.open_ended || !b.upper_limit ? null : Number(b.upper_limit),
        rate: Number(b.rate || 0)
      }))
      .sort((a, b) => {
        if (a.upperLimit == null) return 1;
        if (b.upperLimit == null) return -1;
        return a.upperLimit - b.upperLimit;
      });
    let tax = 0;
    let prev = 0;
    for (const b of sorted) {
      const top = b.upperLimit == null ? Number.POSITIVE_INFINITY : b.upperLimit;
      const slice = Math.max(0, Math.min(annual, top) - prev);
      if (slice > 0) tax += slice * (b.rate / 100);
      prev = top;
      if (annual <= top) break;
    }
    return Math.round((tax / 12 + Number.EPSILON) * 100) / 100;
  };

  const saveStatutory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (statutoryForm.method === 'progressive_brackets') {
        if (statutoryForm.brackets.length < 1) {
          await alertError('Statutory', 'Add at least one tax band');
          return;
        }
        const openCount = statutoryForm.brackets.filter((b) => b.open_ended).length;
        if (openCount !== 1) {
          await alertError(
            'Statutory',
            'Exactly one band must be open-ended (no upper limit) for income above the last band'
          );
          return;
        }
        for (const b of statutoryForm.brackets) {
          if (b.rate === '' || Number.isNaN(Number(b.rate))) {
            await alertError('Statutory', 'Each band needs a rate %');
            return;
          }
          if (!b.open_ended && (!b.upper_limit || Number(b.upper_limit) <= 0)) {
            await alertError('Statutory', 'Each closed band needs a positive annual upper limit');
            return;
          }
        }
      } else if (statutoryForm.rate === '' || Number.isNaN(Number(statutoryForm.rate))) {
        await alertError('Statutory', 'Enter a flat rate %');
        return;
      }

      await api.payroll.upsertStatutory({
        key: statutoryForm.key,
        name: statutoryForm.name,
        method: statutoryForm.method,
        rate:
          statutoryForm.method === 'flat_rate' ? Number(statutoryForm.rate) : undefined,
        base_key: statutoryForm.base_key || null,
        is_active: statutoryForm.is_active,
        brackets:
          statutoryForm.method === 'progressive_brackets'
            ? statutoryForm.brackets.map((b, i) => ({
                sort_order: i,
                upper_limit: b.open_ended ? null : Number(b.upper_limit),
                rate: Number(b.rate)
              }))
            : []
      });
      await alertSuccess('Statutory rule saved');
      closeStatutoryModal();
      await loadConfig();
    } catch (err: any) {
      await alertError('Statutory', err.message);
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
        brackets: (row.brackets || []).map((b: any, i: number) => ({
          sort_order: b.sort_order ?? i,
          upper_limit: b.upper_limit,
          rate: Number(b.rate)
        }))
      });
      await loadConfig();
    } catch (err: any) {
      await alertError('Statutory', err.message);
    }
  };

  useEffect(() => {
    if (!statutoryModalOpen) return;
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, [statutoryModalOpen]);

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

  const earningOptions = components.filter(
    (c) =>
      c.type === 'earning' &&
      c.is_active !== false &&
      (!editingCompId || c.id !== editingCompId)
  );
  const showFunctionElements = [
    'percent_of_components',
    'progressive_tax',
    'statutory_rate'
  ].includes(compForm.calculation_method);
  const showStatutoryRule = ['progressive_tax', 'statutory_rate'].includes(
    compForm.calculation_method
  );
  const activeStatutoryRules = statutory.filter((s) => s.is_active !== false);
  const selectedStatutory = activeStatutoryRules.find(
    (s) => s.key === compForm.statutory_key
  );

  const calculationHint = (method: string) => {
    switch (method) {
      case 'fixed':
        return 'Amount comes from salary chart, employee package, or override.';
      case 'percent_of_components':
        return 'Amount = % of the selected earning components.';
      case 'progressive_tax':
        return 'Uses the progressive tax brackets from the linked statutory rule (e.g. PAYE).';
      case 'statutory_rate':
        return 'Uses the flat % from the linked statutory rule (e.g. pension).';
      case 'sales_commission':
        return 'Pulls accrued unpaid sales commissions for the employee’s sales rep.';
      default:
        return '';
    }
  };

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
          <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Active payroll period</div>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>
                Payroll computation always runs for this year and month. Only one active period is
                allowed. Draft runs can be replaced on recompute; approved runs must be unapproved
                first. Posted/paid periods stay locked.
              </p>
            </div>
            {period ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)' }}>
                Current active period:{' '}
                <strong style={{ color: 'var(--ink)' }}>
                  {periodLabel(Number(period.year), Number(period.month))}
                </strong>
              </p>
            ) : null}
            <div className="form-grid">
              <div className="field">
                <label>Year</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void saveActivePeriodFromRuns()}
                  disabled={!periodDirty}
                >
                  Set period
                </button>
              </div>
            </div>
            {periodDirty ? (
              <p style={{ margin: 0, fontSize: 13, color: '#b45309' }}>
                You have unsaved period changes. Save the active period before computing, or
                computation will be blocked until you do.
              </p>
            ) : null}
          </div>

          <form
            onSubmit={computeActivePeriod}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Compute payroll</div>
            <div className="form-grid">
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
                <button className="btn btn-primary" type="submit" disabled={computing || periodDirty}>
                  {computing ? 'Computing…' : 'Compute run'}
                </button>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)' }}>
              Uses salary components, chart/package/overrides, statutory rules, and accrued sales
              commissions (when enabled on the employee). Dates are taken from the active period
              (1st–last day of the month).
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ fontWeight: 700 }}>Salary components</div>
            <button type="button" className="btn btn-primary" onClick={openAddComponent}>
              Add component
            </button>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Method</th>
                    <th>Elements</th>
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
                        {parseFunctionElements(c.function_elements).join(', ') || '—'}
                      </td>
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
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => openEditComponent(c)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void toggleComponent(c)}
                          >
                            {c.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!components.length ? (
                    <tr>
                      <td colSpan={8}>
                        No components — click “Seed starter config” or Add component.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {compModalOpen ? (
            <div
              className="modal-backdrop"
              role="presentation"
              onClick={closeCompModal}
            >
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label={editingCompId ? 'Edit salary component' : 'Add salary component'}
                style={{ width: 'min(640px, 100%)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal__header">
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      {editingCompId ? 'Edit salary component' : 'Add salary component'}
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>
                      Define how this line is calculated on the payslip.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label="Close"
                    onClick={closeCompModal}
                    style={{ fontSize: '1.25rem', lineHeight: 1, padding: '0.35rem 0.65rem' }}
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={saveComponent}>
                  <div className="modal__body" style={{ gap: '1.5rem' }}>
                    <section style={{ display: 'grid', gap: 12 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-muted)'
                        }}
                      >
                        Identity
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(120px, 0.4fr) 1fr',
                          gap: 12
                        }}
                      >
                        <div className="field">
                          <label>Code</label>
                          <input
                            value={compForm.code}
                            onChange={(e) =>
                              setCompForm({ ...compForm, code: e.target.value.toUpperCase() })
                            }
                            required
                            disabled={Boolean(editingCompId)}
                            placeholder="e.g. BASIC"
                          />
                        </div>
                        <div className="field">
                          <label>Display name</label>
                          <input
                            value={compForm.name}
                            onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
                            required
                            placeholder="e.g. Basic salary"
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label>Payslip side</label>
                        <select
                          value={compForm.type}
                          onChange={(e) => setCompForm({ ...compForm, type: e.target.value })}
                        >
                          <option value="earning">Earning (adds to pay)</option>
                          <option value="deduction">Deduction (reduces net)</option>
                          <option value="employer_contribution">
                            Employer contribution (company cost, not net)
                          </option>
                        </select>
                      </div>
                    </section>

                    <section style={{ display: 'grid', gap: 12 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-muted)'
                        }}
                      >
                        Calculation
                      </div>
                      <div className="field">
                        <label>How is the amount calculated?</label>
                        <select
                          value={compForm.calculation_method}
                          onChange={(e) => {
                            const method = e.target.value;
                            const needsRule = ['progressive_tax', 'statutory_rate'].includes(
                              method
                            );
                            const needsElements = [
                              'percent_of_components',
                              'progressive_tax',
                              'statutory_rate'
                            ].includes(method);
                            setCompForm({
                              ...compForm,
                              calculation_method: method,
                              is_statutory: needsRule ? true : compForm.is_statutory,
                              statutory_key: needsRule ? compForm.statutory_key : '',
                              function_element_codes: needsElements
                                ? compForm.function_element_codes
                                : [],
                              function_percentage:
                                method === 'percent_of_components'
                                  ? compForm.function_percentage
                                  : ''
                            });
                          }}
                        >
                          <option value="fixed">Fixed amount</option>
                          <option value="percent_of_components">% of selected earnings</option>
                          <option value="progressive_tax">Progressive tax (PAYE bands)</option>
                          <option value="statutory_rate">Flat statutory rate</option>
                          <option value="sales_commission">Sales commission</option>
                        </select>
                        <p
                          style={{
                            margin: '0.4rem 0 0',
                            fontSize: 12.5,
                            color: 'var(--ink-muted)',
                            lineHeight: 1.45
                          }}
                        >
                          {calculationHint(compForm.calculation_method)}
                        </p>
                      </div>

                      {compForm.calculation_method === 'percent_of_components' ? (
                        <div className="field" style={{ maxWidth: 200 }}>
                          <label>Percentage</label>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={compForm.function_percentage}
                            onChange={(e) =>
                              setCompForm({
                                ...compForm,
                                function_percentage: e.target.value
                              })
                            }
                            required
                            placeholder="e.g. 10"
                          />
                        </div>
                      ) : null}

                      {showStatutoryRule ? (
                        <div className="field">
                          <label>Statutory rule</label>
                          <select
                            value={compForm.statutory_key}
                            onChange={(e) =>
                              setCompForm({
                                ...compForm,
                                statutory_key: e.target.value,
                                is_statutory: Boolean(e.target.value)
                              })
                            }
                            required
                          >
                            <option value="">Select a rule…</option>
                            {activeStatutoryRules.map((s) => (
                              <option key={s.id} value={s.key}>
                                {s.name}
                                {s.method === 'flat_rate' && s.rate != null
                                  ? ` (${Number(s.rate)}%)`
                                  : s.method === 'progressive_brackets'
                                    ? ` (${s.brackets?.length || 0} bands)`
                                    : ''}
                              </option>
                            ))}
                          </select>
                          <p
                            style={{
                              margin: '0.4rem 0 0',
                              fontSize: 12.5,
                              color: 'var(--ink-muted)',
                              lineHeight: 1.45
                            }}
                          >
                            {activeStatutoryRules.length
                              ? 'Rules are managed under the Statutory tab (rates & tax bands).'
                              : 'No statutory rules yet — use “Seed starter config” or open the Statutory tab.'}
                            {selectedStatutory?.method === 'flat_rate' &&
                            selectedStatutory.rate != null
                              ? ` This rule applies ${Number(selectedStatutory.rate)}% to the selected earnings base.`
                              : ''}
                            {selectedStatutory?.method === 'progressive_brackets'
                              ? ' This rule applies progressive annual bands, then divides by 12 for monthly PAYE.'
                              : ''}
                          </p>
                        </div>
                      ) : null}

                      {showFunctionElements ? (
                        <div className="field">
                          <label>
                            {compForm.calculation_method === 'progressive_tax'
                              ? 'Taxable base (select earnings)'
                              : compForm.calculation_method === 'statutory_rate'
                                ? 'Contribution base (select earnings)'
                                : 'Earnings included in the %'}
                          </label>
                          {!earningOptions.length ? (
                            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>
                              Add at least one earning component first (e.g. Basic, Housing).
                            </p>
                          ) : (
                            <div
                              style={{
                                display: 'grid',
                                gap: 2,
                                maxHeight: 200,
                                overflow: 'auto',
                                padding: '0.35rem',
                                border: '1px solid var(--line)',
                                borderRadius: 10,
                                background: 'var(--bg)'
                              }}
                            >
                              {earningOptions.map((c) => {
                                const checked = compForm.function_element_codes.includes(c.code);
                                return (
                                  <label
                                    key={c.id}
                                    style={{
                                      display: 'flex',
                                      gap: 10,
                                      alignItems: 'center',
                                      cursor: 'pointer',
                                      padding: '0.55rem 0.65rem',
                                      borderRadius: 8,
                                      background: checked
                                        ? 'color-mix(in srgb, var(--brand) 10%, transparent)'
                                        : 'transparent'
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleFunctionElement(c.code)}
                                    />
                                    <span style={{ flex: 1 }}>
                                      <strong>{c.code}</strong>
                                      <span style={{ color: 'var(--ink-muted)' }}>
                                        {' '}
                                        — {c.name}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </section>

                    <section style={{ display: 'grid', gap: 10 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--ink-muted)'
                        }}
                      >
                        Flags
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8
                        }}
                      >
                        {(
                          [
                            {
                              key: 'is_taxable' as const,
                              label: 'Taxable',
                              hint: 'Included in PAYE taxable base when marked on earnings'
                            },
                            {
                              key: 'is_pensionable' as const,
                              label: 'Pensionable',
                              hint: 'Included in pensionable base'
                            },
                            {
                              key: 'is_primary' as const,
                              label: 'Primary basic',
                              hint: 'Main salary line; falls back to employee base salary'
                            },
                            {
                              key: 'is_statutory' as const,
                              label: 'Statutory deduction',
                              hint: 'Government / regulatory item (tax, pension, NHF…)'
                            }
                          ] as const
                        ).map((flag) => (
                          <label
                            key={flag.key}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'auto 1fr',
                              gap: '0.35rem 0.65rem',
                              alignItems: 'start',
                              padding: '0.65rem 0.75rem',
                              border: '1px solid var(--line)',
                              borderRadius: 10,
                              cursor: 'pointer',
                              background: compForm[flag.key]
                                ? 'color-mix(in srgb, var(--brand) 8%, transparent)'
                                : 'var(--bg)'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={compForm[flag.key]}
                              onChange={(e) =>
                                setCompForm({ ...compForm, [flag.key]: e.target.checked })
                              }
                              style={{ marginTop: 2 }}
                            />
                            <span>
                              <span style={{ fontWeight: 600, display: 'block' }}>
                                {flag.label}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: 'var(--ink-muted)',
                                  lineHeight: 1.35
                                }}
                              >
                                {flag.hint}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  </div>
                  <div className="modal__footer">
                    <button type="button" className="btn btn-ghost" onClick={closeCompModal}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">
                      {editingCompId ? 'Save changes' : 'Create component'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
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
        <SalaryChartSetupSection
          grades={grades}
          components={components}
          onSaved={loadConfig}
        />
      ) : null}

      {tab === 'overrides' ? (
        <>
          <p style={{ margin: '0 0 1rem', color: 'var(--ink-muted)', fontSize: 13, maxWidth: 720 }}>
            Override salary component amounts for a specific staff member.
          </p>
          <StaffSalaryOverrideTab />
        </>
      ) : null}

      {tab === 'statutory' ? (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Statutory rules</div>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13, maxWidth: 720 }}>
              Progressive tax (PAYE) uses <strong>annual</strong> income bands. Monthly tax = annual
              tax ÷ 12. Flat rules (pension, NHF) use a single %. Link a component to a rule via
              Calculation → Statutory rule.
            </p>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Method</th>
                    <th>Config</th>
                    <th>Base</th>
                    <th>Active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {statutory.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{s.key}</div>
                      </td>
                      <td>
                        {s.method === 'progressive_brackets'
                          ? 'Progressive bands'
                          : 'Flat rate'}
                      </td>
                      <td>
                        {s.method === 'progressive_brackets' ? (
                          <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                            {(s.brackets || []).length} band
                            {(s.brackets || []).length === 1 ? '' : 's'}
                            <div style={{ color: 'var(--ink-muted)', marginTop: 4 }}>
                              {(s.brackets || [])
                                .slice()
                                .sort(
                                  (a: any, b: any) =>
                                    Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
                                )
                                .map((b: any) =>
                                  b.upper_limit == null
                                    ? `Above · ${Number(b.rate)}%`
                                    : `≤ ${Number(b.upper_limit).toLocaleString()} · ${Number(b.rate)}%`
                                )
                                .join(' → ')}
                            </div>
                          </div>
                        ) : s.rate != null ? (
                          `${Number(s.rate)}%`
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{s.base_key || '—'}</td>
                      <td>{s.is_active ? 'Yes' : 'No'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => openEditStatutory(s)}
                          >
                            Configure
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void toggleStatutory(s)}
                          >
                            {s.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!statutory.length ? (
                    <tr>
                      <td colSpan={6}>
                        No statutory rules — click “Seed starter config” to create PAYE & pension.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {statutoryModalOpen ? (
            <div
              className="modal-backdrop"
              role="presentation"
              onClick={closeStatutoryModal}
            >
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="Configure statutory rule"
                style={{ width: 'min(720px, 100%)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal__header">
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      Configure · {statutoryForm.name || statutoryForm.key}
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>
                      Key <code>{statutoryForm.key}</code>
                      {statutoryForm.method === 'progressive_brackets'
                        ? ' · Annual upper limits; tax is converted to monthly'
                        : ' · Flat percentage of the contribution base'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label="Close"
                    onClick={closeStatutoryModal}
                    style={{ fontSize: '1.25rem', lineHeight: 1, padding: '0.35rem 0.65rem' }}
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={saveStatutory}>
                  <div className="modal__body" style={{ gap: '1.35rem' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 12
                      }}
                    >
                      <div className="field">
                        <label>Display name</label>
                        <input
                          value={statutoryForm.name}
                          onChange={(e) =>
                            setStatutoryForm({ ...statutoryForm, name: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div className="field">
                        <label>Base hint</label>
                        <select
                          value={statutoryForm.base_key}
                          onChange={(e) =>
                            setStatutoryForm({ ...statutoryForm, base_key: e.target.value })
                          }
                        >
                          <option value="taxable">Taxable earnings</option>
                          <option value="pensionable">Pensionable earnings</option>
                          <option value="gross">Gross earnings</option>
                          <option value="custom">Custom (use component elements)</option>
                        </select>
                      </div>
                    </div>

                    <label
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={statutoryForm.is_active}
                        onChange={(e) =>
                          setStatutoryForm({ ...statutoryForm, is_active: e.target.checked })
                        }
                      />
                      Rule is active
                    </label>

                    {statutoryForm.method === 'flat_rate' ? (
                      <div className="field" style={{ maxWidth: 200 }}>
                        <label>Rate %</label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={statutoryForm.rate}
                          onChange={(e) =>
                            setStatutoryForm({ ...statutoryForm, rate: e.target.value })
                          }
                          required
                        />
                      </div>
                    ) : (
                      <section style={{ display: 'grid', gap: 10 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            alignItems: 'center',
                            flexWrap: 'wrap'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>Annual tax bands</div>
                            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                              Each band’s upper limit is cumulative annual taxable income. Mark
                              one band as open-ended for income above the last limit.
                            </div>
                          </div>
                          <button type="button" className="btn btn-ghost" onClick={addBracket}>
                            Add band
                          </button>
                        </div>

                        <div className="table-wrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th style={{ width: '40%' }}>Annual upper limit</th>
                                <th style={{ width: '25%' }}>Rate %</th>
                                <th>Open-ended</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {statutoryForm.brackets.map((b, index) => (
                                <tr key={index}>
                                  <td>
                                    <input
                                      type="number"
                                      min={0}
                                      step="1"
                                      disabled={b.open_ended}
                                      value={b.open_ended ? '' : b.upper_limit}
                                      placeholder={b.open_ended ? 'No limit' : 'e.g. 300000'}
                                      onChange={(e) =>
                                        updateBracket(index, { upper_limit: e.target.value })
                                      }
                                      style={{ width: '100%' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={b.rate}
                                      onChange={(e) =>
                                        updateBracket(index, { rate: e.target.value })
                                      }
                                      required
                                      style={{ width: '100%' }}
                                    />
                                  </td>
                                  <td>
                                    <label
                                      style={{
                                        display: 'flex',
                                        gap: 6,
                                        alignItems: 'center',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={b.open_ended}
                                        onChange={(e) =>
                                          updateBracket(index, {
                                            open_ended: e.target.checked
                                          })
                                        }
                                      />
                                      Above last
                                    </label>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn btn-ghost"
                                      disabled={statutoryForm.brackets.length <= 1}
                                      onClick={() => removeBracket(index)}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div
                          style={{
                            padding: '0.85rem 1rem',
                            border: '1px solid var(--line)',
                            borderRadius: 10,
                            background: 'var(--bg)',
                            display: 'grid',
                            gap: 8
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Quick preview</div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr auto',
                              gap: 12,
                              alignItems: 'end'
                            }}
                          >
                            <div className="field" style={{ margin: 0 }}>
                              <label>Sample monthly taxable income</label>
                              <input
                                type="number"
                                min={0}
                                value={taxPreviewMonthly}
                                onChange={(e) => setTaxPreviewMonthly(e.target.value)}
                              />
                            </div>
                            <div style={{ paddingBottom: 2, textAlign: 'right' }}>
                              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                                Est. monthly PAYE
                              </div>
                              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                                {money(previewProgressiveTax(Number(taxPreviewMonthly || 0)))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                  <div className="modal__footer">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={closeStatutoryModal}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">
                      Save rule
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </>
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
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: 13 }}>
            Only one active period per business. Runs → Compute always uses this year/month.
          </p>
          {period ? (
            <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
              Current: {periodLabel(Number(period.year), Number(period.month))}
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
