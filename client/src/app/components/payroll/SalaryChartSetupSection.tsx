import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { alertError, alertSuccess } from '../../utils/alerts';

const EMPLOYMENT_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'casual', label: 'Casual' },
  { value: 'intern', label: 'Intern' }
];

type Grade = {
  id: string;
  code: string;
  name: string;
  max_step?: number;
  maxStep?: number;
  is_active?: boolean;
};

type Component = {
  id: string;
  code: string;
  name: string;
  type: string;
  calculation_method?: string;
  is_active?: boolean;
  sort_order?: number;
};

function money(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseAmount(raw: string): number {
  const cleaned = String(raw || '').replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  grades: Grade[];
  components: Component[];
  onSaved?: () => void | Promise<void>;
};

export const SalaryChartSetupSection: React.FC<Props> = ({ grades, components, onSaved }) => {
  const [employmentType, setEmploymentType] = useState('permanent');
  const [payGradeId, setPayGradeId] = useState('');
  const [step, setStep] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasSavedChart, setHasSavedChart] = useState(false);

  const activeGrades = useMemo(
    () => grades.filter((g) => g.is_active !== false),
    [grades]
  );

  const selectedGrade = useMemo(
    () => activeGrades.find((g) => g.id === payGradeId) || null,
    [activeGrades, payGradeId]
  );

  const stepOptions = useMemo(() => {
    const max = Number(selectedGrade?.max_step ?? selectedGrade?.maxStep ?? 0);
    if (!max || max < 1) return [];
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [selectedGrade]);

  const activeComponents = useMemo(
    () =>
      [...components]
        .filter((c) => c.is_active !== false)
        .sort(
          (a, b) =>
            Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
            String(a.code).localeCompare(String(b.code))
        ),
    [components]
  );

  const earnings = useMemo(
    () => activeComponents.filter((c) => c.type === 'earning'),
    [activeComponents]
  );
  const deductions = useMemo(
    () => activeComponents.filter((c) => c.type === 'deduction'),
    [activeComponents]
  );
  const fixedComponents = useMemo(
    () => activeComponents.filter((c) => c.calculation_method === 'fixed'),
    [activeComponents]
  );

  const criteriaReady = Boolean(employmentType && payGradeId && step);

  useEffect(() => {
    if (!payGradeId) {
      setStep('');
      return;
    }
    if (stepOptions.length && !stepOptions.includes(Number(step))) {
      setStep(String(stepOptions[0]));
    }
  }, [payGradeId, stepOptions, step]);

  useEffect(() => {
    let cancelled = false;
    if (!criteriaReady) {
      setAmounts({});
      setDirty(false);
      setHasSavedChart(false);
      return;
    }

    setLoading(true);
    api.payroll
      .chart({
        payGradeId,
        employmentType,
        step: Number(step)
      })
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const c of fixedComponents) map[c.id] = '';
        for (const row of rows || []) {
          const id = row.component_id || row.component?.id;
          if (!id) continue;
          const amt = Number(row.amount ?? 0);
          map[id] = amt ? String(amt) : '';
        }
        setAmounts(map);
        setHasSavedChart(Boolean(rows?.length));
        setDirty(false);
      })
      .catch((err: any) => alertError('Salary chart', err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [criteriaReady, payGradeId, employmentType, step, fixedComponents.map((c) => c.id).join(',')]);

  const setAmount = (componentId: string, value: string) => {
    setAmounts((prev) => ({ ...prev, [componentId]: value }));
    setDirty(true);
  };

  const totalEarnings = useMemo(
    () =>
      earnings.reduce((sum, c) => {
        if (c.calculation_method !== 'fixed') return sum;
        return sum + parseAmount(amounts[c.id] ?? '');
      }, 0),
    [earnings, amounts]
  );

  const totalDeductions = useMemo(
    () =>
      deductions.reduce((sum, c) => {
        if (c.calculation_method !== 'fixed') return sum;
        return sum + parseAmount(amounts[c.id] ?? '');
      }, 0),
    [deductions, amounts]
  );

  const save = async () => {
    if (!criteriaReady) return;
    setSaving(true);
    try {
      await api.payroll.upsertChart({
        pay_grade_id: payGradeId,
        step: Number(step),
        employment_type: employmentType,
        components: fixedComponents.map((c) => ({
          component_id: c.id,
          amount: parseAmount(amounts[c.id] ?? '')
        }))
      });
      setDirty(false);
      setHasSavedChart(true);
      await alertSuccess('Salary chart saved');
      await onSaved?.();
    } catch (err: any) {
      await alertError('Salary chart', err.message);
    } finally {
      setSaving(false);
    }
  };

  const renderGrid = (title: string, rows: Component[]) => (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      {!rows.length ? (
        <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>No {title.toLowerCase()} yet.</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12
          }}
        >
          {rows.map((c) => {
            const isFixed = c.calculation_method === 'fixed';
            return (
              <div key={c.id} className="field" style={{ margin: 0 }}>
                <label title={c.name}>
                  {c.code}
                  {!isFixed ? (
                    <span style={{ display: 'block', fontWeight: 400, color: 'var(--ink-muted)' }}>
                      Calculated
                    </span>
                  ) : null}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!isFixed || saving}
                  value={isFixed ? amounts[c.id] ?? '' : ''}
                  onChange={(e) => {
                    if (!isFixed) return;
                    setAmount(c.id, e.target.value.replace(/[^\d.]/g, ''));
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Chart criteria</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 13, marginTop: 4 }}>
            Choose employment type, grade level, and step to load or create chart amounts.
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Employment type</label>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Grade level</label>
            <select
              value={payGradeId}
              onChange={(e) => {
                setPayGradeId(e.target.value);
                setStep('');
              }}
            >
              <option value="">Select…</option>
              {activeGrades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Step</label>
            <select
              value={step}
              onChange={(e) => setStep(e.target.value)}
              disabled={!payGradeId || !stepOptions.length}
              required={Boolean(payGradeId)}
            >
              <option value="">{payGradeId ? 'Select…' : 'Select grade first'}</option>
              {stepOptions.map((n) => (
                <option key={n} value={String(n)}>
                  Step {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!criteriaReady ? (
        <div className="card-surface" style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-muted)' }}>
          Select employment type, grade level, and step to configure component amounts.
        </div>
      ) : loading ? (
        <div className="card-surface" style={{ padding: '2rem', textAlign: 'center' }}>
          Loading chart…
        </div>
      ) : (
        <>
          <div
            className="card-surface"
            style={{
              padding: '1rem 1.25rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
              {hasSavedChart
                ? `Editing saved amounts for ${selectedGrade?.code || 'grade'} · step ${step} · ${employmentType}`
                : 'No saved chart yet — enter amounts and save to create one.'}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save chart'}
            </button>
          </div>

          <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 24 }}>
            {renderGrid('Earnings', earnings)}
            {renderGrid('Deductions', deductions)}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12
            }}
          >
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Total earnings (fixed)</div>
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(totalEarnings)}</div>
            </div>
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Total deductions (fixed)</div>
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{money(totalDeductions)}</div>
            </div>
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Net preview (fixed)</div>
              <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                {money(totalEarnings - totalDeductions)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
