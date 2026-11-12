import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { SalesRepCustodyFinance } from '../components/SalesRepCustodyFinance';

type Tab = 'accounts' | 'move' | 'custody' | 'transactions';

function initialBankingTab(): Tab {
  try {
    const pref = sessionStorage.getItem('banking_tab');
    if (pref === 'custody' || pref === 'move' || pref === 'transactions' || pref === 'accounts') {
      sessionStorage.removeItem('banking_tab');
      return pref;
    }
  } catch {
    /* ignore */
  }
  return 'accounts';
}

export const BankingPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>(initialBankingTab);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [txns, setTxns] = useState<any[]>([]);
  const [acctForm, setAcctForm] = useState({
    name: '',
    bank_name: '',
    account_number: '',
    gl_account_id: ''
  });
  const [moveForm, setMoveForm] = useState({
    type: 'deposit',
    bank_account_id: '',
    to_bank_account_id: '',
    amount: '',
    offset_account_id: '',
    memo: ''
  });

  const load = async () => {
    try {
      const [b, gl, t] = await Promise.all([
        api.banking.accounts(),
        api.accounting.accounts(),
        api.banking.transactions()
      ]);
      setAccounts(b);
      setGlAccounts(gl.filter((a: any) => a.is_active !== false));
      setTxns(t);
      const bankGl = gl.find((a: any) => a.code === '1120') || gl.find((a: any) => a.account_type === 'asset');
      const cashGl = gl.find((a: any) => a.code === '1110');
      setAcctForm((f) => ({
        ...f,
        gl_account_id: f.gl_account_id || bankGl?.id || ''
      }));
      setMoveForm((f) => ({
        ...f,
        bank_account_id: f.bank_account_id || b[0]?.id || '',
        to_bank_account_id: f.to_bank_account_id || b[1]?.id || b[0]?.id || '',
        offset_account_id: f.offset_account_id || cashGl?.id || ''
      }));
    } catch (e: any) {
      await alertError('Banking', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.banking.createAccount({
        name: acctForm.name,
        bank_name: acctForm.bank_name || undefined,
        account_number: acctForm.account_number || undefined,
        gl_account_id: acctForm.gl_account_id
      });
      await alertSuccess('Bank account created');
      setAcctForm((f) => ({ ...f, name: '', bank_name: '', account_number: '' }));
      await load();
    } catch (err: any) {
      await alertError('Create failed', err.message);
    }
  };

  const postMove = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amount = Number(moveForm.amount);
      if (moveForm.type === 'deposit') {
        await api.banking.deposit({
          bank_account_id: moveForm.bank_account_id,
          amount,
          offset_account_id: moveForm.offset_account_id || undefined,
          memo: moveForm.memo || undefined
        });
      } else if (moveForm.type === 'withdrawal') {
        await api.banking.withdraw({
          bank_account_id: moveForm.bank_account_id,
          amount,
          offset_account_id: moveForm.offset_account_id || undefined,
          memo: moveForm.memo || undefined
        });
      } else {
        await api.banking.transfer({
          from_bank_account_id: moveForm.bank_account_id,
          to_bank_account_id: moveForm.to_bank_account_id,
          amount,
          memo: moveForm.memo || undefined
        });
      }
      await alertSuccess('Transaction posted');
      setMoveForm((f) => ({ ...f, amount: '', memo: '' }));
      await load();
      setTab('transactions');
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Banking
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Bank accounts, cash movements, and sales-rep custody retirement into till or bank.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['accounts', 'Accounts'],
            ['move', 'Move money'],
            ['custody', 'Sales cash custody'],
            ['transactions', 'Transactions']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'custody' ? <SalesRepCustodyFinance /> : null}

      {tab === 'accounts' ? (
        <>
          <form
            onSubmit={createAccount}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add bank account</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={acctForm.name}
                  onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Bank</label>
                <input
                  value={acctForm.bank_name}
                  onChange={(e) => setAcctForm({ ...acctForm, bank_name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Account number</label>
                <input
                  value={acctForm.account_number}
                  onChange={(e) => setAcctForm({ ...acctForm, account_number: e.target.value })}
                />
              </div>
              <div className="field">
                <label>GL account</label>
                <select
                  value={acctForm.gl_account_id}
                  onChange={(e) => setAcctForm({ ...acctForm, gl_account_id: e.target.value })}
                  required
                >
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create account
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Bank</th>
                  <th>Number</th>
                  <th>GL</th>
                  <th>Txns</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.bank_name || '—'}</td>
                    <td>{a.account_number || '—'}</td>
                    <td>
                      {a.gl_account?.code} — {a.gl_account?.name}
                    </td>
                    <td>{a._count?.transactions ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'move' ? (
        <form
          onSubmit={postMove}
          className="card-surface"
          style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Type</label>
              <select
                value={moveForm.type}
                onChange={(e) => setMoveForm({ ...moveForm, type: e.target.value })}
              >
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            <div className="field">
              <label>{moveForm.type === 'transfer' ? 'From account' : 'Bank account'}</label>
              <select
                value={moveForm.bank_account_id}
                onChange={(e) => setMoveForm({ ...moveForm, bank_account_id: e.target.value })}
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {moveForm.type === 'transfer' ? (
              <div className="field">
                <label>To account</label>
                <select
                  value={moveForm.to_bank_account_id}
                  onChange={(e) => setMoveForm({ ...moveForm, to_bank_account_id: e.target.value })}
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label>Offset GL</label>
                <select
                  value={moveForm.offset_account_id}
                  onChange={(e) => setMoveForm({ ...moveForm, offset_account_id: e.target.value })}
                >
                  {glAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Amount</label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={moveForm.amount}
                onChange={(e) => setMoveForm({ ...moveForm, amount: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Memo</label>
              <input
                value={moveForm.memo}
                onChange={(e) => setMoveForm({ ...moveForm, memo: e.target.value })}
              />
            </div>
            <div className="form-grid--actions">
              <button className="btn btn-primary" type="submit">
                Post to GL
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {tab === 'transactions' ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div className="table-wrap">
            <table className="table">
            <thead>
              <tr>
                <th>Txn #</th>
                <th>Date</th>
                <th>Type</th>
                <th>Account</th>
                <th>Amount</th>
                <th>Memo</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id}>
                  <td>{t.txn_number}</td>
                  <td>{String(t.txn_date).slice(0, 10)}</td>
                  <td>{t.type}</td>
                  <td>
                    {t.bank_account?.name}
                    {t.counterparty_bank_account
                      ? ` → ${t.counterparty_bank_account.name}`
                      : ''}
                  </td>
                  <td>{Number(t.amount).toLocaleString()}</td>
                  <td>{t.memo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
