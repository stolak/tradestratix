import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { useAuth } from '../context/AuthContext';
import { SearchSelect } from './SearchSelect';

export type PaymentMode = 'clear' | 'advance';

type CustomerOpt = { id: string; name: string; code?: string | null; status?: string };

type PayableInvoice = {
  id: string;
  invoice_number: string;
  invoice_date?: string;
  /** Recognised AR still open. */
  balance: number;
  /** Commercial amount still payable (includes unfulfilled). */
  amount_due: number;
  payment_status?: string;
  fulfilment_status?: string;
  branch?: { code?: string; name?: string } | null;
};

type Props = {
  customers?: CustomerOpt[];
  /** Lock to one customer (Customer Balances). */
  customerId?: string;
  /** Prefill / pin one invoice (from invoice detail). */
  invoiceId?: string;
  /** Hide the payment history table. */
  hideHistory?: boolean;
  /** `all` = business-wide payment list (Sales tab); default filters to selected customer. */
  historyScope?: 'customer' | 'all';
  onDone?: () => void | Promise<void>;
};

function money(v: unknown) {
  return Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function isWalkIn(c: any) {
  return String(c?.code || '').toUpperCase() === 'WALK-IN' || c?.is_walk_in === true;
}

function todayLocalDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type LedgerOpt = { id: string; label: string; code?: string | null };

export const ReceiveCustomerPayment: React.FC<Props> = ({
  customers: customersProp,
  customerId: lockedCustomerId,
  invoiceId: pinnedInvoiceId,
  hideHistory,
  historyScope = 'customer',
  onDone
}) => {
  const { can } = useAuth();
  const canPost = can('sales.post');
  const canRefund = can('sales.refund');

  const [customers, setCustomers] = useState<CustomerOpt[]>(customersProp || []);
  const [customerId, setCustomerId] = useState(lockedCustomerId || '');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ledgerOptions, setLedgerOptions] = useState<LedgerOpt[]>([]);
  const [defaultCashId, setDefaultCashId] = useState<string | null>(null);
  const [defaultBankId, setDefaultBankId] = useState<string | null>(null);
  const [transactionDate, setTransactionDate] = useState(todayLocalDate);
  const [reference, setReference] = useState('');
  const [mode, setMode] = useState<PaymentMode>('clear');
  /** Open / unfilled invoices with commercial amount still due. */
  const [payableInvoices, setPayableInvoices] = useState<PayableInvoice[]>([]);
  /** Ticked deposit targets (advance mode). */
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [freeCredit, setFreeCredit] = useState(0);
  /** Net AR from ledger (positive = owes, negative = credit). */
  const [ledgerBalance, setLedgerBalance] = useState(0);
  const [payments, setPayments] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);

  useEffect(() => {
    if (customersProp) {
      setCustomers(customersProp);
      return;
    }
    let cancelled = false;
    api.customers
      .list(undefined, 'active')
      .then((rows) => {
        if (cancelled) return;
        setCustomers(rows.filter((c: any) => !isWalkIn(c)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customersProp]);

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

        // Prefer mapped cash/bank first, then other asset accounts.
        assets.sort((a, b) => {
          const ap = preferred.has(a.id) ? 0 : 1;
          const bp = preferred.has(b.id) ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return String(a.code || a.label).localeCompare(String(b.code || b.label));
        });
        setLedgerOptions(assets);
        setAccountId((prev) => prev || cashId || bankId || assets[0]?.id || '');
      } catch {
        /* ignore — submit will validate */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedCustomerId) setCustomerId(lockedCustomerId);
  }, [lockedCustomerId]);

  useEffect(() => {
    if (!customers.length || lockedCustomerId) return;
    if (!customerId || !customers.some((c) => c.id === customerId)) {
      setCustomerId(customers[0]?.id || '');
    }
  }, [customers, customerId, lockedCustomerId]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.code ? `${c.name} (${c.code})` : c.name })),
    [customers]
  );

  const outstanding = Math.max(0, ledgerBalance);
  const creditOnAccount = Math.max(0, -ledgerBalance, freeCredit);

  const depositSum = useMemo(() => {
    return payableInvoices.reduce(
      (s, inv) => (selected[inv.id] ? s + Number(inv.amount_due || 0) : s),
      0
    );
  }, [payableInvoices, selected]);

  const payAmount = Number(amount) || 0;
  const surplus = mode === 'clear' ? Math.max(0, payAmount - outstanding) : 0;

  const refreshCustomerMeta = async (id: string) => {
    if (!id) {
      setPayableInvoices([]);
      setSelected({});
      setFreeCredit(0);
      setLedgerBalance(0);
      if (!hideHistory) setPayments([]);
      return;
    }
    setLoadingMeta(true);
    try {
      const [invRes, credit, pays] = await Promise.all([
        api.customers.invoices(id),
        api.sales.customerCredit(id).catch(() => ({ total: 0, payments: [] })),
        hideHistory
          ? Promise.resolve(null)
          : api.sales.payments(historyScope === 'all' ? undefined : id)
      ]);

      const ledger = Number(invRes.customer?.balance) || 0;
      setLedgerBalance(ledger);
      setFreeCredit(Number(credit.total) || 0);

      const payable = (invRes.invoices || [])
        .filter((i: any) => {
          if (i.status != null && i.status !== 'posted') return false;
          const due =
            i.amount_due != null
              ? Number(i.amount_due)
              : Math.max(
                  0,
                  Number(i.total_amount || 0) -
                    Number(i.cancelled_amount || 0) -
                    Number(i.amount_paid || 0)
                );
          return due > 0.005;
        })
        .map((i: any) => {
          const due =
            i.amount_due != null
              ? Number(i.amount_due)
              : Math.max(
                  0,
                  Number(i.total_amount || 0) -
                    Number(i.cancelled_amount || 0) -
                    Number(i.amount_paid || 0)
                );
          return {
            id: i.id,
            invoice_number: i.invoice_number,
            invoice_date: i.invoice_date,
            balance: Number(i.balance) || 0,
            amount_due: due,
            payment_status: i.payment_status,
            fulfilment_status: i.fulfilment_status,
            branch: i.branch
          } as PayableInvoice;
        });
      setPayableInvoices(payable);

      const nextSel: Record<string, boolean> = {};
      for (const inv of payable) {
        nextSel[inv.id] = pinnedInvoiceId ? inv.id === pinnedInvoiceId : false;
      }
      setSelected(nextSel);

      const owes = Math.max(0, ledger);
      if (pinnedInvoiceId && payable.some((i) => i.id === pinnedInvoiceId)) {
        setMode('advance');
        const pinned = payable.find((i) => i.id === pinnedInvoiceId)!;
        setAmount(String(Number(pinned.amount_due.toFixed(2))));
      } else if (owes > 0.005) {
        setMode('clear');
        setAmount('');
      } else {
        setMode('advance');
        setAmount('');
      }

      if (pays) setPayments(pays);
    } catch (e: any) {
      await alertError('Could not load customer invoices', e.message);
    } finally {
      setLoadingMeta(false);
    }
  };

  useEffect(() => {
    void refreshCustomerMeta(customerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, pinnedInvoiceId, hideHistory, historyScope]);

  // Keep amount in sync with ticked deposit targets.
  useEffect(() => {
    if (mode !== 'advance') return;
    if (Object.values(selected).some(Boolean)) {
      setAmount(depositSum > 0 ? String(Number(depositSum.toFixed(2))) : '');
    }
  }, [mode, selected, depositSum]);

  const fillClearAmount = () => {
    if (outstanding > 0) setAmount(String(Number(outstanding.toFixed(2))));
  };

  const toggleInvoice = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const selectAllPayable = () => {
    const next: Record<string, boolean> = {};
    for (const inv of payableInvoices) next[inv.id] = true;
    setSelected(next);
  };

  const clearSelection = () => {
    const next: Record<string, boolean> = {};
    for (const inv of payableInvoices) next[inv.id] = false;
    setSelected(next);
  };

  const methodForAccount = (id: string) => {
    if (defaultBankId && id === defaultBankId) return 'bank';
    if (defaultCashId && id === defaultCashId) return 'cash';
    return 'transfer';
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPost || !customerId) return;
    if (!(payAmount > 0)) {
      await alertError('Amount required', 'Enter a payment amount greater than zero.');
      return;
    }
    if (!accountId) {
      await alertError('Account required', 'Select the ledger account the payment was received into.');
      return;
    }
    if (!transactionDate) {
      await alertError('Date required', 'Enter the transaction date.');
      return;
    }

    const allocations =
      mode === 'advance'
        ? payableInvoices
            .filter((inv) => selected[inv.id] && inv.amount_due > 0.005)
            .map((inv) => ({ invoice_id: inv.id, amount: Number(inv.amount_due.toFixed(2)) }))
        : [];

    if (mode === 'advance' && allocations.length) {
      const sum = allocations.reduce((s, a) => s + a.amount, 0);
      if (Math.abs(sum - payAmount) > 0.01) {
        await alertError(
          'Amount mismatch',
          `Ticked invoices total ${money(sum)}. Adjust the amount or your selection.`
        );
        return;
      }
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        customer_id: customerId,
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

      const payment = await api.sales.recordPayment(body);
      const unapplied = Number(payment.unapplied_amount || 0);
      await alertSuccess(
        'Payment recorded',
        mode === 'advance' && allocations.length
          ? `Deposit posted against ${allocations.length} order(s).`
          : unapplied > 0.005
            ? `${money(unapplied)} stays on the customer account as credit.`
            : mode === 'advance'
              ? 'Posted to the customer account as credit.'
              : undefined
      );
      setAmount('');
      setReference('');
      setTransactionDate(todayLocalDate());
      await refreshCustomerMeta(customerId);
      await onDone?.();
    } catch (err: any) {
      await alertError('Payment failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const refundCredit = async () => {
    if (!canRefund || !customerId || !(freeCredit > 0)) return;
    const raw = window.prompt(`Refund amount (available ${money(freeCredit)})`, String(freeCredit));
    if (raw == null) return;
    const amt = Number(raw);
    if (!(amt > 0) || amt > freeCredit + 0.01) {
      await alertError('Invalid amount', `Enter an amount between 0.01 and ${money(freeCredit)}.`);
      return;
    }
    const refundAccountId = accountId || defaultCashId;
    if (!refundAccountId) {
      await alertError('Account required', 'Select the ledger account to refund from.');
      return;
    }
    setBusy(true);
    try {
      await api.sales.refundCredit({
        customer_id: customerId,
        amount: amt,
        account_id: refundAccountId,
        method: methodForAccount(refundAccountId)
      });
      await alertSuccess('Credit refunded');
      await refreshCustomerMeta(customerId);
      await onDone?.();
    } catch (err: any) {
      await alertError('Refund failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!canPost && !canRefund) {
    return (
      <div className="card-surface" style={{ padding: '1.25rem', color: 'var(--ink-muted)' }}>
        You do not have permission to receive or refund customer payments.
      </div>
    );
  }

  const amountLockedToTicks = mode === 'advance' && Object.values(selected).some(Boolean);

  return (
    <div className="recv-pay">
      {canPost ? (
        <form onSubmit={submitPayment} className="card-surface recv-pay__form">
          <div className="recv-pay__head">
            <div>
              <div className="recv-pay__title">Receive payment</div>
              <p className="recv-pay__hint">
                Clear recognised balances, or take a deposit against open orders. All money credits the
                customer account.
              </p>
            </div>
            {customerId ? (
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
                    <span className="recv-pay__stat-label">Credit on account</span>
                    <span className="recv-pay__stat-value">{money(creditOnAccount)}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="form-grid">
            {!lockedCustomerId ? (
              <div className="field">
                <label>Customer</label>
                <SearchSelect
                  value={customerId}
                  options={customerOptions}
                  required
                  placeholder="Search customer…"
                  onChange={setCustomerId}
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
                title={amountLockedToTicks ? 'Amount is the sum of ticked orders' : undefined}
              />
            </div>
            <div className="field">
              <label>Received into</label>
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
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip / narration" />
            </div>
          </div>

          <div className="recv-pay__modes" role="radiogroup" aria-label="Payment application">
            <label className={`recv-pay__mode${mode === 'clear' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="pay-mode"
                checked={mode === 'clear'}
                onChange={() => {
                  setMode('clear');
                  clearSelection();
                }}
              />
              <span>
                <strong>Clear outstanding</strong>
                <small>FIFO across recognised balances; leftover stays as credit</small>
              </span>
            </label>
            <label className={`recv-pay__mode${mode === 'advance' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="pay-mode"
                checked={mode === 'advance'}
                onChange={() => setMode('advance')}
              />
              <span>
                <strong>Advance / deposit</strong>
                <small>Credit on account, or tick open orders to deposit against</small>
              </span>
            </label>
          </div>

          {mode === 'clear' ? (
            <div className="recv-pay__actions-row">
              <button type="button" className="btn btn-ghost" onClick={fillClearAmount} disabled={!outstanding}>
                Fill outstanding ({money(outstanding)})
              </button>
              {surplus > 0.005 && payAmount > 0 ? (
                <span className="recv-pay__note">{money(surplus)} will remain as credit</span>
              ) : null}
              {!outstanding ? (
                <span className="recv-pay__note">Nothing outstanding — use Advance / deposit instead.</span>
              ) : null}
            </div>
          ) : null}

          {mode === 'advance' && payableInvoices.length > 0 ? (
            <div className="line-items">
              <div className="line-items__scroll">
                <table className="line-items__table" style={{ minWidth: 640, width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 44 }} />
                      <th>Order / invoice</th>
                      <th>Status</th>
                      <th>Branch</th>
                      <th className="num">Amount due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payableInvoices.map((inv) => {
                      const unfilled =
                        inv.fulfilment_status &&
                        inv.fulfilment_status !== 'fulfilled' &&
                        Number(inv.balance) < Number(inv.amount_due) - 0.005;
                      return (
                        <tr key={inv.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!selected[inv.id]}
                              onChange={() => toggleInvoice(inv.id)}
                              aria-label={`Select ${inv.invoice_number}`}
                            />
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{inv.invoice_number}</div>
                            <div className="invoice-view__sub">
                              {unfilled ? 'Unfulfilled / open order' : inv.payment_status || '—'}
                            </div>
                          </td>
                          <td>{inv.fulfilment_status || '—'}</td>
                          <td>{inv.branch?.code || inv.branch?.name || '—'}</td>
                          <td className="num">{money(inv.amount_due)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="line-items__footer">
                <div className="recv-pay__actions-row">
                  <button type="button" className="btn btn-ghost" onClick={selectAllPayable}>
                    Tick all
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={clearSelection}
                    disabled={!Object.values(selected).some(Boolean)}
                  >
                    Clear ticks
                  </button>
                </div>
                <div className="line-items__totals">
                  <div className="line-items__total line-items__total--muted">
                    <span className="line-items__total-label">Deposit total</span>
                    <span className="line-items__total-value">{money(depositSum)}</span>
                  </div>
                </div>
              </div>
              {!Object.values(selected).some(Boolean) ? (
                <div className="recv-pay__note" style={{ padding: '0 0.25rem 0.5rem' }}>
                  No orders ticked — the full amount posts as free credit on the customer account.
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'advance' && !payableInvoices.length && !loadingMeta ? (
            <div className="recv-pay__note">
              No open orders — enter any amount for free credit on the customer account.
            </div>
          ) : null}

          <div className="recv-pay__submit">
            <button className="btn btn-primary" type="submit" disabled={busy || !customerId}>
              {busy ? 'Posting…' : 'Post payment'}
            </button>
            {freeCredit > 0.005 && canRefund ? (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void refundCredit()}>
                Refund credit ({money(freeCredit)})
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {!hideHistory ? (
        <div className="card-surface" style={{ padding: '0.5rem 0' }}>
          <div style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Payment history</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment #</th>
                  <th>Customer</th>
                  <th className="num">Amount</th>
                  <th>Received into</th>
                  <th>Allocations</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payment_number}</td>
                    <td>{p.customer?.name || '—'}</td>
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
                        .map(
                          (a: any) =>
                            `${a.invoice?.invoice_number}: ${money(a.amount)}` +
                            (Number(a.deposit_amount) > 0 ? ` (deposit ${money(a.deposit_amount)})` : '')
                        )
                        .join(' · ') || '—'}
                      {Number(p.unapplied_amount) > 0 ? (
                        <div className="line-items__discount-note">
                          {money(p.unapplied_amount)} customer credit
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!payments.length ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                      {customerId ? 'No payments for this customer yet.' : 'Select a customer to see payments.'}
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
