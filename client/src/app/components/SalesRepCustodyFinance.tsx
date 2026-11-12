import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Finance workspace: list sales-rep custody balances and retire cash into till/bank.
 */
export const SalesRepCustodyFinance: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [ledgerOptions, setLedgerOptions] = useState<{ id: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayLocalDate);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [reps, gl, defaults] = await Promise.all([
        api.salesReps.list(undefined, { all: true, withBalances: true }),
        api.accounting.accounts().catch(() => []),
        api.accounting.defaultAccounts().catch(() => [])
      ]);
      const withBal = (reps || [])
        .map((r: any) => ({ ...r, balance: Number(r.balance || 0) }))
        .sort((a: any, b: any) => b.balance - a.balance || String(a.name || '').localeCompare(String(b.name || '')));
      setRows(withBal);

      const cashId =
        defaults.find((d: any) => d.setting_key === 'cash' || d.key === 'cash')?.account_id ||
        defaults.find((d: any) => d.setting_key === 'cash' || d.key === 'cash')?.accountId;
      const bankId =
        defaults.find((d: any) => d.setting_key === 'bank' || d.key === 'bank')?.account_id ||
        defaults.find((d: any) => d.setting_key === 'bank' || d.key === 'bank')?.accountId;
      const custodyId =
        defaults.find(
          (d: any) =>
            d.setting_key === 'cash_in_custody_sales_rep' || d.key === 'cash_in_custody_sales_rep'
        )?.account_id ||
        defaults.find(
          (d: any) =>
            d.setting_key === 'cash_in_custody_sales_rep' || d.key === 'cash_in_custody_sales_rep'
        )?.accountId;
      const preferred = new Set([cashId, bankId].filter(Boolean) as string[]);
      const assets = (gl || [])
        .filter(
          (a: any) =>
            a.is_active !== false &&
            String(a.account_type || a.accountType) === 'asset' &&
            a.id !== custodyId
        )
        .map((a: any) => ({
          id: a.id,
          label: a.code ? `${a.code} — ${a.name}` : a.name
        }));
      assets.sort((a: any, b: any) => {
        const ap = preferred.has(a.id) ? 0 : 1;
        const bp = preferred.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(a.label).localeCompare(String(b.label));
      });
      setLedgerOptions(assets);
      setAccountId((prev) => prev || cashId || bankId || assets[0]?.id || '');

      const holding = withBal.filter((r: any) => r.balance > 0.005);
      if (!selectedId && holding[0]) {
        setSelectedId(holding[0].id);
        setAmount(String(Number(holding[0].balance.toFixed(2))));
      } else if (selectedId) {
        const cur = withBal.find((r: any) => r.id === selectedId);
        if (cur && cur.balance > 0.005) {
          setAmount(String(Number(cur.balance.toFixed(2))));
        }
      }
    } catch (e: any) {
      await alertError('Custody', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = rows.find((r) => r.id === selectedId);
  const holding = rows.filter((r) => r.balance > 0.005);
  const totalHeld = holding.reduce((s, r) => s + r.balance, 0);

  const pickRep = (id: string) => {
    setSelectedId(id);
    const r = rows.find((x) => x.id === id);
    if (r && r.balance > 0.005) setAmount(String(Number(r.balance.toFixed(2))));
    else setAmount('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      await alertError('Select a sales rep', 'Choose whose custody cash you are receiving.');
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      await alertError('Amount required', 'Enter the cash amount being handed over.');
      return;
    }
    if (!accountId) {
      await alertError('Account required', 'Select the till or bank ledger receiving the cash.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.salesReps.retireCash(selectedId, {
        amount: amt,
        account_id: accountId,
        transaction_date: transactionDate || undefined,
        reference: reference || undefined
      });
      await alertSuccess(
        'Cash retired',
        `${money(amt)} received into finance. Custody left: ${money(result.balance_remaining)}.`
      );
      setReference('');
      setTransactionDate(todayLocalDate());
      await load();
    } catch (err: any) {
      await alertError('Retire failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div
        className="card-surface"
        style={{ padding: '0.9rem 1.15rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}
      >
        <div>
          <div className="recv-pay__stat-label" style={{ marginBottom: 2 }}>
            Total in custody
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : money(totalHeld)}
          </div>
        </div>
        <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', maxWidth: '36rem', alignSelf: 'center' }}>
          Walk-in collections sit with the sales rep until Finance receives the cash into till or bank.
          {user?.role === 'business_owner' ? ' You can retire on behalf of any rep.' : null}
        </div>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Sales reps holding cash</div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Rep</th>
                <th>Code</th>
                <th>Home branch</th>
                <th className="num">Cash in custody</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bal = Number(r.balance || 0);
                return (
                  <tr
                    key={r.id}
                    style={
                      selectedId === r.id
                        ? { background: 'color-mix(in srgb, var(--brand, #0f5c4c) 8%, transparent)' }
                        : undefined
                    }
                  >
                    <td>
                      <input
                        type="radio"
                        name="custody-rep"
                        checked={selectedId === r.id}
                        disabled={!(bal > 0.005) || r.status !== 'active'}
                        onChange={() => pickRep(r.id)}
                        aria-label={`Select ${r.name || r.code}`}
                      />
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.name || r.employee?.full_name || '—'}</td>
                    <td>{r.code || r.employee?.code || '—'}</td>
                    <td>{r.branch?.code || r.employee?.branch?.code || '—'}</td>
                    <td
                      className="num"
                      style={
                        bal > 0.005
                          ? { fontWeight: 700, color: 'var(--danger, #b42318)' }
                          : undefined
                      }
                    >
                      {money(bal)}
                    </td>
                    <td>{r.status === 'active' ? 'Active' : 'Disabled'}</td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                    {loading ? 'Loading…' : 'No sales reps found.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="card-surface"
        style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
      >
        <div style={{ fontWeight: 700 }}>
          Receive custody cash
          {selected ? ` — ${selected.name || selected.employee?.full_name || selected.code}` : ''}
        </div>
        {!holding.length && !loading ? (
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Nothing to retire. After walk-in / POS collections, balances appear above.
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Select a rep above, confirm the amount, and post into the company ledger receiving the handover.
          </p>
        )}
        <div className="form-grid">
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              min="0.01"
              step="any"
              className="qty-input"
              style={{ textAlign: 'right' }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              disabled={!selected || !(Number(selected.balance) > 0.005)}
            />
          </div>
          <div className="field">
            <label>Received into</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              disabled={!holding.length}
            >
              <option value="" disabled>
                Select ledger…
              </option>
              {ledgerOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Transaction date</label>
            <input
              type="date"
              value={transactionDate}
              max={todayLocalDate()}
              onChange={(e) => setTransactionDate(e.target.value)}
              required
              disabled={!holding.length}
            />
          </div>
          <div className="field">
            <label>Reference</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Handover note / slip"
              disabled={!holding.length}
            />
          </div>
        </div>
        <div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !holding.length || !selectedId}
          >
            {busy ? 'Posting…' : 'Post retirement'}
          </button>
        </div>
      </form>
    </div>
  );
};
