import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const UnitsOfMeasurePage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({
    code: '',
    name: '',
    unit_category: 'Count',
    allows_decimal: false
  });

  const load = () =>
    api.uoms
      .list()
      .then(setRows)
      .catch((e) => alertError('Units', e.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.uoms.create(form);
      setForm({ code: '', name: '', unit_category: 'Count', allows_decimal: false });
      await alertSuccess('Unit created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Units of measure
        </h1>
      </header>
      <form onSubmit={create} className="card-surface" style={{ padding: '1rem' }}>
        <div className="form-grid">
          <div className="field">
            <label>Code</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </div>
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              value={form.unit_category}
              onChange={(e) => setForm({ ...form, unit_category: e.target.value })}
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
              value={form.allows_decimal ? '1' : '0'}
              onChange={(e) => setForm({ ...form, allows_decimal: e.target.value === '1' })}
            >
              <option value="0">No</option>
              <option value="1">Yes</option>
            </select>
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              Add
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
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
