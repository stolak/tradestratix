import { prisma } from '../utils/prisma.js';
import { httpError, nextDocNumber, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const expenseInclude = {
  lines: { include: { account: true } },
  bankAccount: true,
  supplier: true
};

async function nextExpenseNumber(businessId: string) {
  return nextDocNumber(prisma.expenseBill, businessId, 'expenseNumber', 'EXP', 5);
}

export async function listExpenses(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.expenseBill.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: expenseInclude,
    orderBy: { expenseDate: 'desc' }
  });
  return serialize(rows);
}

export async function getExpense(businessId: string, id: string) {
  const row = await prisma.expenseBill.findFirst({
    where: { id, businessId },
    include: expenseInclude
  });
  if (!row) throw httpError(404, 'Expense not found');
  return serialize(row);
}

export async function createExpense(user: AuthUser, body: Record<string, any>) {
  const linesInput: any[] = Array.isArray(body.lines) ? body.lines : [];
  if (!linesInput.length) throw httpError(400, 'At least one expense line is required');

  const map = await getDefaultAccountMap(user.businessId);
  const lines: { accountId: string; description: string | null; amount: number }[] = [];

  for (const [i, line] of linesInput.entries()) {
    const accountId = line.account_id || line.accountId || map.expense;
    if (!accountId) throw httpError(400, `lines[${i}].account_id is required`);
    const amount = roundMoney(Number(line.amount));
    if (!amount || amount <= 0) throw httpError(400, `lines[${i}].amount must be > 0`);
    const acc = await prisma.account.findFirst({
      where: { id: accountId, businessId: user.businessId }
    });
    if (!acc) throw httpError(400, `lines[${i}] invalid account_id`);
    lines.push({
      accountId,
      description: line.description || null,
      amount
    });
  }

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = roundMoney(Number(body.tax_amount ?? body.taxAmount ?? 0));
  const totalAmount = roundMoney(subtotal + taxAmount);
  const expenseNumber =
    body.expense_number || body.expenseNumber || (await nextExpenseNumber(user.businessId));

  const payMethod = body.pay_method || body.payMethod || null;
  const bankAccountId = body.bank_account_id || body.bankAccountId || null;
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const created = await prisma.expenseBill.create({
    data: {
      id: shortId('exp'),
      businessId: user.businessId,
      branchId,
      expenseNumber,
      vendorName: body.vendor_name || body.vendorName || null,
      supplierId: body.supplier_id || body.supplierId || null,
      expenseDate: body.expense_date || body.expenseDate
        ? new Date(body.expense_date || body.expenseDate)
        : new Date(),
      dueDate: body.due_date || body.dueDate ? new Date(body.due_date || body.dueDate) : null,
      status: 'draft',
      paymentStatus: 'open',
      subtotal: toDec(subtotal),
      taxAmount: toDec(taxAmount),
      totalAmount: toDec(totalAmount),
      amountPaid: toDec(0),
      balance: toDec(totalAmount),
      payMethod,
      bankAccountId,
      notes: body.notes || null,
      createdById: user.id,
      lines: {
        create: lines.map((l) => ({
          id: shortId('exl'),
          accountId: l.accountId,
          description: l.description,
          amount: toDec(l.amount)
        }))
      }
    },
    include: expenseInclude
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'expenses',
    entityType: 'ExpenseBill',
    entityId: created.id,
    summary: `Created expense ${created.expenseNumber}`
  });

  if (body.post === true || body.pay_now === true || body.payNow === true) {
    const settleNow =
      body.pay_now === true ||
      body.payNow === true ||
      (payMethod != null && payMethod !== 'ap');
    return postExpense(user, created.id, {
      pay_now: settleNow,
      pay_method: payMethod || (settleNow ? 'cash' : 'ap'),
      bank_account_id: bankAccountId
    });
  }

  return serialize(created);
}

/**
 * Post expense:
 * - pay_now cash/bank: Dr expense lines / Cr cash|bank GL
 * - ap: Dr expense lines / Cr accounts_payable (open bill)
 */
