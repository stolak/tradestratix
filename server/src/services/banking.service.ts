import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

async function nextTxnNumber(businessId: string) {
  const count = await prisma.bankTransaction.count({ where: { businessId } });
  return `BTX-${String(count + 1).padStart(5, '0')}`;
}

export async function listBankAccounts(user: AuthUser, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.bankAccount.findMany({
    where: { businessId: user.businessId, ...scope },
    include: { glAccount: true, _count: { select: { transactions: true } } },
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createBankAccount(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const map = await getDefaultAccountMap(user.businessId);
  const glAccountId = body.gl_account_id || body.glAccountId || map.bank;
  if (!glAccountId) throw httpError(400, 'gl_account_id is required (or configure default bank account)');

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );

  const gl = await prisma.account.findFirst({
    where: { id: glAccountId, businessId: user.businessId }
  });
  if (!gl) throw httpError(400, 'Invalid gl_account_id');

  const row = await prisma.bankAccount.create({
    data: {
      id: shortId('bnk'),
      businessId: user.businessId,
      branchId,
      name,
      bankName: body.bank_name || body.bankName || null,
      accountNumber: body.account_number || body.accountNumber || null,
      currencyCode: body.currency_code || body.currencyCode || 'NGN',
      glAccountId,
      openingBalance: Number(body.opening_balance ?? body.openingBalance ?? 0),
      notes: body.notes || null,
      createdById: user.id
    },
    include: { glAccount: true }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'banking',
    entityType: 'BankAccount',
    entityId: row.id,
    summary: `Created bank account ${name}`
  });
  return serialize(row);
}

export async function listBankTransactions(
  user: AuthUser,
  bankAccountId?: string,
  opts?: BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.bankTransaction.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(bankAccountId ? { bankAccountId } : {})
    },
    include: {
      bankAccount: true,
      counterpartyBankAccount: true,
      offsetAccount: true
    },
    orderBy: { txnDate: 'desc' },
    take: 100
  });
  return serialize(rows);
}

async function getBankAccount(businessId: string, id: string) {
  const row = await prisma.bankAccount.findFirst({
    where: { id, businessId, isActive: true },
    include: { glAccount: true }
  });
  if (!row) throw httpError(404, 'Bank account not found');
  return row;
}

/** Deposit: Dr bank GL / Cr offset (default cash or equity) */
export async function deposit(user: AuthUser, body: Record<string, any>) {
  const bankAccountId = requireString(body.bank_account_id || body.bankAccountId, 'bank_account_id');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be > 0');

  const bank = await getBankAccount(user.businessId, bankAccountId);
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || bank.branchId || user.activeBranchId
  );
  const map = await getDefaultAccountMap(user.businessId);
  const offsetAccountId =
    body.offset_account_id || body.offsetAccountId || map.cash || map.equity;
  if (!offsetAccountId) throw httpError(400, 'offset_account_id is required');

  const txnId = shortId('btx');
  const txnNumber = await nextTxnNumber(user.businessId);

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: body.txn_date || body.txnDate || new Date(),
        memo: body.memo || `Bank deposit ${txnNumber}`,
        source_type: 'bank_deposit',
        source_id: txnId,
        idempotency_key: `bank_deposit:${txnId}`,
        branch_id: branchId,
        post: true,
        lines: [
          { account_id: bank.glAccountId, debit: amount, description: `Deposit to ${bank.name}` },
          { account_id: offsetAccountId, credit: amount, description: body.memo || 'Deposit source' }
        ]
      },
      tx
    );

    return tx.bankTransaction.create({
      data: {
        id: txnId,
        businessId: user.businessId,
        branchId,
        bankAccountId,
        txnNumber,
        txnDate: body.txn_date || body.txnDate ? new Date(body.txn_date || body.txnDate) : new Date(),
        type: 'deposit',
        amount: toDec(amount),
        offsetAccountId,
        memo: body.memo || null,
        reference: body.reference || null,
        journalEntryId: (journal as any).id,
        createdById: user.id
      },
      include: { bankAccount: true, offsetAccount: true }
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'banking',
    entityType: 'BankTransaction',
    entityId: txnId,
    summary: `Deposit ${amount} to ${bank.name}`
  });
  return serialize(result);
}

