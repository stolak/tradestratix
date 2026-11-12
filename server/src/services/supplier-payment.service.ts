import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, roundMoney, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { createJournal, getDefaultAccountMap, partnerLineBalances } from './accounting.service.js';

type Tx = Prisma.TransactionClient;

export type SupplierPaymentAllocationInput = { billId: string; amount: number };

export function billPayable(bill: { balance: unknown }) {
  return roundMoney(Math.max(0, Number(bill.balance)));
}

export function billStatusFor(totalAmount: number, amountPaid: number) {
  if (amountPaid <= 0.009) return 'open';
  if (amountPaid >= totalAmount - 0.009) return 'paid';
  return 'partial';
}

async function lockBills(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
}

/**
 * Record a supplier payment inside an open transaction.
 *
 * All supplier money debits Accounts Payable (supplier control). Open bill balances are
 * reduced first; any excess (advance / overpay) stays as prepaid on the same supplier AP —
 * there is no separate supplier-advances liability/asset booking for day-to-day payables.
 * Cash leaves the paying branch; AP is booked in each bill's branch, linked through
 * inter-branch clearing when the branches differ.
 */
export async function applySupplierPaymentInTx(
  tx: Tx,
  user: AuthUser,
  input: {
    supplierId: string;
    supplierName: string;
    payingBranchId: string;
    amount: number;
    method: string;
    accountId: string;
    allocations: SupplierPaymentAllocationInput[];
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
    const existing = await tx.supplierPayment.findFirst({
      where: { businessId: user.businessId, idempotencyKey: input.idempotencyKey }
    });
    if (existing) return { payment: existing, replayed: true };
  }

  const accountMap = await getDefaultAccountMap(user.businessId);
  if (!accountMap.accounts_payable) {
    throw httpError(400, 'Default accounts_payable account must be configured');
  }

  const merged = new Map<string, number>();
  for (const a of input.allocations) {
    merged.set(a.billId, roundMoney((merged.get(a.billId) || 0) + a.amount));
  }
  const billIds = [...merged.keys()];
  await lockBills(tx, billIds);
  const bills = billIds.length
    ? await tx.supplierBill.findMany({
        where: {
          id: { in: billIds },
          businessId: user.businessId,
          supplierId: input.supplierId,
          status: { in: ['open', 'partial'] }
        }
      })
    : [];
  if (bills.length !== billIds.length) {
    throw httpError(400, 'One or more bills are not open for this supplier');
  }

  type Split = { billId: string; branchId: string; ap: number };
  const splits: Split[] = [];
  for (const bill of bills) {
    const apply = merged.get(bill.id)!;
    const due = billPayable(bill);
    if (apply > due + 0.01) {
      throw httpError(
        400,
        `Allocation ${apply} exceeds the balance on ${bill.billNumber} (${due})`
      );
    }
    splits.push({
      billId: bill.id,
      branchId: bill.branchId || input.payingBranchId,
      ap: apply
    });
  }

  const allocatedTotal = roundMoney(splits.reduce((s, x) => s + x.ap, 0));
  const surplus = roundMoney(amount - allocatedTotal);
  if (surplus < -0.01) throw httpError(400, 'Allocations exceed payment amount');
  if (surplus > 0.01 && !input.allowUnallocated) {
    throw httpError(400, `Payment amount ${amount} does not match allocated ${allocatedTotal}`);
  }
  if (splits.some((s) => s.branchId !== input.payingBranchId) && !accountMap.inter_branch_clearing) {
    throw httpError(400, 'Default account "inter_branch_clearing" is not configured');
  }

  const paymentId = shortId('spay');
  const paymentNumber = await nextDocNumber(tx.supplierPayment, user.businessId, 'paymentNumber', 'SPAY', 5);
  const common = {
    source_type: 'supplier_payment',
    source_id: paymentId,
    supplier_id: input.supplierId,
    post: true,
    entry_date: input.paymentDate,
    transaction_date: input.paymentDate
  };

  // Branch totals of supplier AP debit (bill settlement).
  const byBranch = new Map<string, number>();
  for (const s of splits) {
    byBranch.set(s.branchId, roundMoney((byBranch.get(s.branchId) || 0) + s.ap));
  }
  // Advance / surplus with no bill: debit AP at the paying branch (prepaid).
  if (surplus > 0.01) {
    byBranch.set(
      input.payingBranchId,
      roundMoney((byBranch.get(input.payingBranchId) || 0) + surplus)
    );
  }

  const homeAp = byBranch.get(input.payingBranchId) || 0;
  const remote = [...byBranch.entries()].filter(([b]) => b !== input.payingBranchId);
  const remoteTotal = roundMoney(remote.reduce((s, [, v]) => s + v, 0));
  const lines: any[] = [
    {
      account_id: input.accountId,
      credit: amount,
      description: `${input.method} payment ${paymentNumber}`
    }
  ];
  if (homeAp > 0.01) {
    lines.push({
      account_id: accountMap.accounts_payable,
      debit: homeAp,
      description:
        surplus > 0.01 && homeAp - surplus < 0.01
          ? `Supplier prepaid ${paymentNumber}`
          : `AP settlement ${paymentNumber}`
    });
  }
  if (remoteTotal > 0) {
    lines.push({
      account_id: accountMap.inter_branch_clearing,
      debit: remoteTotal,
      description: `Paid for other branches ${paymentNumber}`
    });
  }

  const payJournal: any = await createJournal(
    user,
    {
      ...common,
      memo: `Supplier payment ${paymentNumber} — ${input.supplierName}`,
      idempotency_key: `supplier_payment:${paymentId}`,
      branch_id: input.payingBranchId,
      lines
    },
    tx
  );

  for (const [branchId, apDebit] of remote) {
    await createJournal(
      user,
      {
        ...common,
        memo: `Supplier payment ${paymentNumber} paid in another branch — ${input.supplierName}`,
        idempotency_key: `supplier_payment:${paymentId}:${branchId}`,
        branch_id: branchId,
        lines: [
          {
            account_id: accountMap.accounts_payable,
            debit: apDebit,
            description: `AP settlement ${paymentNumber}`
          },
          {
            account_id: accountMap.inter_branch_clearing,
            credit: apDebit,
            description: `Paid by another branch — ${paymentNumber}`
          }
        ]
      },
      tx,
      { trustedBranch: true }
    );
  }

  for (const s of splits) {
    const bill = bills.find((b) => b.id === s.billId)!;
    const paid = roundMoney(Number(bill.amountPaid) + s.ap);
    const total = roundMoney(Number(bill.totalAmount));
    const newBal = roundMoney(Math.max(0, Number(bill.balance) - s.ap));
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: {
        amountPaid: toDec(paid),
        balance: toDec(newBal),
        status: billStatusFor(total, paid)
      }
    });
  }

  const payment = await tx.supplierPayment.create({
    data: {
      id: paymentId,
      businessId: user.businessId,
      branchId: input.payingBranchId,
      supplierId: input.supplierId,
      paymentNumber,
      paymentDate: input.paymentDate || new Date(),
      amount: toDec(amount),
      // Tracks advance / overpay still available to apply to later bills (memo; GL lives on AP).
      unappliedAmount: toDec(Math.max(0, surplus)),
      method: input.method,
      accountId: input.accountId,
      reference: input.reference || null,
      notes: input.notes || null,
      journalEntryId: payJournal.id,
      idempotencyKey: input.idempotencyKey || null,
      createdById: user.id,
      allocations: {
        create: splits.map((s) => ({
          id: shortId('spa'),
          billId: s.billId,
          amount: toDec(s.ap)
        }))
      }
    },
    include: { supplier: true, account: true, allocations: { include: { bill: true } } }
  });
  return { payment, replayed: false };
}

