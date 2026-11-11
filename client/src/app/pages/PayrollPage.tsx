import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
    pay_date: end.toISOString().slice(0, 10)
  };
}

export const PayrollPage: React.FC = () => {
  const [runs, setRuns] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [form, setForm] = useState(monthBounds());
  const [payMethod, setPayMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState('');

  const load = async () => {
    try {
      const [r, b] = await Promise.all([api.payroll.runs(), api.banking.accounts()]);
      setRuns(r);
      setBanks(b);
      setBankAccountId((id) => id || b[0]?.id || '');
    } catch (err: any) {
      await alertError('Payroll', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createRun = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.payroll.createRun({
        period_start: form.period_start,
        period_end: form.period_end,
        pay_date: form.pay_date
      });
      await alertSuccess('Payroll run created');
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const post = async (id: string) => {
    try {
      await api.payroll.postRun(id);
      await alertSuccess('Payroll posted to GL');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const pay = async (id: string) => {
    try {
      await api.payroll.payRun(id, {
        method: payMethod,
        bank_account_id: payMethod === 'bank' ? bankAccountId || undefined : undefined
      });
      await alertSuccess('Payroll paid');
      await load();
    } catch (err: any) {
      await alertError('Pay failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Payroll
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Create runs from active employees, post salary journals, then pay.
        </p>
      </header>

      <form
        onSubmit={createRun}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div style={{ fontWeight: 700 }}>New payroll run</div>
        <div className="form-grid">
          <div className="field">
            <label>Period start</label>
            <input
              type="date"
              value={form.period_start}
              onChange={(e) => setForm({ ...form, period_start: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Period end</label>
            <input
              type="date"
              value={form.period_end}
              onChange={(e) => setForm({ ...form, period_end: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Pay date</label>
            <input
              type="date"
              value={form.pay_date}
              onChange={(e) => setForm({ ...form, pay_date: e.target.value })}
              required
            />
          </div>
          <div className="form-grid--actions">
            <button className="btn btn-primary" type="submit">
              Create run
            </button>
          </div>
        </div>
      </form>

      <div className="card-surface form-grid" style={{ padding: '1rem 1.25rem' }}>
        <div className="field">
          <label>Pay method (for Pay action)</label>
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        {payMethod === 'bank' ? (
          <div className="field">
            <label>Bank account</label>
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
          <thead>
            <tr>
              <th>Run #</th>
              <th>Period</th>
              <th>Status</th>
              <th>Gross</th>
              <th>Deductions</th>
              <th>Net</th>
              <th>Paid</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.run_number}</td>
                <td>
                  {String(r.period_start).slice(0, 10)} → {String(r.period_end).slice(0, 10)}
                </td>
                <td>{r.status}</td>
                <td>{Number(r.total_gross).toLocaleString()}</td>
                <td>{Number(r.total_deductions).toLocaleString()}</td>
                <td>{Number(r.total_net).toLocaleString()}</td>
                <td>{r.payment_journal_entry_id ? 'Yes' : 'No'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.status === 'draft' ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void post(r.id)}
                      >
                        Post
                      </button>
                    ) : null}
                    {r.status === 'posted' && !r.payment_journal_entry_id ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void pay(r.id)}
                      >
                        Pay
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!runs.length ? (
              <tr>
                <td colSpan={8}>No payroll runs yet</td>
              </tr>
            ) : null}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