/** Withdrawal: Dr offset (expense/equity) / Cr bank GL */
export async function withdraw(user: AuthUser, body: Record<string, any>) {
  const bankAccountId = requireString(body.bank_account_id || body.bankAccountId, 'bank_account_id');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be > 0');

  const bank = await getBankAccount(user.businessId, bankAccountId);
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || bank.branchId || user.activeBranchId
  );
  const map = await getDefaultAccountMap(user.businessId);
  const offsetAccountId =
    body.offset_account_id || body.offsetAccountId || map.expense || map.equity;
  if (!offsetAccountId) throw httpError(400, 'offset_account_id is required');

  const txnId = shortId('btx');
  const txnNumber = await nextTxnNumber(user.businessId);

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: body.txn_date || body.txnDate || new Date(),
        memo: body.memo || `Bank withdrawal ${txnNumber}`,
        source_type: 'bank_withdrawal',
        source_id: txnId,
        idempotency_key: `bank_withdrawal:${txnId}`,
        branch_id: branchId,
        post: true,
        lines: [
          {
            account_id: offsetAccountId,
            debit: amount,
            description: body.memo || 'Withdrawal use'
          },
          {
            account_id: bank.glAccountId,
            credit: amount,
            description: `Withdrawal from ${bank.name}`
          }
        ]
      },
      tx
    );

    return tx.bankTransaction.create({
      data: {
        id: txnId,
        businessId: user.businessId,
        branchId,
        bankAccountId,
        txnNumber,
        txnDate: body.txn_date || body.txnDate ? new Date(body.txn_date || body.txnDate) : new Date(),
        type: 'withdrawal',
        amount: toDec(amount),
        offsetAccountId,
        memo: body.memo || null,
        reference: body.reference || null,
        journalEntryId: (journal as any).id,
        createdById: user.id
      },
      include: { bankAccount: true, offsetAccount: true }
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'banking',
    entityType: 'BankTransaction',
    entityId: txnId,
    summary: `Withdrawal ${amount} from ${bank.name}`
  });
  return serialize(result);
}

/** Transfer: Dr destination bank GL / Cr source bank GL */
export async function transfer(user: AuthUser, body: Record<string, any>) {
  const fromId = requireString(
    body.from_bank_account_id || body.fromBankAccountId,
    'from_bank_account_id'
  );
  const toId = requireString(
    body.to_bank_account_id || body.toBankAccountId,
    'to_bank_account_id'
  );
  if (fromId === toId) throw httpError(400, 'Source and destination must differ');
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be > 0');

  const from = await getBankAccount(user.businessId, fromId);
  const to = await getBankAccount(user.businessId, toId);
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || from.branchId || user.activeBranchId
  );

  const txnId = shortId('btx');
  const txnNumber = await nextTxnNumber(user.businessId);

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: body.txn_date || body.txnDate || new Date(),
        memo: body.memo || `Transfer ${from.name} → ${to.name}`,
        source_type: 'bank_transfer',
        source_id: txnId,
        idempotency_key: `bank_transfer:${txnId}`,
        branch_id: branchId,
        post: true,
        lines: [
          { account_id: to.glAccountId, debit: amount, description: `Transfer in ${to.name}` },
          { account_id: from.glAccountId, credit: amount, description: `Transfer out ${from.name}` }
        ]
      },
      tx
    );

    return tx.bankTransaction.create({
      data: {
        id: txnId,
        businessId: user.businessId,
        branchId,
        bankAccountId: fromId,
        txnNumber,
        txnDate: body.txn_date || body.txnDate ? new Date(body.txn_date || body.txnDate) : new Date(),
        type: 'transfer',
        amount: toDec(amount),
        counterpartyBankAccountId: toId,
        memo: body.memo || null,
        reference: body.reference || null,
        journalEntryId: (journal as any).id,
        createdById: user.id
      },
      include: { bankAccount: true, counterpartyBankAccount: true }
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'banking',
    entityType: 'BankTransaction',
    entityId: txnId,
    summary: `Transfer ${amount} ${from.name} → ${to.name}`
  });
  return serialize(result);
}
