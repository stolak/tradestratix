import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { alertError, alertSuccess, confirmAction } from '../../utils/alerts';

type Employee = {
  id: string;
  full_name?: string;
  code?: string | null;
  status?: string;
};

type Component = {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active?: boolean;
  sort_order?: number;
};

type OverrideRow = {
  id: string;
  employee_id: string;
  component_id: string;
  amount: number | string;
  is_continuous?: boolean;
  target_amount?: number | string | null;
  balance_remaining?: number | string | null;
  is_active?: boolean;
  employee?: { id: string; full_name?: string; code?: string | null };
  component?: { id: string; code?: string; name?: string; type?: string };
};

function modeLabel(row: OverrideRow) {
  if (row.is_continuous !== false) return 'Continuous';
  const target = row.target_amount != null ? Number(row.target_amount) : 0;
  return target > 0 ? 'Target' : 'One-off';
}

type Draft = {
  employee_id: string;
  component_id: string;
  amount: string;
  is_continuous: boolean;
  target_amount: string;
  is_active: boolean;
};

function money(n: unknown) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseAmount(raw: string): number {
  const n = Number(String(raw || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function employeeLabel(e: Employee) {
  const name = e.full_name || 'Unnamed';
  return e.code ? `${e.code} — ${name}` : name;
}

function emptyDraft(employeeId: string): Draft {
  return {
    employee_id: employeeId,
    component_id: '',
    amount: '',
    is_continuous: true,
    target_amount: '',
    is_active: true
  };
}

function draftFromRow(row: OverrideRow): Draft {
  return {
    employee_id: row.employee_id,
    component_id: row.component_id,
    amount: String(row.amount ?? ''),
    is_continuous: row.is_continuous !== false,
    target_amount: row.target_amount != null ? String(row.target_amount) : '',
    is_active: row.is_active !== false
  };
}

export const StaffSalaryOverrideTab: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingOverrides, setLoadingOverrides] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<'add' | 'edit'>('add');
  const [selected, setSelected] = useState<OverrideRow | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(''));
  const [saving, setSaving] = useState(false);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employeeId) || null,
    [employees, employeeId]
  );

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    const active = employees.filter((e) => e.status !== 'inactive' && e.status !== 'terminated');
    if (!q) return active;
    return active.filter((e) => {
      const hay = `${e.code || ''} ${e.full_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, employeeSearch]);

  const componentOptions = useMemo(() => {
    return [...components]
      .filter((c) => c.is_active !== false)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'earning' ? -1 : 1;
        return (
          Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
          a.code.localeCompare(b.code)
        );
      });
  }, [components]);

  const filteredOverrides = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return overrides;
    return overrides.filter((o) => {
      const hay = `${o.component?.code || ''} ${o.component?.name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [overrides, searchTerm]);

  useEffect(() => {
    let cancelled = false;
    setLoadingStaff(true);
    Promise.all([api.hr.employees('active').catch(() => api.hr.employees()), api.payroll.components()])
      .then(([emps, comps]) => {
        if (cancelled) return;
        setEmployees(Array.isArray(emps) ? emps : []);
        setComponents(Array.isArray(comps) ? comps : []);
      })
      .catch((err: any) => alertError('Overrides', err.message))
      .finally(() => {
        if (!cancelled) setLoadingStaff(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!employeeId) {
      setOverrides([]);
      return;
    }
    setLoadingOverrides(true);
    api.payroll
      .overrides(employeeId)
      .then((rows) => {
        if (!cancelled) setOverrides(Array.isArray(rows) ? rows : []);
      })
      .catch((err: any) => alertError('Overrides', err.message))
      .finally(() => {
        if (!cancelled) setLoadingOverrides(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const reloadOverrides = async () => {
    if (!employeeId) return;
    const rows = await api.payroll.overrides(employeeId);
    setOverrides(Array.isArray(rows) ? rows : []);
  };

  const openAdd = () => {
    if (!employeeId) return;
    setMode('add');
    setSelected(null);
    setDraft(emptyDraft(employeeId));
    setModalOpen(true);
  };

  const openEdit = (row: OverrideRow) => {
    setMode('edit');
    setSelected(row);
    setDraft(draftFromRow(row));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setSelected(null);
  };

  const saveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.employee_id || !draft.component_id) return;
    setSaving(true);
    try {
      if (mode === 'add') {
        await api.payroll.createOverride({
          employee_id: draft.employee_id,
          component_id: draft.component_id,
          amount: parseAmount(draft.amount),
          is_continuous: draft.is_continuous,
          target_amount: draft.target_amount === '' ? null : parseAmount(draft.target_amount)
        });
        await alertSuccess('Override created');
      } else if (selected) {
        await api.payroll.updateOverride(selected.id, {
          amount: parseAmount(draft.amount),
          is_continuous: draft.is_continuous,
          target_amount: draft.target_amount === '' ? null : parseAmount(draft.target_amount),
          is_active: draft.is_active
        });
        await alertSuccess('Override updated');
      }
      setModalOpen(false);
      await reloadOverrides();
    } catch (err: any) {
      await alertError(mode === 'add' ? 'Create failed' : 'Update failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async (row: OverrideRow) => {
    const ok = await confirmAction(
      'Delete override?',
      `Remove override for ${row.component?.code || 'component'} on ${
        selectedEmployee ? employeeLabel(selectedEmployee) : 'this employee'
      }?`
    );
    if (!ok) return;
    try {
      await api.payroll.deleteOverride(row.id);
      await alertSuccess('Override deleted');
      await reloadOverrides();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    }
  };

  useEffect(() => {
    if (!modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [modalOpen]);

  const busy = loadingStaff || loadingOverrides;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Staff selection</div>
          <div style={{ color: 'var(--ink-muted)', fontSize: 13, marginTop: 4 }}>
            Choose a staff member to view and manage salary component overrides.
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Find staff (optional)</label>
            <input
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              placeholder="Type to filter staff…"
            />
          </div>
          <div className="field">
            <label>Staff</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={loadingStaff}
            >
              <option value="">{loadingStaff ? 'Loading…' : 'Select staff…'}</option>
              {filteredEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {employeeLabel(e)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
          {selectedEmployee ? (
            <>
              Overrides for <strong>{employeeLabel(selectedEmployee)}</strong>
            </>
          ) : (
            'Select a staff member to view overrides.'
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!employeeId || busy}
          onClick={openAdd}
        >
          Add override
        </button>
      </div>

      <div className="card-surface" style={{ padding: '1rem 1.25rem' }}>
        <div className="field" style={{ margin: 0, maxWidth: 360 }}>
          <label>Search component</label>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search component…"
            disabled={!employeeId}
          />
        </div>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Target</th>
                <th>Remaining</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!employeeId ? (
                <tr>
                  <td colSpan={7}>Select a staff member to load overrides.</td>
                </tr>
              ) : busy ? (
                <tr>
                  <td colSpan={7}>Loading…</td>
                </tr>
              ) : !filteredOverrides.length ? (
                <tr>
                  <td colSpan={7}>No overrides for this staff yet.</td>
                </tr>
              ) : (
                filteredOverrides.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.component?.code
                        ? `${row.component.code} — ${row.component.name || ''}`
                        : row.component_id}
                    </td>
                    <td>{money(row.amount)}</td>
                    <td>{modeLabel(row)}</td>
                    <td>
                      {row.is_continuous === false &&
                      row.target_amount != null &&
                      Number(row.target_amount) > 0
                        ? money(row.target_amount)
                        : '—'}
                    </td>
                    <td>
                      {row.is_continuous === false
                        ? row.balance_remaining != null
                          ? money(row.balance_remaining)
                          : Number(row.target_amount) > 0
                            ? money(row.target_amount)
                            : 'Full (once)'
                        : '—'}
                    </td>
                    <td>{row.is_active === false ? 'Inactive' : 'Active'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void removeOverride(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={mode === 'add' ? 'Add staff override' : 'Edit staff override'}
            style={{ width: 'min(520px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                  {mode === 'add' ? 'Add staff override' : 'Edit staff override'}
                </h2>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: 13 }}>
                  Replaces chart/package when payable. Continuous = every period; unchecked =
                  one-off (once, or until target). Applied at compute (recompute of the same
                  period is safe; later periods will not re-pay a one-off).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Close"
                onClick={closeModal}
                style={{ fontSize: '1.25rem', lineHeight: 1, padding: '0.35rem 0.65rem' }}
              >
                ×
              </button>
            </div>
            <form onSubmit={saveDraft}>
              <div className="modal__body">
                <div className="form-grid">
                  {mode === 'add' ? (
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label>Component</label>
                      <select
                        value={draft.component_id}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, component_id: e.target.value }))
                        }
                        required
                      >
                        <option value="">Select…</option>
                        {componentOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label>Component</label>
                      <input
                        value={
                          selected?.component?.code
                            ? `${selected.component.code} — ${selected.component.name || ''}`
                            : selected?.component_id || ''
                        }
                        disabled
                      />
                    </div>
                  )}
                  <div className="field">
                    <label>Amount</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          amount: e.target.value.replace(/[^\d.]/g, '')
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.is_continuous}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, is_continuous: e.target.checked }))
                        }
                      />{' '}
                      Continuous (every period). Uncheck for one-off.
                    </label>
                  </div>
                  {!draft.is_continuous ? (
                    <div className="field" style={{ gridColumn: '1 / -1' }}>
                      <label>Target amount (optional)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.target_amount}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            target_amount: e.target.value.replace(/[^\d.]/g, '')
                          }))
                        }
                        placeholder="Blank = pay once; set total to pay in installments"
                      />
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                        Each period pays up to Amount until Target is reached (last period may be
                        partial). Leave blank to pay Amount a single time only.
                      </span>
                    </div>
                  ) : null}
                  {mode === 'edit' ? (
                    <div className="field">
                      <label>Status</label>
                      <select
                        value={draft.is_active ? 'active' : 'inactive'}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            is_active: e.target.value === 'active'
                          }))
                        }
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="modal__footer">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !draft.component_id}
                >
                  {saving ? 'Saving…' : mode === 'add' ? 'Create' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
