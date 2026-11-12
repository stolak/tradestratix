import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, roundMoney, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';

type Tx = Prisma.TransactionClient;

export type PaymentAllocationInput = { invoiceId: string; amount: number };

/** Commercial value still payable on an invoice (order value net of cancellations, less receipts). */
export function invoicePayable(inv: { totalAmount: unknown; cancelledAmount: unknown; amountPaid: unknown }) {
  return roundMoney(Number(inv.totalAmount) - Number(inv.cancelledAmount || 0) - Number(inv.amountPaid));
}

export function paymentStatusFor(inv: { totalAmount: unknown; cancelledAmount: unknown }, amountPaid: number) {
  const due = roundMoney(Number(inv.totalAmount) - Number(inv.cancelledAmount || 0));
  if (amountPaid <= 0.009) return 'open';
  if (amountPaid >= due - 0.009) return 'paid';
  return 'partial';
}

/** Lock invoice rows for the rest of the transaction so concurrent receipts cannot over-allocate. */
export async function lockInvoices(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
}

/**
 * Record a customer receipt inside an open transaction.
 *
 * Each allocation first settles the invoice's recognised receivable (Cr AR) and holds any excess as a
 * customer deposit against goods not yet handed over (Cr Customer Deposits). A remainder may be kept as
 * unapplied customer credit. Cash is booked in the receiving branch; AR/deposit lines are booked in each
 * invoice's revenue branch, linked through inter-branch clearing when the branches differ.
 */
