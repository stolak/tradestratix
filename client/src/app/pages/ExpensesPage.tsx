import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const ExpensesPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [form, setForm] = useState({
    vendor_name: '',
    account_id: '',
    amount: '',
    description: '',
    pay_method: 'cash',
    bank_account_id: '',
    pay_now: true
  });

  const load = async () => {
    try {
      const [e, gl, b] = await Promise.all([
        api.expenses.list(),
        api.accounting.accounts(),
        api.banking.accounts()
      ]);
      setRows(e);
      const expenseGl = gl.filter(
        (a: any) => a.account_type === 'expense' || a.code?.startsWith('6')
      );
      setGlAccounts(expenseGl.length ? expenseGl : gl);
      setBanks(b);
      const def =
        expenseGl.find((a: any) => a.code === '6400') ||
        expenseGl[0] ||
        gl.find((a: any) => a.code === '6400');
      setForm((f) => ({
        ...f,
        account_id: f.account_id || def?.id || '',
        bank_account_id: f.bank_account_id || b[0]?.id || ''
      }));
    } catch (err: any) {
      await alertError('Expenses', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.expenses.create({
        vendor_name: form.vendor_name || undefined,
        pay_method: form.pay_method,
        bank_account_id:
          form.pay_method === 'bank' ? form.bank_account_id || undefined : undefined,
        pay_now: form.pay_method !== 'ap',
        post: true,
        lines: [
          {
            account_id: form.account_id,
            amount: Number(form.amount),
            description: form.description || undefined
          }
        ]
      });
      await alertSuccess(form.pay_method === 'ap' ? 'Expense posted to AP' : 'Expense paid');
      setForm((f) => ({ ...f, vendor_name: '', amount: '', description: '' }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const post = async (id: string, payNow: boolean) => {
    try {
      await api.expenses.post(id, { pay_now: payNow });
      await alertSuccess(payNow ? 'Expense posted & paid' : 'Expense posted to AP');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const pay = async (id: string) => {
    try {
      await api.expenses.pay(id, { method: 'cash' });
      await alertSuccess('Expense paid');
      await load();
    } catch (err: any) {
      await alertError('Pay failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Expenses
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Operating expenses to GL — pay now (cash/bank) or on account (AP).
        </p>
      </header>

      <form
        onSubmit={create}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div style={{ fontWeight: 700 }}>New expense</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div className="field">
            <label>Vendor</label>
            <input
              value={form.vendor_name}
              onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="field">
            <label>Expense account</label>
            <select
              value={form.account_id}
              onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              required
            >
              {glAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              min="0.01"
              step="any"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Settlement</label>
            <select
              value={form.pay_method}
              onChange={(e) => setForm({ ...form, pay_method: e.target.value })}
            >
              <option value="cash">Pay now — cash</option>
              <option value="bank">Pay now — bank</option>
              <option value="ap">On account (AP)</option>
            </select>
          </div>
          {form.pay_method === 'bank' ? (
            <div className="field">
              <label>Bank account</label>
              <select
                value={form.bank_account_id}
                onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <button className="btn btn-primary" type="submit" style={{ justifySelf: 'start' }}>
          {form.pay_method === 'ap' ? 'Create & post to AP' : 'Create & pay'}
        </button>
      </form>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Expense #</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.expense_number}</td>
                <td>{r.vendor_name || r.supplier?.name || '—'}</td>
                <td>{r.status}</td>
                <td>{r.payment_status}</td>
                <td>{Number(r.total_amount).toLocaleString()}</td>
                <td>{Number(r.balance).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.status === 'draft' ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void post(r.id, true)}
                        >
                          Post & pay
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void post(r.id, false)}
                        >
                          Post to AP
                        </button>
                      </>
                    ) : null}
                    {r.status === 'posted' && Number(r.balance) > 0 ? (
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
          </tbody>
        </table>
      </div>
    </div>
  );
};
