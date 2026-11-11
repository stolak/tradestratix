import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

const emptyForm = {
  name: '',
  code: '',
  branch_id: '',
  category: 'main'
};

type StatusFilter = 'all' | 'active' | 'disabled';

export const WarehousesPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchLocked, setBranchLocked] = useState(false);

  const filteredRows = useMemo(() => {
    return rows.filter((w) => {
      if (statusFilter === 'active' && !w.is_active) return false;
      if (statusFilter === 'disabled' && w.is_active) return false;
      if (branchFilter !== 'all' && w.branch_id !== branchFilter && w.branch?.id !== branchFilter) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, branchFilter]);

  const load = async () => {
    try {
      const [w, b] = await Promise.all([api.warehouses.list(), api.branches.list()]);
      setRows(w);
      setBranches(b);
      setForm((f) => (f.branch_id || !b[0] ? f : { ...f, branch_id: b[0].id }));
    } catch (e: any) {
      await alertError('Warehouses', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setBranchLocked(false);
    setForm({
      ...emptyForm,
      branch_id: branches[0]?.id || ''
    });
  };

  const startEdit = (w: any) => {
    const locked = w.can_change_branch === false || w.has_activity === true;
    setEditingId(w.id);
    setBranchLocked(locked);
    setForm({
      name: w.name || '',
      code: w.code || '',
      branch_id: w.branch_id || w.branch?.id || '',
      category: w.category || 'main'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      branch_id: form.branch_id,
      category: form.category
    };
    try {
      if (editingId) {
        const updateBody: Record<string, unknown> = {
          name: payload.name,
          category: payload.category
        };
        if (!branchLocked) {
          updateBody.branch_id = payload.branch_id;
        }
        await api.warehouses.update(editingId, updateBody);
        await alertSuccess('Warehouse updated');
      } else {
        await api.warehouses.create(payload);
        await alertSuccess('Warehouse created');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  const toggleActive = async (w: any) => {
    const enabling = !w.is_active;
    const ok = await confirmAction(
      enabling ? 'Enable warehouse?' : 'Disable warehouse?',
      enabling
        ? `${w.name} will be available for stock operations again.`
        : `${w.name} will be unavailable for new stock moves. History is kept.`
    );
    if (!ok) return;

    setBusyId(w.id);
    try {
      await api.warehouses.update(w.id, { is_active: enabling });
      await alertSuccess(enabling ? 'Warehouse enabled' : 'Warehouse disabled');
      if (editingId === w.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError(enabling ? 'Enable failed' : 'Disable failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (w: any) => {
    const ok = await confirmAction(
      'Delete warehouse?',
      `${w.name} (${w.code}) can only be deleted if it has no stock or transaction history.`
    );
    if (!ok) return;

    setBusyId(w.id);
    try {
      await api.warehouses.remove(w.id);
      await alertSuccess('Warehouse deleted');
      if (editingId === w.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Warehouses
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Branch-linked stock locations with capacity for transfers later.
        </p>
      </header>

      <form onSubmit={save} className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 12 }}>
        {editingId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>Editing warehouse</strong>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          </div>
        ) : null}
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Code</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              disabled={Boolean(editingId)}
              title={editingId ? 'Warehouse code cannot be changed after creation' : undefined}
            />
          </div>
          <div className="field">
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              Branch
              {branchLocked ? (
                <button
                  type="button"
                  aria-label="Why branch is locked"
                  onClick={() =>
                    void Swal.fire({
                      icon: 'info',
                      title: 'Branch locked',
                      text: 'Branch cannot be changed because this warehouse already has stock or transaction history.',
                      confirmButtonColor: '#0f5c4c'
                    })
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    margin: 0,
                    color: 'var(--ink-muted)',
                    cursor: 'pointer'
                  }}
                >
                  <Info size={15} />
                </button>
              ) : null}
            </label>
            <select
              value={form.branch_id}
              onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
              required
              disabled={branchLocked}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="main">Main</option>
              <option value="retail">Retail</option>
              <option value="damaged">Damaged</option>
              <option value="quarantine">Quarantine</option>
            </select>
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Save changes' : 'Add warehouse'}
            </button>
          </div>
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.75rem 0 0.5rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'end',
            gap: 12,
            padding: '0 1rem 0.75rem'
          }}
        >
          <div className="form-grid" style={{ flex: 1, minWidth: 0 }}>
            <div className="field">
              <label htmlFor="wh-status-filter">Status</label>
              <select
                id="wh-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="wh-branch-filter">Branch</label>
              <select
                id="wh-branch-filter"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
              >
                <option value="all">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            {filteredRows.length} of {rows.length}
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>S/N</th>
                <th>Code</th>
                <th>Name</th>
                <th>Branch</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((w, index) => {
                const busy = busyId === w.id;
                return (
                  <tr
                    key={w.id}
                    style={{
                      background: editingId === w.id ? 'rgba(15,92,76,0.06)' : undefined,
                      opacity: w.is_active ? 1 : 0.72
                    }}
                  >
                    <td>{index + 1}</td>
                    <td>{w.code}</td>
                    <td>{w.name}</td>
                    <td>{w.branch?.code || '—'}</td>
                    <td>{w.category}</td>
                    <td>{w.is_active ? 'Active' : 'Disabled'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => startEdit(w)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void toggleActive(w)}
                        >
                          {w.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void remove(w)}
                          style={{ color: 'var(--danger)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--ink-muted)', padding: '1rem' }}>
                    No warehouses match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