export async function applyPaymentInTx(
  tx: Tx,
  user: AuthUser,
  input: {
    customerId: string;
    customerName: string;
    receivingBranchId: string;
    amount: number;
    method: string;
    accountId: string;
    allocations: PaymentAllocationInput[];
    allowUnallocated?: boolean;
    reference?: string | null;
    notes?: string | null;
    paymentDate?: Date;
    idempotencyKey?: string | null;
  }
) {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw httpError(400, 'amount must be greater than 0');

  if (input.idempotencyKey) {
    const existing = await tx.customerPayment.findFirst({
      where: { businessId: user.businessId, idempotencyKey: input.idempotencyKey }
    });
    if (existing) return { payment: existing, replayed: true };
  }

  const accountMap = await getDefaultAccountMap(user.businessId);
  if (!accountMap.accounts_receivable) {
    throw httpError(400, 'Default accounts_receivable account must be configured');
  }

  const merged = new Map<string, number>();
  for (const a of input.allocations) {
    merged.set(a.invoiceId, roundMoney((merged.get(a.invoiceId) || 0) + a.amount));
  }
  const invoiceIds = [...merged.keys()];
  await lockInvoices(tx, invoiceIds);
  const invoices = await tx.salesInvoice.findMany({
    where: {
      id: { in: invoiceIds },
      businessId: user.businessId,
      customerId: input.customerId,
      status: 'posted'
    }
  });
  if (invoices.length !== invoiceIds.length) {
    throw httpError(400, 'One or more invoices are not open for this customer');
  }

  type Split = { invoiceId: string; branchId: string; ar: number; deposit: number; total: number };
  const splits: Split[] = [];
  for (const inv of invoices) {
    const apply = merged.get(inv.id)!;
    if (apply > invoicePayable(inv) + 0.01) {
      throw httpError(
        400,
        `Allocation ${apply} exceeds the amount still payable on ${inv.invoiceNumber} (${invoicePayable(inv)})`
      );
    }
    const ar = roundMoney(Math.min(apply, Math.max(0, Number(inv.balance))));
    const deposit = roundMoney(apply - ar);
    if (deposit > 0 && !accountMap.customer_deposits) {
      throw httpError(400, 'Default account "customer_deposits" is not configured');
    }
    splits.push({ invoiceId: inv.id, branchId: inv.branchId || input.receivingBranchId, ar, deposit, total: apply });
  }

  const allocatedTotal = roundMoney(splits.reduce((s, x) => s + x.total, 0));
  const unapplied = roundMoney(amount - allocatedTotal);
  if (unapplied < -0.01) throw httpError(400, 'Allocations exceed payment amount');
  if (unapplied > 0.01 && !input.allowUnallocated) {
    throw httpError(400, `Payment amount ${amount} does not match allocated ${allocatedTotal}`);
  }
  if (unapplied > 0.01 && !accountMap.unapplied_customer_receipts) {
    throw httpError(400, 'Default account "unapplied_customer_receipts" is not configured');
  }
  if (splits.some((s) => s.branchId !== input.receivingBranchId) && !accountMap.inter_branch_clearing) {
    throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
  }

  const paymentId = shortId('cpay');
  const paymentNumber = await nextDocNumber(tx.customerPayment, user.businessId, 'paymentNumber', 'CPAY', 5);
  const common = {
    source_type: 'customer_payment',
    source_id: paymentId,
    customer_id: input.customerId,
    post: true,
    entry_date: input.paymentDate
  };

  const byBranch = new Map<string, { ar: number; deposit: number }>();
  for (const s of splits) {
    const b = byBranch.get(s.branchId) || { ar: 0, deposit: 0 };
    b.ar = roundMoney(b.ar + s.ar);
    b.deposit = roundMoney(b.deposit + s.deposit);
    byBranch.set(s.branchId, b);
  }

  const home = byBranch.get(input.receivingBranchId) || { ar: 0, deposit: 0 };
  const remote = [...byBranch.entries()].filter(([b]) => b !== input.receivingBranchId);
  const remoteTotal = roundMoney(remote.reduce((s, [, v]) => s + v.ar + v.deposit, 0));
  const lines: any[] = [
    { account_id: input.accountId, debit: amount, description: `${input.method} receipt ${paymentNumber}` }
  ];
  if (home.ar > 0) lines.push({ account_id: accountMap.accounts_receivable, credit: home.ar, description: `AR settlement ${paymentNumber}` });
  if (home.deposit > 0) lines.push({ account_id: accountMap.customer_deposits, credit: home.deposit, description: `Deposit on order ${paymentNumber}` });
  if (unapplied > 0.01) lines.push({ account_id: accountMap.unapplied_customer_receipts, credit: unapplied, description: `Unapplied credit ${paymentNumber}` });
  if (remoteTotal > 0) lines.push({ account_id: accountMap.inter_branch_clearing, credit: remoteTotal, description: `Received for other branches ${paymentNumber}` });

  const receiptJournal: any = await createJournal(
    user,
    {
      ...common,
      memo: `Customer payment ${paymentNumber} — ${input.customerName}`,
      idempotency_key: `customer_payment:${paymentId}`,
      branch_id: input.receivingBranchId,
      lines
    },
    tx
  );

  for (const [branchId, v] of remote) {
    const remoteLines: any[] = [
      { account_id: accountMap.inter_branch_clearing, debit: roundMoney(v.ar + v.deposit), description: `Collected by receiving branch — ${paymentNumber}` }
    ];
    if (v.ar > 0) remoteLines.push({ account_id: accountMap.accounts_receivable, credit: v.ar, description: `AR settlement ${paymentNumber}` });
    if (v.deposit > 0) remoteLines.push({ account_id: accountMap.customer_deposits, credit: v.deposit, description: `Deposit on order ${paymentNumber}` });
    await createJournal(
      user,
      {
        ...common,
        memo: `Customer payment ${paymentNumber} received in another branch — ${input.customerName}`,
        idempotency_key: `customer_payment:${paymentId}:${branchId}`,
        branch_id: branchId,
        lines: remoteLines
      },
      tx,
      { trustedBranch: true }
    );
  }

  for (const s of splits) {
    const inv = invoices.find((i) => i.id === s.invoiceId)!;
    const paid = roundMoney(Number(inv.amountPaid) + s.total);
    await tx.salesInvoice.update({
      where: { id: inv.id },
      data: {
        amountPaid: toDec(paid),
        balance: toDec(Math.max(0, roundMoney(Number(inv.balance) - s.ar))),
        depositHeld: toDec(roundMoney(Number(inv.depositHeld) + s.deposit)),
        paymentStatus: paymentStatusFor(inv, paid)
      }
    });
  }

  const payment = await tx.customerPayment.create({
    data: {
      id: paymentId,
      businessId: user.businessId,
      branchId: input.receivingBranchId,
      customerId: input.customerId,
      paymentNumber,
      paymentDate: input.paymentDate || new Date(),
      amount: toDec(amount),
      unappliedAmount: toDec(Math.max(0, unapplied)),
      method: input.method,
      accountId: input.accountId,
      reference: input.reference || null,
      notes: input.notes || null,
      journalEntryId: receiptJournal.id,
      idempotencyKey: input.idempotencyKey || null,
      createdById: user.id,
      allocations: {
        create: splits.map((s) => ({
          id: shortId('cpa'),
          invoiceId: s.invoiceId,
          amount: toDec(s.total),
          arAmount: toDec(s.ar),
          depositAmount: toDec(s.deposit)
        }))
      }
    },
    include: { customer: true, account: true, allocations: { include: { invoice: true } } }
  });
  return { payment, replayed: false };
}

/**
 * Oldest-first allocation of a receipt across the customer's recognised receivables in every branch.
 * Deposits against unrecognised order value are only created when an invoice is named explicitly.
 */
export async function autoAllocate(businessId: string, customerId: string, amount: number) {
  const open = await prisma.salesInvoice.findMany({
    where: { businessId, customerId, status: 'posted', balance: { gt: 0 } },
    orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }]
  });
  let remaining = roundMoney(amount);
  const out: PaymentAllocationInput[] = [];
  for (const inv of open) {
    if (remaining <= 0) break;
    const apply = roundMoney(Math.min(Number(inv.balance), remaining));
    if (apply <= 0) continue;
    out.push({ invoiceId: inv.id, amount: apply });
    remaining = roundMoney(remaining - apply);
  }
  return out;
}
