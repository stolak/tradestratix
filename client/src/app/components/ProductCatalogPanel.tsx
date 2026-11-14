import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess, confirmAction } from '../utils/alerts';

type Kind = 'categories' | 'brands' | 'makes';

const KIND_LABEL: Record<Kind, string> = {
  categories: 'Categories',
  brands: 'Brands',
  makes: 'Makes'
};

const emptyForm = { name: '', code: '', description: '' };

export const ProductCatalogPanel: React.FC = () => {
  const [kind, setKind] = useState<Kind>('categories');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (k = kind) => {
    try {
      const data =
        k === 'categories'
          ? await api.products.categories()
          : k === 'brands'
            ? await api.products.brands()
            : await api.products.makes();
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
    setForm(emptyForm);
  };

  const startEdit = (row: any) => {
    setEditingId(row.id);
    setForm({
      name: row.name || '',
      code: row.code || '',
      description: row.description || ''
    });
  };

  const save = async (e: React.FormEvent) => {
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

      <form
        onSubmit={save}
        className="card-surface"
        style={{ padding: '1rem', display: 'grid', gap: 12 }}
      >
        <div style={{ fontWeight: 700 }}>
          {editingId ? `Edit ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}` : `New ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}`}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
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
                      <button type="button" className="btn btn-ghost" onClick={() => startEdit(row)}>
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
    </div>
  );
};
