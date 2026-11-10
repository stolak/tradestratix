import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const WarehousesPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState('');
  const [category, setCategory] = useState('main');

  const load = async () => {
    try {
      const [w, b] = await Promise.all([api.warehouses.list(), api.branches.list()]);
      setRows(w);
      setBranches(b);
      if (!branchId && b[0]) setBranchId(b[0].id);
    } catch (e: any) {
      await alertError('Warehouses', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.warehouses.create({ name, code, branch_id: branchId, category });
      setName('');
      setCode('');
      await alertSuccess('Warehouse created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Warehouses
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Branch-linked stock locations with capacity for transfers later.
        </p>
      </header>

      <form
        onSubmit={create}
        className="card-surface"
        style={{
          padding: '1rem',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
          gap: 12
        }}
      >
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div className="field">
          <label>Branch</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="main">Main</option>
            <option value="retail">Retail</option>
            <option value="damaged">Damaged</option>
            <option value="quarantine">Quarantine</option>
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn btn-primary" type="submit">
            Add warehouse
          </button>
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Branch</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td>{w.code}</td>
                <td>{w.name}</td>
                <td>{w.branch?.code || '—'}</td>
                <td>{w.category}</td>
                <td>{w.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
