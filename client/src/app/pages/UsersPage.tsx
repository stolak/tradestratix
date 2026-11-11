import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

const emptyForm = {
  username: '',
  full_name: '',
  role: 'cashier',
  password: 'password123',
  email: '',
  branch_ids: [] as string[],
  warehouse_ids: [] as string[],
  default_branch_id: ''
};

export const UsersPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const selectableWarehouses = useMemo(
    () =>
      warehouses.filter(
        (w) =>
          w.is_active !== false &&
          form.branch_ids.includes(w.branch_id || w.branch?.id)
      ),
    [warehouses, form.branch_ids]
  );

  const load = async () => {
    try {
      const [u, r, b, w] = await Promise.all([
        api.users.list(),
        api.rbac.roles(),
        api.branches.list(),
        api.warehouses.list()
      ]);
      setRows(u);
      setRoles(r);
      setBranches(b.filter((x: any) => x.is_active !== false));
      setWarehouses(w);
      setForm((f) => ({
        ...f,
        role: f.role || r.find((x: any) => x.code === 'cashier')?.code || r[0]?.code || 'cashier'
      }));
    } catch (e: any) {
      await alertError('Users', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      role: roles.find((x) => x.code === 'cashier')?.code || roles[0]?.code || 'cashier'
    });
  };

  const toggleId = (key: 'branch_ids' | 'warehouse_ids', id: string) => {
    setForm((f) => {
      const has = f[key].includes(id);
      const next = has ? f[key].filter((x) => x !== id) : [...f[key], id];
      if (key === 'branch_ids') {
        const allowedWh = warehouses
          .filter((w) => next.includes(w.branch_id || w.branch?.id))
          .map((w) => w.id);
        const warehouse_ids = f.warehouse_ids.filter((wid) => allowedWh.includes(wid));
        const default_branch_id = next.includes(f.default_branch_id)
          ? f.default_branch_id
          : next[0] || '';
        return { ...f, branch_ids: next, warehouse_ids, default_branch_id };
      }
      return { ...f, [key]: next };
    });
  };

  const startEdit = (u: any) => {
    const branch_ids = (u.user_branches || [])
      .map((ub: any) => ub.branch_id || ub.branch?.id)
      .filter(Boolean);
    const warehouse_ids = (u.user_warehouses || [])
      .map((uw: any) => uw.warehouse_id || uw.warehouse?.id)
      .filter(Boolean);
    setEditingId(u.id);
    setForm({
      username: u.username || '',
      full_name: u.full_name || '',
      role: u.role || 'cashier',
      password: '',
      email: u.email || '',
      branch_ids,
      warehouse_ids,
      default_branch_id: u.default_branch_id || u.default_branch?.id || branch_ids[0] || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.branch_ids.length) {
      await alertError('Branches required', 'Assign at least one branch to the user.');
      return;
    }

    const payload: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      role: form.role,
      email: form.email.trim() || undefined,
      branch_ids: form.branch_ids,
      warehouse_ids: form.warehouse_ids,
      default_branch_id: form.default_branch_id || form.branch_ids[0]
    };

    try {
      if (editingId) {
        if (form.password.trim()) payload.password = form.password.trim();
        await api.users.update(editingId, payload);
        await alertSuccess('User updated');
      } else {
        await api.users.create({
          ...payload,
          username: form.username.trim(),
          password: form.password
        });
        await alertSuccess('User created');
      }
      resetForm();
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  const branchLabel = (u: any) => {
    const list = (u.user_branches || [])
      .map((ub: any) => ub.branch?.code || ub.branch_id)
      .filter(Boolean);
    return list.length ? list.join(', ') : '—';
  };

  const warehouseLabel = (u: any) => {
    const list = (u.user_warehouses || [])
      .map((uw: any) => uw.warehouse?.code || uw.warehouse_id)
      .filter(Boolean);
    return list.length ? list.join(', ') : '—';
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0 }}>
          Users
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Assign branch and warehouse access for each user.
        </p>
      </header>

      <form onSubmit={save} className="card-surface" style={{ padding: '1rem', display: 'grid', gap: 12 }}>
        {editingId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <strong>Editing user</strong>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          </div>
        ) : null}

        <div className="form-grid">
          <div className="field">
            <label>Username</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required={!editingId}
              disabled={Boolean(editingId)}
              title={editingId ? 'Username cannot be changed' : undefined}
            />
          </div>
          <div className="field">
            <label>Full name</label>
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Email</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{editingId ? 'New password (optional)' : 'Password'}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editingId}
              placeholder={editingId ? 'Leave blank to keep current' : undefined}
            />
          </div>
          <div className="field">
            <label>Default branch</label>
            <select
              value={form.default_branch_id}
              onChange={(e) => setForm({ ...form, default_branch_id: e.target.value })}
              required={form.branch_ids.length > 0}
              disabled={!form.branch_ids.length}
            >
              {!form.branch_ids.length ? <option value="">Select branches first</option> : null}
              {branches
                .filter((b) => form.branch_ids.includes(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Branches</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 8,
                padding: '0.75rem',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.55)'
              }}
            >
              {branches.map((b) => (
                <label
                  key={b.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}
                >
                  <input
                    type="checkbox"
                    checked={form.branch_ids.includes(b.id)}
                    onChange={() => toggleId('branch_ids', b.id)}
                  />
                  <span>
                    {b.code} — {b.name}
                  </span>
                </label>
              ))}
              {!branches.length ? (
                <span style={{ color: 'var(--ink-muted)' }}>No active branches available.</span>
              ) : null}
            </div>
          </div>

          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Warehouses</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 8,
                padding: '0.75rem',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.55)'
              }}
            >
              {!form.branch_ids.length ? (
                <span style={{ color: 'var(--ink-muted)' }}>
                  Select one or more branches to assign warehouses.
                </span>
              ) : !selectableWarehouses.length ? (
                <span style={{ color: 'var(--ink-muted)' }}>
                  No warehouses found for the selected branches.
                </span>
              ) : (
                selectableWarehouses.map((w) => {
                  const branchCode =
                    branches.find((b) => b.id === (w.branch_id || w.branch?.id))?.code ||
                    w.branch?.code ||
                    '—';
                  return (
                    <label
                      key={w.id}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}
                    >
                      <input
                        type="checkbox"
                        checked={form.warehouse_ids.includes(w.id)}
                        onChange={() => toggleId('warehouse_ids', w.id)}
                      />
                      <span>
                        {w.code} — {w.name}{' '}
                        <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>
                          ({branchCode})
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="form-grid--actions">
          <button className="btn btn-primary" type="submit">
            {editingId ? 'Save changes' : 'Add user'}
          </button>
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>S/N</th>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Branches</th>
                <th>Warehouses</th>
                <th>Email</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, index) => (
                <tr
                  key={u.id}
                  style={{
                    background: editingId === u.id ? 'rgba(15,92,76,0.06)' : undefined
                  }}
                >
                  <td>{index + 1}</td>
                  <td>{u.username}</td>
                  <td>{u.full_name}</td>
                  <td>{u.role}</td>
                  <td>{branchLabel(u)}</td>
                  <td>{warehouseLabel(u)}</td>
                  <td>{u.email || '—'}</td>
                  <td>{u.status}</td>
                  <td>
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(u)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--ink-muted)', padding: '1rem' }}>
                    No users yet.
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
