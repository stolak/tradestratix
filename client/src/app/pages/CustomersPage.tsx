import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

const emptyForm = {
  name: '',
  code: '',
  contact_person: '',
  phone: '',
  email: '',
  city: '',
  customer_type: 'retail',
  payment_terms_days: '0',
  notes: ''
};

export const CustomersPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await api.customers.list(q || undefined));
    } catch (e: any) {
      await alertError('Customers', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      code: form.code || undefined,
      contact_person: form.contact_person || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      city: form.city || undefined,
      customer_type: form.customer_type,
      payment_terms_days: Number(form.payment_terms_days) || 0,
      notes: form.notes || undefined
    };
    try {
      if (editingId) {
        await api.customers.update(editingId, payload);
        await alertSuccess('Customer updated');
      } else {
        await api.customers.create(payload);
        await alertSuccess('Customer created');
      }
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (err: any) {
      await alertError(editingId ? 'Update failed' : 'Create failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
            Customers
          </h1>
          <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
            CRM-lite customer master for credit sales and POS walk-ins.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="field">
            <label>Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / code" />
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Search
          </button>
        </div>
      </header>

      <form
        onSubmit={save}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        {editingId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Editing customer</strong>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
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
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={form.customer_type}
              onChange={(e) => setForm({ ...form, customer_type: e.target.value })}
            >
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="distributor">Distributor</option>
              <option value="walk_in">Walk-in</option>
            </select>
          </div>
          <div className="field">
            <label>Payment terms (days)</label>
            <input
              type="number"
              value={form.payment_terms_days}
              onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Contact</label>
            <input
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>City</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              {editingId ? 'Save changes' : 'Add customer'}
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
              <th>Type</th>
              <th>Phone</th>
              <th>Terms</th>
              <th>Invoices</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.code || '—'}</td>
                <td>{c.name}</td>
                <td>{c.customer_type}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.payment_terms_days}d</td>
                <td>{c._count?.invoices ?? 0}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setEditingId(c.id);
                      setForm({
                        name: c.name || '',
                        code: c.code || '',
                        contact_person: c.contact_person || '',
                        phone: c.phone || '',
                        email: c.email || '',
                        city: c.city || '',
                        customer_type: c.customer_type || 'retail',
                        payment_terms_days: String(c.payment_terms_days ?? 0),
                        notes: c.notes || ''
                      });
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
