import { prisma } from '../utils/prisma.js';
import {
  httpError,
  nextDocNumber,
  requireString,
  roundMoney,
  serialize,
  shortId,
  toDec
} from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import { createJournal, getDefaultAccountMap } from './accounting.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

async function nextTxnNumber(businessId: string) {
  return nextDocNumber(prisma.bankTransaction, businessId, 'txnNumber', 'BTX', 5);
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

async function findBankByGl(businessId: string, glAccountId: string) {
  return prisma.bankAccount.findFirst({
    where: { businessId, glAccountId, isActive: true },
    include: { glAccount: true }
  });
}

/** Transfer cash/bank: Dr destination GL / Cr source GL (till ↔ bank ↔ bank). */
export async function transfer(user: AuthUser, body: Record<string, any>) {
  const amount = roundMoney(Number(body.amount));
  if (!amount || amount <= 0) throw httpError(400, 'amount must be > 0');

  let fromBank =
    body.from_bank_account_id || body.fromBankAccountId
      ? await getBankAccount(
          user.businessId,
          requireString(body.from_bank_account_id || body.fromBankAccountId, 'from_bank_account_id')
        )
      : null;
  let toBank =
    body.to_bank_account_id || body.toBankAccountId
      ? await getBankAccount(
          user.businessId,
          requireString(body.to_bank_account_id || body.toBankAccountId, 'to_bank_account_id')
        )
      : null;

  let fromGlId = String(
    body.from_account_id || body.fromAccountId || fromBank?.glAccountId || ''
  ).trim();
  let toGlId = String(body.to_account_id || body.toAccountId || toBank?.glAccountId || '').trim();

  if (!fromGlId) throw httpError(400, 'from_account_id (From GL) is required');
  if (!toGlId) throw httpError(400, 'to_account_id (To GL) is required');
  if (fromGlId === toGlId) throw httpError(400, 'From GL and To GL must differ');

  const [fromAcc, toAcc] = await Promise.all([
    prisma.account.findFirst({ where: { id: fromGlId, businessId: user.businessId } }),
    prisma.account.findFirst({ where: { id: toGlId, businessId: user.businessId } })
  ]);
  if (!fromAcc) throw httpError(400, 'Invalid From GL account');
  if (!toAcc) throw httpError(400, 'Invalid To GL account');
  if (fromAcc.accountType !== 'asset' || toAcc.accountType !== 'asset') {
    throw httpError(400, 'From GL and To GL must both be asset (cash / bank) accounts');
  }

  if (!fromBank) fromBank = await findBankByGl(user.businessId, fromGlId);
  if (!toBank) toBank = await findBankByGl(user.businessId, toGlId);

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id ||
      body.branchId ||
      fromBank?.branchId ||
      toBank?.branchId ||
      user.activeBranchId
  );

  const txnId = shortId('btx');
  const txnNumber = await nextTxnNumber(user.businessId);
  const memo =
    body.memo ||
    `Move ${fromAcc.code} ${fromAcc.name} → ${toAcc.code} ${toAcc.name}`;

  const result = await prisma.$transaction(async (tx) => {
    const journal = await createJournal(
      user,
      {
        entry_date: body.txn_date || body.txnDate || new Date(),
        memo,
        source_type: 'bank_transfer',
        source_id: txnId,
        idempotency_key: `bank_transfer:${txnId}`,
        branch_id: branchId,
        post: true,
        lines: [
          {
            account_id: toGlId,
            debit: amount,
            description: `Transfer in ${toAcc.code} — ${toAcc.name}`
          },
          {
            account_id: fromGlId,
            credit: amount,
            description: `Transfer out ${fromAcc.code} — ${fromAcc.name}`
          }
        ]
      },
      tx
    );

    // Prefer a bank-account row for the transactions register when available
    const primaryBank = fromBank || toBank;
    if (!primaryBank) {
      return {
        id: txnId,
        txnNumber,
        type: 'transfer',
        amount,
        memo,
        journalEntryId: (journal as any).id,
        from_account: fromAcc,
        to_account: toAcc,
        bankAccount: null
      };
    }

    return tx.bankTransaction.create({
      data: {
        id: txnId,
        businessId: user.businessId,
        branchId,
        bankAccountId: primaryBank.id,
        txnNumber,
        txnDate: body.txn_date || body.txnDate ? new Date(body.txn_date || body.txnDate) : new Date(),
        type: 'transfer',
        amount: toDec(amount),
        counterpartyBankAccountId:
          fromBank && toBank ? (primaryBank.id === fromBank.id ? toBank.id : fromBank.id) : null,
        offsetAccountId: !fromBank || !toBank ? (!fromBank ? fromGlId : toGlId) : null,
        memo: body.memo || null,
        reference: body.reference || null,
        journalEntryId: (journal as any).id,
        createdById: user.id
      },
      include: { bankAccount: true, counterpartyBankAccount: true, offsetAccount: true }
    });
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'banking',
    entityType: 'BankTransaction',
    entityId: txnId,
    summary: `Move ${amount} ${fromAcc.code} → ${toAcc.code}`
  });
  return serialize(result);
}
