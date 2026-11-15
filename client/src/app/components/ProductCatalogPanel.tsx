import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

type Kind = 'categories' | 'brands' | 'makes' | 'units';

const KIND_LABEL: Record<Kind, string> = {
  categories: 'Categories',
  brands: 'Brands',
  makes: 'Makes',
  units: 'Units'
};

const emptyCatalogForm = { name: '', code: '', description: '' };
const emptyUnitForm = {
  code: '',
  name: '',
  unit_category: 'Count',
  allows_decimal: false
};

type ProductCatalogPanelProps = {
  initialKind?: Kind;
};

export const ProductCatalogPanel: React.FC<ProductCatalogPanelProps> = ({
  initialKind = 'categories'
}) => {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState(emptyCatalogForm);
  const [unitForm, setUnitForm] = useState(emptyUnitForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKind(initialKind);
  }, [initialKind]);

  const load = async (k = kind) => {
    try {
      const data =
        k === 'categories'
          ? await api.products.categories()
          : k === 'brands'
            ? await api.products.brands()
            : k === 'makes'
              ? await api.products.makes()
              : await api.uoms.list();
      setRows(data);
    } catch (err: any) {
      await alertError(KIND_LABEL[k], err.message);
    }
  };

  useEffect(() => {
    void load(kind);
  }, [kind]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyCatalogForm);
    setUnitForm(emptyUnitForm);
  };

  const startEdit = (row: any) => {
    setEditingId(row.id);
    setForm({
      name: row.name || '',
      code: row.code || '',
      description: row.description || ''
    });
  };

  const saveCatalog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      await alertError('Name required');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        description: form.description.trim() || undefined
      };
      if (editingId) {
        if (kind === 'categories') await api.products.updateCategory(editingId, body);
        else if (kind === 'brands') await api.products.updateBrand(editingId, body);
        else await api.products.updateMake(editingId, body);
        await alertSuccess('Updated');
      } else {
        if (kind === 'categories') await api.products.createCategory(body);
        else if (kind === 'brands') await api.products.createBrand(body);
        else await api.products.createMake(body);
        await alertSuccess('Created');
      }
      reset();
      await load();
    } catch (err: any) {
      await alertError('Save failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.uoms.create({
        code: unitForm.code.trim(),
        name: unitForm.name.trim(),
        unit_category: unitForm.unit_category,
        allows_decimal: unitForm.allows_decimal
      });
      setUnitForm(emptyUnitForm);
      await alertSuccess('Unit created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: any) => {
    const next = !row.is_active;
    if (!next && !row.can_disable) {
      await alertError(
        'Cannot disable',
        `${row.active_product_count || 0} active product(s) still use this ${kind.slice(0, -1)}.`
      );
      return;
    }
    try {
      if (kind === 'categories') await api.products.updateCategory(row.id, { is_active: next });
      else if (kind === 'brands') await api.products.updateBrand(row.id, { is_active: next });
      else await api.products.updateMake(row.id, { is_active: next });
      await alertSuccess(next ? 'Enabled' : 'Disabled');
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  const remove = async (row: any) => {
    if (!row.can_delete) {
      await alertError(
        'Cannot delete',
        'Products still use this record. Disable it instead of deleting.'
      );
      return;
    }
    const ok = await confirmAction(
      `Delete ${row.name}?`,
      'This permanently removes the catalog entry.'
    );
    if (!ok) return;
    try {
      if (kind === 'categories') await api.products.deleteCategory(row.id);
      else if (kind === 'brands') await api.products.deleteBrand(row.id);
      else await api.products.deleteMake(row.id);
      await alertSuccess('Deleted');
      if (editingId === row.id) reset();
      await load();
    } catch (err: any) {
      await alertError('Delete failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`btn ${kind === k ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              setKind(k);
              reset();
            }}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {kind === 'units' ? (
        <>
          <form
            onSubmit={saveUnit}
            className="card-surface"
            style={{ padding: '1rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New unit of measure</div>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div className="field">
                <label>Code</label>
                <input
                  value={unitForm.code}
                  onChange={(e) => setUnitForm({ ...unitForm, code: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Name</label>
                <input
                  value={unitForm.name}
                  onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={unitForm.unit_category}
                  onChange={(e) => setUnitForm({ ...unitForm, unit_category: e.target.value })}
                >
                  <option>Count</option>
                  <option>Packaging</option>
                  <option>Weight</option>
                  <option>Volume</option>
                  <option>Length</option>
                </select>
              </div>
              <div className="field">
                <label>Allows decimal</label>
                <select
                  value={unitForm.allows_decimal ? '1' : '0'}
                  onChange={(e) =>
                    setUnitForm({ ...unitForm, allows_decimal: e.target.value === '1' })
                  }
                >
                  <option value="0">No</option>
                  <option value="1">Yes</option>
                </select>
              </div>
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Add unit'}
              </button>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Decimal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td>{u.code}</td>
                      <td>{u.name}</td>
                      <td>{u.unit_category}</td>
                      <td>{u.allows_decimal ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={4} style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>
                        No units yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <form
            onSubmit={saveCatalog}
            className="card-surface"
            style={{ padding: '1rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>
              {editingId
                ? `Edit ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}`
                : `New ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}`}
            </div>
            <div
              className="form-grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
            >
              <div className="field">
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Code (optional)</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Description (optional)</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create'}
              </button>
              {editingId ? (
                <button type="button" className="btn btn-ghost" onClick={reset}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th className="num">Products</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} style={{ opacity: row.is_active === false ? 0.55 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.name}</div>
                        {row.description ? (
                          <div style={{ color: 'var(--ink-muted)', fontSize: '0.75rem' }}>
                            {row.description}
                          </div>
                        ) : null}
                      </td>
                      <td>{row.code || '—'}</td>
                      <td>{row.is_active === false ? 'Disabled' : 'Active'}</td>
                      <td className="num">
                        {row.product_count ?? 0}
                        {row.active_product_count != null &&
                        row.active_product_count !== row.product_count
                          ? ` (${row.active_product_count} active)`
                          : ''}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void toggleActive(row)}
                            title={
                              !row.can_disable && row.is_active
                                ? 'Disable blocked while active products are attached'
                                : undefined
                            }
                          >
                            {row.is_active === false ? 'Enable' : 'Disable'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={!row.can_delete}
                            onClick={() => void remove(row)}
                            title={
                              !row.can_delete
                                ? 'Delete blocked while products are attached'
                                : undefined
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--ink-muted)', textAlign: 'center' }}>
                        No {KIND_LABEL[kind].toLowerCase()} yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
