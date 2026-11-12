import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import Swal from 'sweetalert2';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

const emptyForm = {
  name: '',
  code: '',
  branch_id: '',
  category_id: ''
};

const emptyCategoryForm = {
  name: '',
  code: '',
  allow_inter_branch_transfer: true,
  allow_inter_branch_pickup: true
};

type StatusFilter = 'all' | 'active' | 'disabled';
type Tab = 'warehouses' | 'categories';

export const WarehousesPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('warehouses');
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [branchLocked, setBranchLocked] = useState(false);

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active !== false),
    [categories]
  );

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
      const [w, b, c] = await Promise.all([
        api.warehouses.list(undefined, { includeInactive: true, allBranches: true }),
        api.branches.list(),
        api.warehouses.categories()
      ]);
      setRows(w);
      setBranches(b);
      setCategories(c);
      setForm((f) => {
        const branchId = f.branch_id || b[0]?.id || '';
        const categoryId =
          f.category_id ||
          c.find((x: any) => x.code === 'main' && x.is_active !== false)?.id ||
          c.find((x: any) => x.is_active !== false)?.id ||
          '';
        return { ...f, branch_id: branchId, category_id: categoryId };
      });
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
      branch_id: branches[0]?.id || '',
      category_id:
        activeCategories.find((c) => c.code === 'main')?.id || activeCategories[0]?.id || ''
    });
  };

  const resetCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
  };

  const startEdit = (w: any) => {
    const locked = w.can_change_branch === false || w.has_activity === true;
    setEditingId(w.id);
    setBranchLocked(locked);
    setForm({
      name: w.name || '',
      code: w.code || '',
      branch_id: w.branch_id || w.branch?.id || '',
      category_id: w.category_id || w.warehouse_category?.id || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startEditCategory = (c: any) => {
    setEditingCategoryId(c.id);
    setCategoryForm({
      name: c.name || '',
      code: c.code || '',
      allow_inter_branch_transfer: c.allow_inter_branch_transfer !== false,
      allow_inter_branch_pickup: c.allow_inter_branch_pickup !== false
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      branch_id: form.branch_id,
      category_id: form.category_id
    };
    try {
      if (editingId) {
        const updateBody: Record<string, unknown> = {
          name: payload.name,
          category_id: payload.category_id
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

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: categoryForm.name.trim(),
      code: categoryForm.code.trim(),
      allow_inter_branch_transfer: categoryForm.allow_inter_branch_transfer,
      allow_inter_branch_pickup: categoryForm.allow_inter_branch_pickup
    };
    try {
      if (editingCategoryId) {
        await api.warehouses.updateCategory(editingCategoryId, payload);
        await alertSuccess('Category updated');
      } else {
        await api.warehouses.createCategory(payload);
        await alertSuccess('Category created');
      }
      resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError(editingCategoryId ? 'Update failed' : 'Create failed', err.message);
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

  const toggleCategoryActive = async (c: any) => {
    const enabling = !c.is_active;
    if (!enabling && Number(c.active_warehouse_count || 0) > 0) {
      await alertError(
        'Cannot disable',
        'Disable or reassign all active warehouses in this category first.'
      );
      return;
    }
    const ok = await confirmAction(
      enabling ? 'Enable category?' : 'Disable category?',
      enabling
        ? `${c.name} will be available when creating warehouses.`
        : `${c.name} will not be selectable for new warehouses.`
    );
    if (!ok) return;

    setBusyId(c.id);
    try {
      await api.warehouses.updateCategory(c.id, { is_active: enabling });
      await alertSuccess(enabling ? 'Category enabled' : 'Category disabled');
      if (editingCategoryId === c.id) resetCategoryForm();
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

  const removeCategory = async (c: any) => {
    if (Number(c.warehouse_count || 0) > 0) {
      await alertError(
        'Cannot delete',
        'Reassign or delete warehouses attached to this category first.'
      );
      return;
    }
    const ok = await confirmAction(
      'Delete category?',
      `${c.name} (${c.code}) will be permanently removed.`
    );
    if (!ok) return;

    setBusyId(c.id);
    try {
      await api.warehouses.removeCategory(c.id);
      await alertSuccess('Category deleted');
      if (editingCategoryId === c.id) resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const categoryLabel = (w: any) =>
    w.warehouse_category?.name || w.category || '—';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'warehouses', label: 'Warehouses' },
    { id: 'categories', label: 'Categories' }
  ];

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Warehouses
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Branch-linked stock locations and categories that control inter-branch moves.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
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

      {tab === 'warehouses' ? (
        <>
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
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  required
                >
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  {editingId &&
                  form.category_id &&
                  !activeCategories.some((c) => c.id === form.category_id) ? (
                    <option value={form.category_id}>
                      {categoryLabel(rows.find((r) => r.id === editingId) || {})} (inactive)
                    </option>
                  ) : null}
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
                        <td>{categoryLabel(w)}</td>
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
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <form
            onSubmit={saveCategory}
            className="card-surface"
            style={{ padding: '1rem', display: 'grid', gap: 12 }}
          >
            {editingCategoryId ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>Editing category</strong>
                <button type="button" className="btn btn-ghost" onClick={resetCategoryForm}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ fontWeight: 700 }}>Add category</div>
            )}
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Code</label>
                <input
                  value={categoryForm.code}
                  onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })}
                  required
                />
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    marginBottom: 10
                  }}
                >
                  <input
                    type="checkbox"
                    checked={categoryForm.allow_inter_branch_transfer}
                    onChange={(e) =>
                      setCategoryForm({
                        ...categoryForm,
                        allow_inter_branch_transfer: e.target.checked
                      })
                    }
                  />
                  Allow inter-branch transfer
                </label>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    marginBottom: 10
                  }}
                >
                  <input
                    type="checkbox"
                    checked={categoryForm.allow_inter_branch_pickup}
                    onChange={(e) =>
                      setCategoryForm({
                        ...categoryForm,
                        allow_inter_branch_pickup: e.target.checked
                      })
                    }
                  />
                  Allow inter-branch pickup
                </label>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  {editingCategoryId ? 'Save changes' : 'Add category'}
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>S/N</th>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Inter-branch transfer</th>
                    <th>Inter-branch pickup</th>
                    <th>Warehouses</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c, index) => {
                    const busy = busyId === c.id;
                    const canDelete = Number(c.warehouse_count || 0) === 0;
                    const canDisable = Number(c.active_warehouse_count || 0) === 0;
                    return (
                      <tr
                        key={c.id}
                        style={{
                          background:
                            editingCategoryId === c.id ? 'rgba(15,92,76,0.06)' : undefined,
                          opacity: c.is_active ? 1 : 0.72
                        }}
                      >
                        <td>{index + 1}</td>
                        <td>{c.code}</td>
                        <td>{c.name}</td>
                        <td>{c.allow_inter_branch_transfer ? 'Yes' : 'No'}</td>
                        <td>{c.allow_inter_branch_pickup ? 'Yes' : 'No'}</td>
                        <td>
                          {c.warehouse_count ?? 0}
                          {Number(c.active_warehouse_count || 0) > 0
                            ? ` (${c.active_warehouse_count} active)`
                            : ''}
                        </td>
                        <td>{c.is_active ? 'Active' : 'Disabled'}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy}
                              onClick={() => startEditCategory(c)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy || (!c.is_active ? false : !canDisable)}
                              title={
                                c.is_active && !canDisable
                                  ? 'Disable active warehouses in this category first'
                                  : undefined
                              }
                              onClick={() => void toggleCategoryActive(c)}
                            >
                              {c.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busy || !canDelete}
                              title={
                                !canDelete
                                  ? 'Remove or reassign attached warehouses first'
                                  : undefined
                              }
                              onClick={() => void removeCategory(c)}
                              style={{ color: 'var(--danger)' }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!categories.length ? (
                    <tr>
                      <td colSpan={8} style={{ color: 'var(--ink-muted)', padding: '1rem' }}>
                        No categories yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
