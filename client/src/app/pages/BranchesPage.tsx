import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

const emptyForm = { name: '', code: '', city: '' };

type StatusFilter = 'all' | 'active' | 'disabled';

export const BranchesPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredRows = rows.filter((b) => {
    if (statusFilter === 'active') return Boolean(b.is_active);
    if (statusFilter === 'disabled') return !b.is_active;
    return true;
  });

  const load = () =>
    api.branches
      .list()
      .then(setRows)
      .catch((e) => alertError('Branches', e.message));

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const startEdit = (b: any) => {
    setEditingId(b.id);
    setForm({
      name: b.name || '',
      code: b.code || '',
      city: b.city || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      city: form.city.trim() || undefined
    };
    try {
      if (editingId) {
        await api.branches.update(editingId, payload);
        await alertSuccess('Branch updated');
      } else {
        await api.branches.create(payload);
        await alertSuccess('Branch created');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  const toggleActive = async (b: any) => {
    const enabling = !b.is_active;
    const ok = await confirmAction(
      enabling ? 'Enable branch?' : 'Disable branch?',
      enabling
        ? `${b.name} will be available for operations again.`
        : `${b.name} will be unavailable for new transactions. Existing history is kept.`
    );
    if (!ok) return;

    setBusyId(b.id);
    try {
      if (enabling) {
        await api.branches.activate(b.id);
        await alertSuccess('Branch enabled');
      } else {
        await api.branches.deactivate(b.id);
        await alertSuccess('Branch disabled');
      }
      if (editingId === b.id) resetForm();
      await load();
    } catch (err: any) {
      await alertError(enabling ? 'Enable failed' : 'Disable failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (b: any) => {
    const ok = await confirmAction(
      'Delete branch?',
      `${b.name} (${b.code}) can only be deleted if it has no transactions. This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(b.id);
    try {
      await api.branches.remove(b.id);
      await alertSuccess('Branch deleted');
      if (editingId === b.id) resetForm();
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
          Branches
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Multi-outlet structure for your business tenant.
        </p>
      </header>

      <form onSubmit={save} className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 12 }}>
        {editingId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>Editing branch</strong>
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
              title={editingId ? 'Branch code cannot be changed after creation' : undefined}
            />
          </div>
          <div className="field">
            <label>City</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Save changes' : 'Add branch'}
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
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="branch-status-filter">Status</label>
            <select
              id="branch-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
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
                <th>City</th>
                <th>Warehouses</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((b, index) => {
                const busy = busyId === b.id;
                return (
                  <tr
                    key={b.id}
                    style={{
                      background: editingId === b.id ? 'rgba(15,92,76,0.06)' : undefined,
                      opacity: b.is_active ? 1 : 0.72
                    }}
                  >
                    <td>{index + 1}</td>
                    <td>{b.code}</td>
                    <td>{b.name}</td>
                    <td>{b.city || '—'}</td>
                    <td>{b.warehouses?.length ?? 0}</td>
                    <td>{b.is_active ? 'Active' : 'Disabled'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => startEdit(b)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void toggleActive(b)}
                        >
                          {b.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => void remove(b)}
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
                    No branches match this status filter.
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
