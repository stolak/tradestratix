import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const BranchesPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [city, setCity] = useState('');

  const load = () =>
    api.branches
      .list()
      .then(setRows)
      .catch((e) => alertError('Branches', e.message));

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.branches.create({ name, code, city });
      setName('');
      setCode('');
      setCity('');
      await alertSuccess('Branch created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Branches
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Multi-outlet structure for your business tenant.
        </p>
      </header>

      <form
        onSubmit={create}
        className="card-surface"
        style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12 }}
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
          <label>City</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button className="btn btn-primary" type="submit">
            Add branch
          </button>
        </div>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>City</th>
              <th>Warehouses</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td>{b.name}</td>
                <td>{b.city || '—'}</td>
                <td>{b.warehouses?.length ?? 0}</td>
                <td>{b.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