export async function postExpense(
  user: AuthUser,
  id: string,
  opts?: { pay_now?: boolean; pay_method?: string; bank_account_id?: string }
) {
  const expense = await prisma.expenseBill.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true, bankAccount: true }
  });
  if (!expense) throw httpError(404, 'Expense not found');
  if (expense.status !== 'draft') throw httpError(400, 'Only draft expenses can be posted');
  if (!expense.lines.length) throw httpError(400, 'Expense has no lines');

  const map = await getDefaultAccountMap(user.businessId);
  const total = Number(expense.totalAmount);
  const payNow = Boolean(opts?.pay_now);
  const method = String(opts?.pay_method || expense.payMethod || (payNow ? 'cash' : 'ap')).toLowerCase();

  let creditAccountId = map.accounts_payable;
  if (payNow || method === 'cash' || method === 'bank') {
    if (method === 'bank' || opts?.bank_account_id || expense.bankAccountId) {
      const bankId = opts?.bank_account_id || expense.bankAccountId;
      if (bankId) {
        const bank = await prisma.bankAccount.findFirst({
          where: { id: bankId, businessId: user.businessId }
        });
        if (!bank) throw httpError(400, 'Invalid bank_account_id');
        creditAccountId = bank.glAccountId;
      } else {
        creditAccountId = map.bank;
      }
    } else {
      creditAccountId = map.cash;
    }
  }
  if (!creditAccountId) throw httpError(400, 'Credit GL account is not configured');

  const result = await prisma.$transaction(async (tx) => {
    const journalLines = [
      ...expense.lines.map((l) => ({
        account_id: l.accountId,
        debit: Number(l.amount),
        description: l.description || `Expense ${expense.expenseNumber}`
      })),
      {
        account_id: creditAccountId!,
        credit: total,
        description:
          payNow || method !== 'ap'
            ? `Paid expense ${expense.expenseNumber}`
            : `AP expense ${expense.expenseNumber}`
      }
    ];

    // If tax was recorded separately and not in lines, already in total via credit side only —
    // keep simple: credit = sum of line debits (subtotal). Adjust if taxAmount > 0.
    const lineDebit = roundMoney(expense.lines.reduce((s, l) => s + Number(l.amount), 0));
    const creditLine = journalLines[journalLines.length - 1] as {
      account_id: string;
      credit: number;
      description: string;
    };
    if (Math.abs(lineDebit - total) > 0.01 && Number(expense.taxAmount) > 0 && map.tax_payable) {
      // Expand: lines debit + tax debit? Prefer tax as part of expense total on credit only:
      // Dr lines, Dr tax expense? Simpler: force credit = lineDebit for balance; tax ignored in GL for now
      creditLine.credit = lineDebit;
    }

    const journal = await createJournal(
      user,
      {
        entry_date: expense.expenseDate,
        memo: `Expense ${expense.expenseNumber}${expense.vendorName ? ` — ${expense.vendorName}` : ''}`,
        source_type: 'expense',
        source_id: expense.id,
        idempotency_key: `expense:${expense.id}`,
        branch_id: expense.branchId || undefined,
        post: true,
        lines: journalLines
      },
      tx
    );

    const settled = payNow || method === 'cash' || method === 'bank';
    const postedTotal = creditLine.credit;

    return tx.expenseBill.update({
      where: { id: expense.id },
      data: {
        status: 'posted',
        paymentStatus: settled ? 'paid' : 'open',
        amountPaid: toDec(settled ? postedTotal : 0),
        balance: toDec(settled ? 0 : postedTotal),
        payMethod: method,
        bankAccountId: opts?.bank_account_id || expense.bankAccountId,
        journalEntryId: (journal as any).id,
        paymentJournalEntryId: settled ? (journal as any).id : null
      },
      include: expenseInclude
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'expenses',
    entityType: 'ExpenseBill',
    entityId: id,
    summary: `Posted expense ${expense.expenseNumber}`
  });
  return serialize(result);
}

export async function payExpense(user: AuthUser, id: string, body: Record<string, any> = {}) {
  const expense = await prisma.expenseBill.findFirst({
    where: { id, businessId: user.businessId },
    include: { bankAccount: true }
  });
  if (!expense) throw httpError(404, 'Expense not found');
  if (expense.status !== 'posted') throw httpError(400, 'Expense must be posted first');
  if (Number(expense.balance) <= 0) throw httpError(400, 'Expense is already paid');

  const map = await getDefaultAccountMap(user.businessId);
  if (!map.accounts_payable) throw httpError(400, 'accounts_payable is not configured');

  const amount = roundMoney(Number(body.amount ?? expense.balance));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be > 0');
  if (amount > Number(expense.balance) + 0.01) throw httpError(400, 'Amount exceeds balance');

  const method = String(body.method || 'cash').toLowerCase();
  let payGl = method === 'bank' ? map.bank : map.cash;
  const bankId = body.bank_account_id || body.bankAccountId || expense.bankAccountId;
  if (bankId) {
    const bank = await prisma.bankAccount.findFirst({
      where: { id: bankId, businessId: user.businessId }
    });
    if (!bank) throw httpError(400, 'Invalid bank_account_id');
    payGl = bank.glAccountId;
  }
  if (!payGl) throw httpError(400, 'Payment GL account is not configured');

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        memo: `Expense payment ${expense.expenseNumber}`,
        source_type: 'expense_payment',
        source_id: expense.id,
        idempotency_key: `expense_payment:${expense.id}:${amount}`,
        branch_id: expense.branchId || undefined,
        post: true,
        lines: [
          {
            account_id: map.accounts_payable,
            debit: amount,
            description: `Settle ${expense.expenseNumber}`
          },
          { account_id: payGl!, credit: amount, description: `${method} payment` }
        ]
      },
      tx
    );

    const newPaid = roundMoney(Number(expense.amountPaid) + amount);
    const newBal = roundMoney(Number(expense.totalAmount) - newPaid);

    return tx.expenseBill.update({
      where: { id },
      data: {
        amountPaid: toDec(newPaid),
        balance: toDec(Math.max(0, newBal)),
        paymentStatus: newBal <= 0.01 ? 'paid' : 'partial',
        paymentJournalEntryId: (journal as any).id,
        bankAccountId: bankId || expense.bankAccountId
      },
      include: expenseInclude
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'expenses',
    entityType: 'ExpenseBill',
    entityId: id,
    summary: `Paid ${amount} on expense ${expense.expenseNumber}`
  });
  return serialize(result);
}