/** Oldest-first allocation across the supplier's open bills in every branch. */
export async function autoAllocateBills(businessId: string, supplierId: string, amount: number) {
  const open = await prisma.supplierBill.findMany({
    where: {
      businessId,
      supplierId,
      status: { in: ['open', 'partial'] },
      balance: { gt: 0 }
    },
    orderBy: [{ billDate: 'asc' }, { createdAt: 'asc' }]
  });
  let remaining = roundMoney(amount);
  const out: SupplierPaymentAllocationInput[] = [];
  for (const bill of open) {
    if (remaining <= 0) break;
    const apply = roundMoney(Math.min(Number(bill.balance), remaining));
    if (apply <= 0) continue;
    out.push({ billId: bill.id, amount: apply });
    remaining = roundMoney(remaining - apply);
  }
  return out;
}

/**
 * When a new AP bill opens, apply free supplier prepaid (unappliedAmount) to the bill balance
 * with no GL — cash already sits on AP.
 */
export async function consumePrepaidAgainstBillBalance(
  tx: Tx,
  businessId: string,
  supplierId: string,
  billId: string
) {
  const bill = await tx.supplierBill.findFirst({
    where: { id: billId, businessId, supplierId, status: { in: ['open', 'partial'] } }
  });
  if (!bill) return 0;
  let due = roundMoney(Math.max(0, Number(bill.balance)));
  if (due <= 0.01) return 0;

  const credits = await tx.supplierPayment.findMany({
    where: { businessId, supplierId, unappliedAmount: { gt: 0 } },
    orderBy: { paymentDate: 'asc' }
  });
  let applied = 0;
  for (const c of credits) {
    if (due <= 0.01) break;
    const take = roundMoney(Math.min(Number(c.unappliedAmount), due));
    if (take <= 0) continue;
    await tx.supplierPayment.update({
      where: { id: c.id },
      data: { unappliedAmount: toDec(roundMoney(Number(c.unappliedAmount) - take)) }
    });
    await tx.supplierPaymentAllocation.create({
      data: {
        id: shortId('spa'),
        paymentId: c.id,
        billId: bill.id,
        amount: toDec(take)
      }
    });
    due = roundMoney(due - take);
    applied = roundMoney(applied + take);
  }
  if (applied <= 0.01) return 0;

  const paid = roundMoney(Number(bill.amountPaid) + applied);
  const total = roundMoney(Number(bill.totalAmount));
  await tx.supplierBill.update({
    where: { id: bill.id },
    data: {
      amountPaid: toDec(paid),
      balance: toDec(Math.max(0, roundMoney(Number(bill.balance) - applied))),
      status: billStatusFor(total, paid)
    }
  });
  return applied;
}

/** Sum of supplier prepaid still available to apply to bills (advances / overpays on AP). */
export async function supplierPrepaidCredit(businessId: string, supplierId: string) {
  const [rows, balances] = await Promise.all([
    prisma.supplierPayment.findMany({
      where: { businessId, supplierId, unappliedAmount: { gt: 0 } },
      select: {
        id: true,
        paymentNumber: true,
        unappliedAmount: true,
        method: true,
        paymentDate: true,
        reference: true
      },
      orderBy: { paymentDate: 'asc' }
    }),
    partnerLineBalances(businessId, 'supplier', supplierId)
  ]);
  const total = roundMoney(rows.reduce((s, r) => s + Number(r.unappliedAmount), 0));
  const balance = roundMoney(balances.get(supplierId) ?? 0);
  return { total, payments: rows, balance };
}
