import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

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

type Props = {
  /** When set, retire for this rep (manager). Otherwise retire own custody. */
  salesRepId?: string;
  salesRepName?: string;
  onDone?: () => void | Promise<void>;
  compact?: boolean;
};

/** Hand over walk-in cash held in sales-rep custody into till / bank. */
export const RetireSalesRepCash: React.FC<Props> = ({
  salesRepId,
  salesRepName,
  onDone,
  compact
}) => {
  const [balance, setBalance] = useState(0);
  const [name, setName] = useState(salesRepName || '');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ledgerOptions, setLedgerOptions] = useState<{ id: string; label: string }[]>([]);
  const [transactionDate, setTransactionDate] = useState(todayLocalDate);
  const [reference, setReference] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [meOrList, gl, defaults] = await Promise.all([
        salesRepId
          ? api.salesReps.list(undefined, { all: true, withBalances: true })
          : api.salesReps.me({ withBalances: true }),
        api.accounting.accounts().catch(() => []),
        api.accounting.defaultAccounts().catch(() => [])
      ]);

      if (salesRepId) {
        const row = (meOrList as any[]).find((r) => r.id === salesRepId);
        setBalance(Number(row?.balance || 0));
        setName(row?.name || row?.employee?.full_name || salesRepName || '');
      } else {
        const me = meOrList as any;
        setBalance(Number(me?.balance || 0));
        setName(me?.name || me?.employee?.full_name || '');
      }

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
    } catch {
      setBalance(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesRepId]);

  const start = () => {
    setAmount(balance > 0 ? String(Number(balance.toFixed(2))) : '');
    setTransactionDate(todayLocalDate());
    setReference('');
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) {
      await alertError('Amount required', 'Enter the cash amount being handed over.');
      return;
    }
    if (!accountId) {
      await alertError('Account required', 'Select the till or bank receiving the cash.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        amount: amt,
        account_id: accountId,
        transaction_date: transactionDate || undefined,
        reference: reference || undefined
      };
      const result = salesRepId
        ? await api.salesReps.retireCash(salesRepId, body)
        : await api.salesReps.retireMyCash(body);
      await alertSuccess(
        'Cash retired',
        `${money(amt)} handed over. Custody left: ${money(result.balance_remaining)}.`
      );
      setOpen(false);
      await refresh();
      await onDone?.();
    } catch (err: any) {
      await alertError('Retire failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && balance <= 0 && !open) {
    return compact ? null : (
      <div className="card-surface" style={{ padding: '0.85rem 1.1rem', color: 'var(--ink-muted)' }}>
        Checking custody…
      </div>
    );
  }

  if (!open && balance <= 0.005) {
    return compact ? null : (
      <div className="card-surface" style={{ padding: '0.85rem 1.1rem' }}>
        <div style={{ fontWeight: 600 }}>My cash custody</div>
        <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', marginTop: 4 }}>
          Nothing to retire — walk-in collections you hold will appear here.
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div
        className="card-surface"
        style={{
          padding: '0.85rem 1.1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>Cash in custody{name ? ` — ${name}` : ''}</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {money(balance)}
          </div>
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
            Walk-in cash you hold — retire here, or ask Finance (Banking → Sales cash custody)
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={start}>
          Retire cash
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="card-surface"
      style={{ padding: '1.1rem 1.25rem', display: 'grid', gap: 12 }}
    >
      <div style={{ fontWeight: 700 }}>Retire cash{name ? ` — ${name}` : ''}</div>
      <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
        Custody held: {money(balance)}. Choose the company ledger receiving the handover.
      </p>
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
          />
        </div>
        <div className="field">
          <label>Received into</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
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
          />
        </div>
        <div className="field">
          <label>Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Handover note / slip"
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Posting…' : 'Post retirement'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
};
