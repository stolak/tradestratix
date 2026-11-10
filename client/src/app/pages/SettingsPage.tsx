import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const SettingsPage: React.FC = () => {
  const [form, setForm] = useState<any>(null);

  useEffect(() => {
    api.businesses
      .current()
      .then(setForm)
      .catch((e) => alertError('Settings', e.message));
  }, []);

  if (!form) return <p>Loading business profile…</p>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await api.businesses.update({
        name: form.name,
        legal_name: form.legal_name,
        email: form.email,
        phone: form.phone,
        business_type: form.business_type,
        default_currency: form.default_currency,
        inventory_valuation: form.inventory_valuation,
        city: form.city,
        state: form.state,
        address_line1: form.address_line1
      });
      setForm(updated);
      await alertSuccess('Business updated');
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 820 }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Business settings
        </h1>
      </header>
      <form onSubmit={save} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Business name</label>
            <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Legal name</label>
            <input
              value={form.legal_name || ''}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Business type</label>
            <select
              value={form.business_type || 'hybrid'}
              onChange={(e) => setForm({ ...form, business_type: e.target.value })}
            >
              <option value="distributor">Distributor</option>
              <option value="wholesaler">Wholesaler</option>
              <option value="retailer">Retailer</option>
              <option value="distributor_retailer">Distributor & retailer</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div className="field">
            <label>Default currency</label>
            <input
              value={form.default_currency || 'NGN'}
              onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Inventory valuation</label>
            <select
              value={form.inventory_valuation || 'weighted_average'}
              onChange={(e) => setForm({ ...form, inventory_valuation: e.target.value })}
            >
              <option value="fifo">FIFO</option>
              <option value="weighted_average">Weighted average</option>
              <option value="specific_identification">Specific identification</option>
            </select>
          </div>
          <div className="field">
            <label>City</label>
            <input value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Address</label>
          <input
            value={form.address_line1 || ''}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
          />
        </div>
        <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
          Save settings
        </button>
      </form>
    </div>
  );
};
