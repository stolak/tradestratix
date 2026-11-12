import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { SearchSelect } from './SearchSelect';

export type SupplierPaymentMode = 'clear' | 'advance';

type SupplierOpt = { id: string; name: string; code?: string | null; status?: string };

type PayableBill = {
  id: string;
  bill_number: string;
  bill_date?: string;
  balance: number;
  status?: string;
  branch?: { code?: string; name?: string } | null;
};

type OpenPo = {
  id: string;
  po_number: string;
  status?: string;
  remaining_value: number;
};

type Props = {
  suppliers?: SupplierOpt[];
  /** Lock to one supplier. */
  supplierId?: string;
  /** Prefill / pin one bill. */
  billId?: string;
  hideHistory?: boolean;
  /** `all` = business-wide payment list; default filters to selected supplier. */
  historyScope?: 'supplier' | 'all';
  onDone?: () => void | Promise<void>;
};

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type LedgerOpt = { id: string; label: string; code?: string | null };

export const PaySupplierPayment: React.FC<Props> = ({
  suppliers: suppliersProp,
  supplierId: lockedSupplierId,
  billId: pinnedBillId,
  hideHistory,
  historyScope = 'supplier',
  onDone
}) => {
  const { can } = useAuth();
  const canPost = can('purchases.post');

  const [suppliers, setSuppliers] = useState<SupplierOpt[]>(suppliersProp || []);
  const [supplierId, setSupplierId] = useState(lockedSupplierId || '');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ledgerOptions, setLedgerOptions] = useState<LedgerOpt[]>([]);
  const [defaultCashId, setDefaultCashId] = useState<string | null>(null);
  const [defaultBankId, setDefaultBankId] = useState<string | null>(null);
  const [transactionDate, setTransactionDate] = useState(todayLocalDate);
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState<SupplierPaymentMode>('clear');
  const [payableBills, setPayableBills] = useState<PayableBill[]>([]);
  const [openPos, setOpenPos] = useState<OpenPo[]>([]);
  const [selectedBills, setSelectedBills] = useState<Record<string, boolean>>({});
  const [selectedPos, setSelectedPos] = useState<Record<string, boolean>>({});
  const [prepaid, setPrepaid] = useState(0);
  const [ledgerBalance, setLedgerBalance] = useState(0);
  const [payments, setPayments] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);

  useEffect(() => {
    if (suppliersProp) {
      setSuppliers(suppliersProp);
      return;
    }
    let cancelled = false;
    api.suppliers
      .list()
      .then((rows) => {
        if (cancelled) return;
        setSuppliers((rows || []).filter((s: any) => s.status !== 'inactive'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [suppliersProp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [gl, defaults] = await Promise.all([
          api.accounting.accounts(),
          api.accounting.defaultAccounts().catch(() => [])
        ]);
        if (cancelled) return;
        const cashDef = defaults.find((d: any) => d.setting_key === 'cash' || d.key === 'cash');
        const bankDef = defaults.find((d: any) => d.setting_key === 'bank' || d.key === 'bank');
        const cashId = cashDef?.account_id || cashDef?.accountId || null;
        const bankId = bankDef?.account_id || bankDef?.accountId || null;
        setDefaultCashId(cashId);
        setDefaultBankId(bankId);

        const preferred = new Set([cashId, bankId].filter(Boolean) as string[]);
        const assets = (gl || [])
          .filter((a: any) => a.is_active !== false && String(a.account_type || a.accountType) === 'asset')
          .map((a: any) => ({
            id: a.id,
            code: a.code,
            label: a.code ? `${a.code} — ${a.name}` : a.name
          })) as LedgerOpt[];

        assets.sort((a, b) => {
          const ap = preferred.has(a.id) ? 0 : 1;
          const bp = preferred.has(b.id) ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return String(a.code || a.label).localeCompare(String(b.code || b.label));
        });
        setLedgerOptions(assets);
        setAccountId((prev) => prev || bankId || cashId || assets[0]?.id || '');
      } catch {
        /* ignore — submit will validate */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedSupplierId) setSupplierId(lockedSupplierId);
  }, [lockedSupplierId]);

  useEffect(() => {
    if (!suppliers.length || lockedSupplierId) return;
    if (!supplierId || !suppliers.some((s) => s.id === supplierId)) {
      setSupplierId(suppliers[0]?.id || '');
    }
  }, [suppliers, supplierId, lockedSupplierId]);

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.code ? `${s.name} (${s.code})` : s.name })),
    [suppliers]
  );

  const outstanding = Math.max(0, ledgerBalance);
  const prepaidOnAccount = Math.max(0, -ledgerBalance, prepaid);

  const billTickSum = useMemo(() => {
    return payableBills.reduce(
      (s, b) => (selectedBills[b.id] ? s + Number(b.balance || 0) : s),
      0
    );
  }, [payableBills, selectedBills]);

  const poTickSum = useMemo(() => {
    return openPos.reduce(
      (s, p) => (selectedPos[p.id] ? s + Number(p.remaining_value || 0) : s),
      0
    );
  }, [openPos, selectedPos]);

  const depositSum = roundMoneySafe(billTickSum + poTickSum);
  const payAmount = Number(amount) || 0;
  const surplus = mode === 'clear' ? Math.max(0, payAmount - outstanding) : 0;
  const hasTicks =
    Object.values(selectedBills).some(Boolean) || Object.values(selectedPos).some(Boolean);

  const refreshSupplierMeta = async (id: string) => {
    if (!id) {
      setPayableBills([]);
      setOpenPos([]);
      setSelectedBills({});
      setSelectedPos({});
      setPrepaid(0);
      setLedgerBalance(0);
      if (!hideHistory) setPayments([]);
      return;
    }
    setLoadingMeta(true);
    try {
      const [bills, credit, orders, pays] = await Promise.all([
        api.purchases.bills(id, { consolidated: true }),
        api.purchases.supplierCredit(id).catch(() => ({ total: 0, payments: [], balance: 0 })),
        api.purchases.orders().catch(() => []),
        hideHistory
          ? Promise.resolve(null)
          : api.purchases.payments(
              historyScope === 'all' ? undefined : id,
              { consolidated: true }
            )
      ]);

      const balance = Number(credit.balance) || 0;
      setLedgerBalance(balance);
      setPrepaid(Number(credit.total) || 0);

      const payable = (bills || [])
        .filter((b: any) => {
          if (b.status === 'void' || b.status === 'paid') return false;
          return Number(b.balance || 0) > 0.005;
        })
        .map(
          (b: any) =>
            ({
              id: b.id,
              bill_number: b.bill_number,
              bill_date: b.bill_date,
              balance: Number(b.balance) || 0,
              status: b.status,
              branch: b.branch
            }) as PayableBill
        );
      setPayableBills(payable);

      const nextBills: Record<string, boolean> = {};
      for (const b of payable) {
        nextBills[b.id] = pinnedBillId ? b.id === pinnedBillId : false;
      }
      setSelectedBills(nextBills);

      const pos = (orders || [])
        .filter(
          (o: any) =>
            o.supplier_id === id &&
            ['approved', 'partially_received'].includes(String(o.status))
        )
        .map((o: any) => {
          const items = o.items || [];
          const remaining = items.reduce((s: number, it: any) => {
            const left = Math.max(
              0,
              Number(it.quantity_ordered || 0) - Number(it.quantity_received || 0)
            );
            return s + left * Number(it.unit_cost || 0);
          }, 0);
          return {
            id: o.id,
            po_number: o.po_number,
            status: o.status,
            remaining_value: roundMoneySafe(remaining)
          } as OpenPo;
        })
        .filter((p: OpenPo) => p.remaining_value > 0.005);
      setOpenPos(pos);
      const nextPos: Record<string, boolean> = {};
      for (const p of pos) nextPos[p.id] = false;
      setSelectedPos(nextPos);

      const owes = Math.max(0, balance);
      if (pinnedBillId && payable.some((b) => b.id === pinnedBillId)) {
        setMode('advance');
        const pinned = payable.find((b) => b.id === pinnedBillId)!;
        setAmount(String(Number(pinned.balance.toFixed(2))));
      } else if (owes > 0.005) {
        setMode('clear');
        setAmount('');
      } else {
        setMode('advance');
        setAmount('');
      }

      if (pays) setPayments(pays);
    } catch (e: any) {
      await alertError('Could not load supplier payables', e.message);
    } finally {
      setLoadingMeta(false);
    }
  };

  useEffect(() => {
    void refreshSupplierMeta(supplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, pinnedBillId, hideHistory, historyScope]);

  useEffect(() => {
    if (mode !== 'advance') return;
    if (hasTicks) {
      setAmount(depositSum > 0 ? String(Number(depositSum.toFixed(2))) : '');
    }
  }, [mode, hasTicks, depositSum]);

  const fillClearAmount = () => {
    if (outstanding > 0) setAmount(String(Number(outstanding.toFixed(2))));
  };

  const toggleBill = (id: string) => {
    setSelectedBills((s) => ({ ...s, [id]: !s[id] }));
  };

  const togglePo = (id: string) => {
    setSelectedPos((s) => ({ ...s, [id]: !s[id] }));
  };

  const selectAllTargets = () => {
    const nextB: Record<string, boolean> = {};
    for (const b of payableBills) nextB[b.id] = true;
    setSelectedBills(nextB);
    const nextP: Record<string, boolean> = {};
    for (const p of openPos) nextP[p.id] = true;
    setSelectedPos(nextP);
  };

  const clearSelection = () => {
    const nextB: Record<string, boolean> = {};
    for (const b of payableBills) nextB[b.id] = false;
    setSelectedBills(nextB);
    const nextP: Record<string, boolean> = {};
    for (const p of openPos) nextP[p.id] = false;
    setSelectedPos(nextP);
  };

  const methodForAccount = (id: string) => {
    if (defaultBankId && id === defaultBankId) return 'bank';
    if (defaultCashId && id === defaultCashId) return 'cash';
    return 'transfer';
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPost || !supplierId) return;
    if (!(payAmount > 0)) {
      await alertError('Amount required', 'Enter a payment amount greater than zero.');
      return;
    }
    if (!accountId) {
      await alertError('Account required', 'Select the ledger account the payment was paid from.');
      return;
    }
    if (!transactionDate) {
      await alertError('Date required', 'Enter the transaction date.');
      return;
    }

    const allocations =
      mode === 'advance'
        ? payableBills
            .filter((b) => selectedBills[b.id] && b.balance > 0.005)
            .map((b) => ({ bill_id: b.id, amount: Number(b.balance.toFixed(2)) }))
        : [];

    if (mode === 'advance' && hasTicks) {
      if (Math.abs(depositSum - payAmount) > 0.01) {
        await alertError(
          'Amount mismatch',
          `Ticked bills/POs total ${money(depositSum)}. Adjust the amount or your selection.`
        );
        return;
      }
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        supplier_id: supplierId,
        amount: payAmount,
        account_id: accountId,
        method: methodForAccount(accountId),
        payment_date: transactionDate,
        reference: reference || undefined,
        allow_unallocated: true
      };
      if (mode === 'advance') {
        body.mode = 'advance';
        if (allocations.length) body.allocations = allocations;
      } else {
        body.mode = 'clear';
      }

      const payment = await api.purchases.recordPayment(body);
      const unapplied = Number(payment.unapplied_amount || 0);
      await alertSuccess(
        'Payment recorded',
        mode === 'advance' && allocations.length
          ? `Settled ${allocations.length} bill(s); any remainder stays as prepaid.`
          : unapplied > 0.005
            ? `${money(unapplied)} stays on the supplier account as prepaid.`
            : mode === 'advance'
              ? 'Posted to the supplier account as prepaid.'
              : undefined
      );
      setAmount('');
      setReference('');
      setTransactionDate(todayLocalDate());
      await refreshSupplierMeta(supplierId);
      await onDone?.();
    } catch (err: any) {
      await alertError('Payment failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!canPost) {
    return (
      <div className="card-surface" style={{ padding: '1.25rem', color: 'var(--ink-muted)' }}>
        You do not have permission to post supplier payments.
      </div>
    );
  }

  const amountLockedToTicks = mode === 'advance' && hasTicks;
  const showAdvanceTargets = mode === 'advance' && (payableBills.length > 0 || openPos.length > 0);

  return (
    <div className="recv-pay">
      <form onSubmit={submitPayment} className="card-surface recv-pay__form">
        <div className="recv-pay__head">
          <div>
            <div className="recv-pay__title">Pay supplier</div>
            <p className="recv-pay__hint">
              Clear open AP bills, or pay in advance. All money debits the supplier account.
            </p>
          </div>
          {supplierId ? (
            <div className="recv-pay__stats">
              {loadingMeta ? (
                <div>
                  <span className="recv-pay__stat-label">Balance</span>
                  <span className="recv-pay__stat-value">…</span>
                </div>
              ) : outstanding > 0.005 ? (
                <div>
                  <span className="recv-pay__stat-label">Outstanding</span>
                  <span className="recv-pay__stat-value">{money(outstanding)}</span>
                </div>
              ) : (
                <div>
                  <span className="recv-pay__stat-label">Prepaid on account</span>
                  <span className="recv-pay__stat-value">{money(prepaidOnAccount)}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="form-grid">
          {!lockedSupplierId ? (
            <div className="field">
              <label>Supplier</label>
              <SearchSelect
                value={supplierId}
                options={supplierOptions}
                required
                placeholder="Search supplier…"
                onChange={setSupplierId}
              />
            </div>
          ) : null}
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
              readOnly={amountLockedToTicks}
              title={amountLockedToTicks ? 'Amount is the sum of ticked bills/POs' : undefined}
            />
          </div>
          <div className="field">
            <label>Paid from</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="" disabled>
                Select ledger account…
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
              placeholder="Slip / narration"
            />
          </div>
        </div>

        <div className="recv-pay__modes" role="radiogroup" aria-label="Payment application">
          <label className={`recv-pay__mode${mode === 'clear' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="supplier-pay-mode"
              checked={mode === 'clear'}
              onChange={() => {
                setMode('clear');
                clearSelection();
              }}
            />
            <span>
              <strong>Clear outstanding</strong>
              <small>FIFO across open bills; leftover stays as prepaid</small>
            </span>
          </label>
          <label className={`recv-pay__mode${mode === 'advance' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="supplier-pay-mode"
              checked={mode === 'advance'}
              onChange={() => setMode('advance')}
            />
            <span>
              <strong>Advance / prepaid</strong>
              <small>Credit the supplier, or tick open bills / POs</small>
            </span>
          </label>
        </div>

        {mode === 'clear' ? (
          <div className="recv-pay__actions-row">
            <button type="button" className="btn btn-ghost" onClick={fillClearAmount} disabled={!outstanding}>
              Fill outstanding ({money(outstanding)})
            </button>
            {surplus > 0.005 && payAmount > 0 ? (
              <span className="recv-pay__note">{money(surplus)} will remain as prepaid</span>
            ) : null}
            {!outstanding ? (
              <span className="recv-pay__note">Nothing outstanding — use Advance / prepaid instead.</span>
            ) : null}
          </div>
        ) : null}

        {showAdvanceTargets ? (
          <div className="line-items">
            <div className="line-items__scroll">
              <table className="line-items__table" style={{ minWidth: 640, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }} />
                    <th>Bill / PO</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th className="num">Amount due</th>
                  </tr>
                </thead>
                <tbody>
                  {payableBills.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selectedBills[b.id]}
                          onChange={() => toggleBill(b.id)}
                          aria-label={`Select ${b.bill_number}`}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{b.bill_number}</div>
                        <div className="invoice-view__sub">Open AP bill</div>
                      </td>
                      <td>{b.status || '—'}</td>
                      <td>{b.branch?.code || b.branch?.name || '—'}</td>
                      <td className="num">{money(b.balance)}</td>
                    </tr>
                  ))}
                  {openPos.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selectedPos[p.id]}
                          onChange={() => togglePo(p.id)}
                          aria-label={`Select ${p.po_number}`}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.po_number}</div>
                        <div className="invoice-view__sub">Open purchase order (prepaid)</div>
                      </td>
                      <td>{p.status || '—'}</td>
                      <td>—</td>
                      <td className="num">{money(p.remaining_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="line-items__footer">
              <div className="recv-pay__actions-row">
                <button type="button" className="btn btn-ghost" onClick={selectAllTargets}>
                  Tick all
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={clearSelection}
                  disabled={!hasTicks}
                >
                  Clear ticks
                </button>
              </div>
              <div className="line-items__totals">
                <div className="line-items__total line-items__total--muted">
                  <span className="line-items__total-label">Advance total</span>
                  <span className="line-items__total-value">{money(depositSum)}</span>
                </div>
              </div>
            </div>
            {!hasTicks ? (
              <div className="recv-pay__note" style={{ padding: '0 0.25rem 0.5rem' }}>
                Nothing ticked — the full amount posts as free prepaid on the supplier account.
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'advance' && !payableBills.length && !openPos.length && !loadingMeta ? (
          <div className="recv-pay__note">
            No open bills or POs — enter any amount for free prepaid on the supplier account.
          </div>
        ) : null}

        <div className="recv-pay__submit">
          <button className="btn btn-primary" type="submit" disabled={busy || !supplierId}>
            {busy ? 'Posting…' : 'Post payment'}
          </button>
        </div>
      </form>

      {!hideHistory ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Payment history</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment #</th>
                  <th>Supplier</th>
                  <th className="num">Amount</th>
                  <th>Paid from</th>
                  <th>Allocations</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payment_number}</td>
                    <td>{p.supplier?.name || '—'}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td>
                      {p.account
                        ? p.account.code
                          ? `${p.account.code} — ${p.account.name}`
                          : p.account.name
                        : p.method || '—'}
                    </td>
                    <td>
                      {(p.allocations || [])
                        .map((a: any) => `${a.bill?.bill_number}: ${money(a.amount)}`)
                        .join(' · ') || '—'}
                      {Number(p.unapplied_amount) > 0 ? (
                        <div className="line-items__discount-note">
                          {money(p.unapplied_amount)} supplier prepaid
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!payments.length ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                      {supplierId ? 'No payments for this supplier yet.' : 'Select a supplier to see payments.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};

function roundMoneySafe(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
