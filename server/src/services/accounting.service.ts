import { Prisma } from '@prisma/client';
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
import * as branchAccess from './branch-access.service.js';
import {
  getDefaultAccountMap as loadDefaultAccountMap,
  listDefaultAccountSettingsStatus,
  requireDefaultAccountIds,
  resolveDefaultAccounts,
  upsertDefaultAccountSetting,
  listDefaultAccountCatalog
} from './default-account.service.js';

export {
  requireDefaultAccountIds,
  resolveDefaultAccounts,
  listDefaultAccountSettingsStatus,
  upsertDefaultAccountSetting,
  listDefaultAccountCatalog
};

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs']);

export async function listAccounts(businessId: string) {
  const accounts = await prisma.account.findMany({
    where: { businessId },
    orderBy: { code: 'asc' }
  });
  return serialize(accounts);
}

async function assertValidParent(
  businessId: string,
  parentId: string | null | undefined,
  accountType: string
) {
  if (!parentId) return null;
  const parent = await prisma.account.findFirst({ where: { id: parentId, businessId } });
  if (!parent) throw httpError(400, 'Parent account not found');
  if (parent.accountType !== accountType) {
    throw httpError(
      400,
      `Parent account type (${parent.accountType}) must match child type (${accountType})`
    );
  }
  return parent;
}

export async function createAccount(user: AuthUser, body: Record<string, any>) {
  const accountType = String(body.account_type || body.accountType || '');
  if (!ACCOUNT_TYPES.has(accountType)) throw httpError(400, 'Invalid account_type');
  const code = requireString(body.code, 'code');
  const name = requireString(body.name, 'name');
  const parentId = body.parent_id || body.parentId || null;
  await assertValidParent(user.businessId, parentId, accountType);

  try {
    const created = await prisma.account.create({
      data: {
        id: shortId('acc'),
        businessId: user.businessId,
        code,
        name,
        accountType,
        parentId,
        isActive: body.is_active !== false && body.isActive !== false,
        description: body.description || null
      }
    });
    return serialize(created);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'An account with this code already exists');
    throw err;
  }
}

export async function updateAccount(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.account.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Account not found');

  if (body.account_type != null || body.accountType != null) {
    const nextType = String(body.account_type ?? body.accountType);
    if (!ACCOUNT_TYPES.has(nextType)) throw httpError(400, 'Invalid account_type');
  }

  const nextType = String(body.account_type ?? body.accountType ?? existing.accountType);
  const nextParentId =
    body.parent_id !== undefined || body.parentId !== undefined
      ? body.parent_id ?? body.parentId ?? null
      : existing.parentId;

  if (nextParentId === id) throw httpError(400, 'An account cannot be its own parent');
  await assertValidParent(user.businessId, nextParentId, nextType);

  if (nextParentId) {
    let cursor: string | null = nextParentId;
    const seen = new Set<string>([id]);
    while (cursor) {
      if (seen.has(cursor)) {
        throw httpError(400, 'Invalid parent: would create a circular hierarchy');
      }
      seen.add(cursor);
      const row = await prisma.account.findFirst({
        where: { id: cursor, businessId: user.businessId },
        select: { parentId: true }
      });
      cursor = row?.parentId || null;
    }
  }

  try {
    const updated = await prisma.account.update({
      where: { id },
      data: {
        ...(body.code != null ? { code: String(body.code).trim() } : {}),
        ...(body.name != null ? { name: String(body.name).trim() } : {}),
        ...(body.account_type != null || body.accountType != null
          ? { accountType: nextType }
          : {}),
        ...(body.parent_id !== undefined || body.parentId !== undefined
          ? { parentId: nextParentId }
          : {}),
        ...(body.description !== undefined
          ? { description: body.description ? String(body.description) : null }
          : {}),
        ...(body.is_active !== undefined || body.isActive !== undefined
          ? { isActive: body.is_active ?? body.isActive }
          : {})
      }
    });
    return serialize(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'An account with this code already exists');
    throw err;
  }
}

export async function getDefaultAccountMap(businessId: string): Promise<Record<string, string>> {
  return loadDefaultAccountMap(businessId);
}

export async function listDefaultAccountSettings(businessId: string) {
  const rows = await prisma.defaultAccountSetting.findMany({
    where: { businessId },
    include: { account: true }
  });
  return serialize(rows);
}

async function assertEntityInBusiness(
  businessId: string,
  opts: {
    customerId?: string | null;
    supplierId?: string | null;
    salesRepresentativeId?: string | null;
  }
) {
  if (opts.customerId) {
    const row = await prisma.customer.findFirst({
      where: { id: opts.customerId, businessId },
      select: { id: true }
    });
    if (!row) throw httpError(400, 'customer_id is invalid for this business');
  }
  if (opts.supplierId) {
    const row = await prisma.supplier.findFirst({
      where: { id: opts.supplierId, businessId },
      select: { id: true }
    });
    if (!row) throw httpError(400, 'supplier_id is invalid for this business');
  }
  if (opts.salesRepresentativeId) {
    const row = await prisma.salesRep.findFirst({
      where: { id: opts.salesRepresentativeId, businessId },
      select: { id: true }
    });
    if (!row) throw httpError(400, 'sales_representative_id is invalid for this business');
  }
}

type JournalLineInput = {
  account_id?: string;
  accountId?: string;
  description?: string;
  debit?: number;
  credit?: number;
  /** Optional explicit stamp; otherwise auto-set on control accounts from the header. */
  customer_id?: string | null;
  customerId?: string | null;
  supplier_id?: string | null;
  supplierId?: string | null;
  sales_representative_id?: string | null;
  salesRepresentativeId?: string | null;
};

/** Default-account keys whose lines carry partner balance (never revenue/cash/expense counterparts). */
const CUSTOMER_BALANCE_ACCOUNT_KEYS = ['accounts_receivable'] as const;
const SUPPLIER_BALANCE_ACCOUNT_KEYS = ['accounts_payable'] as const;
const SALES_REP_BALANCE_ACCOUNT_KEYS = [
  'cash_in_custody_sales_rep',
  'sales_rep_commission_payable',
  'sales_rep_receivable'
] as const;

async function controlAccountIdSets(businessId: string) {
  const map = await loadDefaultAccountMap(businessId);
  const pick = (keys: readonly string[]) =>
    new Set(keys.map((k) => map[k]).filter(Boolean) as string[]);
  return {
    customer: pick(CUSTOMER_BALANCE_ACCOUNT_KEYS),
    supplier: pick(SUPPLIER_BALANCE_ACCOUNT_KEYS),
    salesRep: pick(SALES_REP_BALANCE_ACCOUNT_KEYS)
  };
}

/**
 * Partner balances from journal *lines* stamped with entity ids (stable if default AR/AP mapping changes).
 * Customer / sales-rep: Σ debit − Σ credit. Supplier (AP): Σ credit − Σ debit (amount owed).
 * Sales-rep balances only include control accounts (custody / commission payable / recoveries),
 * so walk-in AR history does not inflate "cash to retire".
 */
export async function partnerLineBalances(
  businessId: string,
  kind: 'customer' | 'supplier' | 'sales_representative',
  entityId?: string
) {
  const column =
    kind === 'customer'
      ? 'customer_id'
      : kind === 'supplier'
        ? 'supplier_id'
        : 'sales_representative_id';

  let accountFilterSql = '';
  const accountParams: string[] = [];
  if (kind === 'sales_representative') {
    const sets = await controlAccountIdSets(businessId);
    const ids = [...sets.salesRep];
    if (!ids.length) return new Map();
    accountFilterSql = `AND jl.account_id IN (${ids.map(() => '?').join(',')})`;
    accountParams.push(...ids);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ entity_id: string; balance: unknown }>>(
    `SELECT jl.\`${column}\` AS entity_id,
            ${
              kind === 'supplier'
                ? 'SUM(jl.credit) - SUM(jl.debit)'
                : 'SUM(jl.debit) - SUM(jl.credit)'
            } AS balance
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE je.business_id = ?
       AND jl.\`${column}\` IS NOT NULL
       AND je.status IN ('posted', 'reversed')
       ${accountFilterSql}
       ${entityId ? `AND jl.\`${column}\` = ?` : ''}
     GROUP BY jl.\`${column}\``,
    businessId,
    ...accountParams,
    ...(entityId ? [entityId] : [])
  );
  return new Map(rows.map((r) => [r.entity_id, roundMoney(Number(r.balance || 0))]));
}

async function nextEntryNumber(businessId: string, tx: Prisma.TransactionClient) {
  return nextDocNumber(tx.journalEntry, businessId, 'entryNumber', 'JE', 6);
}

/** Reject posts into locked accounting periods or closed financial years. */
export async function assertPeriodOpen(businessId: string, entryDate: Date | string) {
  const date = entryDate instanceof Date ? entryDate : new Date(entryDate);
  if (Number.isNaN(date.getTime())) throw httpError(400, 'Invalid entry date');

  const period = await prisma.accountingPeriod.findFirst({
    where: {
      businessId,
      startsOn: { lte: date },
      endsOn: { gte: date }
    },
    include: { financialYear: true }
  });

  if (period?.isLocked) {
    throw httpError(400, `Accounting period "${period.name}" is locked`);
  }
  if (period?.financialYear?.isClosed) {
    throw httpError(400, `Financial year "${period.financialYear.name}" is closed`);
  }
}

/** Calendar day key in local time (YYYY-MM-DD). */
function localDayKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve journal transaction_date: explicit input, else now.
 * Backdating is allowed; future dates are rejected.
 */
export function resolveTransactionDate(raw?: string | Date | null): Date {
  const date = raw != null && raw !== '' ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, 'Invalid transaction_date');
  }
  if (localDayKey(date) > localDayKey(new Date())) {
    throw httpError(400, 'transaction_date cannot be in the future');
  }
  return date;
}

/**
 * Central posting engine: creates a balanced journal, optionally posts immediately.
 * Idempotent when idempotency_key or sourceType+sourceId is provided for posted entries.
 */
export async function createJournal(
  user: AuthUser,
  body: {
    entry_date?: string | Date;
    /** Economic / business date (backdatable). Defaults to today; future dates rejected. */
    transaction_date?: string | Date;
    transactionDate?: string | Date;
    memo?: string;
    branch_id?: string;
    branchId?: string;
    customer_id?: string | null;
    customerId?: string | null;
    supplier_id?: string | null;
    supplierId?: string | null;
    sales_representative_id?: string | null;
    salesRepresentativeId?: string | null;
    source_type?: string;
    source_id?: string;
    sourceType?: string;
    sourceId?: string;
    idempotency_key?: string;
    idempotencyKey?: string;
    currency_code?: string;
    currencyCode?: string;
    post?: boolean;
    lines: JournalLineInput[];
  },
  outerTx?: Prisma.TransactionClient,
  /** System postings (e.g. cross-branch fulfilment) may target a branch the operator is not a member of. */
  opts?: { trustedBranch?: boolean }
) {
  const lines = body.lines || [];
  if (lines.length < 2) throw httpError(400, 'Journal requires at least two lines');

  // entryDate = journal booking date; transactionDate = economic date (may be backdated, never future).
  // Legacy callers that only send entry_date are treated as supplying the economic date too.
  const entryDate = body.entry_date ? new Date(body.entry_date) : new Date();
  if (Number.isNaN(entryDate.getTime())) throw httpError(400, 'Invalid entry_date');
  const transactionDate = resolveTransactionDate(
    body.transaction_date ?? body.transactionDate ?? body.entry_date ?? null
  );
  if (body.post !== false) {
    // Period lock follows the economic date being posted into.
    await assertPeriodOpen(user.businessId, transactionDate);
  }

  const customerId = body.customer_id ?? body.customerId ?? null;
  const supplierId = body.supplier_id ?? body.supplierId ?? null;
  const salesRepresentativeId =
    body.sales_representative_id ?? body.salesRepresentativeId ?? null;

  await assertEntityInBusiness(user.businessId, {
    customerId,
    supplierId,
    salesRepresentativeId
  });

  const controlAccounts = await controlAccountIdSets(user.businessId);
  let walkInCustomer = false;
  if (customerId) {
    const cust = await prisma.customer.findFirst({
      where: { id: customerId, businessId: user.businessId },
      select: { customerType: true, code: true }
    });
    walkInCustomer =
      String(cust?.customerType || '').toLowerCase() === 'walk_in' ||
      String(cust?.code || '').toUpperCase() === 'WALK-IN';
    if (walkInCustomer && !salesRepresentativeId) {
      throw httpError(
        400,
        'Walk-in transactions must be attributed to a sales representative (sales_representative_id)'
      );
    }
  }

  const normalized = lines.map((l, idx) => {
    const accountId = l.account_id || l.accountId;
    if (!accountId) throw httpError(400, `lines[${idx}].account_id is required`);
    const debit = roundMoney(Number(l.debit || 0));
    const credit = roundMoney(Number(l.credit || 0));
    if (debit < 0 || credit < 0) throw httpError(400, 'Debit/credit cannot be negative');
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw httpError(400, `lines[${idx}] must have either debit or credit`);
    }

    let lineCustomerId = (l.customer_id ?? l.customerId ?? null) || null;
    let lineSupplierId = (l.supplier_id ?? l.supplierId ?? null) || null;
    let lineSalesRepId = (l.sales_representative_id ?? l.salesRepresentativeId ?? null) || null;

    // Auto-stamp only the balance-bearing control line from the header (not revenue/cash/expense).
    if (!lineCustomerId && customerId && controlAccounts.customer.has(accountId)) {
      lineCustomerId = customerId;
    }
    if (!lineSupplierId && supplierId && controlAccounts.supplier.has(accountId)) {
      lineSupplierId = supplierId;
    }
    if (!lineSalesRepId && salesRepresentativeId && controlAccounts.salesRep.has(accountId)) {
      lineSalesRepId = salesRepresentativeId;
    }
    // Walk-in cash responsibility lives on Cash in Custody (sales-rep control), not on AR.

    if (lineSupplierId && (lineCustomerId || lineSalesRepId)) {
      throw httpError(
        400,
        `lines[${idx}] cannot combine supplier with customer or sales representative`
      );
    }

    return {
      accountId,
      description: l.description || null,
      debit,
      credit,
      lineNo: idx + 1,
      customerId: lineCustomerId,
      supplierId: lineSupplierId,
      salesRepresentativeId: lineSalesRepId
    };
  });

  const lineEntityIds = {
    customerId: [...new Set(normalized.map((l) => l.customerId).filter(Boolean))] as string[],
    supplierId: [...new Set(normalized.map((l) => l.supplierId).filter(Boolean))] as string[],
    salesRepresentativeId: [
      ...new Set(normalized.map((l) => l.salesRepresentativeId).filter(Boolean))
    ] as string[]
  };
  for (const id of lineEntityIds.customerId) {
    await assertEntityInBusiness(user.businessId, { customerId: id });
  }
  for (const id of lineEntityIds.supplierId) {
    await assertEntityInBusiness(user.businessId, { supplierId: id });
  }
  for (const id of lineEntityIds.salesRepresentativeId) {
    await assertEntityInBusiness(user.businessId, { salesRepresentativeId: id });
  }

  const totalDebit = roundMoney(normalized.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(normalized.reduce((s, l) => s + l.credit, 0));
  if (totalDebit !== totalCredit) {
    throw httpError(400, `Journal unbalanced: debit ${totalDebit} != credit ${totalCredit}`);
  }

  const sourceType = body.source_type || body.sourceType || null;
  const sourceId = body.source_id || body.sourceId || null;
  const idempotencyKey =
    body.idempotency_key ||
    body.idempotencyKey ||
    (sourceType && sourceId ? `${sourceType}:${sourceId}` : null);

  const client = outerTx || prisma;

  if (idempotencyKey) {
    const existing = await client.journalEntry.findFirst({
      where: { businessId: user.businessId, idempotencyKey },
      include: {
        lines: true,
        customer: true,
        supplier: true,
        salesRepresentative: true
      }
    });
    if (existing) return serialize(existing);
  }

  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const accounts = await client.account.findMany({
    where: { businessId: user.businessId, id: { in: accountIds } }
  });
  if (accounts.length !== accountIds.length) {
    throw httpError(400, 'One or more accounts are invalid for this business');
  }
  const inactive = accounts.filter((a) => !a.isActive);
  if (inactive.length) {
    throw httpError(
      400,
      `Cannot post to inactive account(s): ${inactive.map((a) => a.code).join(', ')}`
    );
  }

  const shouldPost = body.post !== false;
  const requestedBranchId = body.branch_id || body.branchId || user.activeBranchId;
  const branchId =
    opts?.trustedBranch && requestedBranchId
      ? (await branchAccess.assertBranchActive(user.businessId, requestedBranchId)).id
      : await branchAccess.resolveWriteBranchId(user, requestedBranchId);

  const run = async (tx: Prisma.TransactionClient) => {
    const entryNumber = await nextEntryNumber(user.businessId, tx);
    return tx.journalEntry.create({
      data: {
        id: shortId('je'),
        businessId: user.businessId,
        branchId,
        customerId,
        supplierId,
        salesRepresentativeId,
        entryNumber,
        entryDate,
        transactionDate,
        memo: body.memo || null,
        status: shouldPost ? 'posted' : 'draft',
        sourceType,
        sourceId,
        idempotencyKey,
        currencyCode: body.currency_code || body.currencyCode || 'NGN',
        postedAt: shouldPost ? new Date() : null,
        postedById: shouldPost ? user.id : null,
        createdById: user.id,
        lines: {
          create: normalized.map((l) => ({
            id: shortId('jl'),
            accountId: l.accountId,
            description: l.description,
            debit: toDec(l.debit),
            credit: toDec(l.credit),
            lineNo: l.lineNo,
            transactionDate,
            customerId: l.customerId,
            supplierId: l.supplierId,
            salesRepresentativeId: l.salesRepresentativeId
          }))
        }
      },
      include: {
        lines: true,
        customer: true,
        supplier: true,
        salesRepresentative: true
      }
    });
  };

  const created = outerTx ? await run(outerTx) : await prisma.$transaction(run);

  await writeAudit({
    user,
    action: shouldPost ? 'post' : 'create',
    module: 'accounting',
    entityType: 'JournalEntry',
    entityId: created.id,
    summary: `${shouldPost ? 'Posted' : 'Drafted'} journal ${created.entryNumber}`
  });

  return serialize(created);
}

export async function postJournal(user: AuthUser, id: string) {
  const entry = await prisma.journalEntry.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: { include: { account: true } } }
  });
  if (!entry) throw httpError(404, 'Journal not found');
  if (entry.status === 'posted') return serialize(entry);
  if (entry.status === 'reversed') throw httpError(400, 'Cannot post a reversed entry');
  if (entry.status !== 'draft') throw httpError(400, 'Only draft journals can be posted');

  await assertPeriodOpen(user.businessId, entry.transactionDate || entry.entryDate);

  const inactive = (entry.lines || [])
    .map((l) => l.account)
    .filter((a) => a && !a.isActive);
  if (inactive.length) {
    throw httpError(
      400,
      `Cannot post to inactive account(s): ${[...new Set(inactive.map((a) => a!.code))].join(', ')}`
    );
  }

  const updated = await prisma.journalEntry.update({
    where: { id },
    data: {
      status: 'posted',
      postedAt: new Date(),
      postedById: user.id
    },
    include: {
      lines: { include: { account: true } },
      customer: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, code: true, name: true } },
      salesRepresentative: {
        select: {
          id: true,
          code: true,
          employee: { select: { id: true, fullName: true, code: true } }
        }
      },
      branch: { select: { id: true, code: true, name: true } }
    }
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'accounting',
    entityType: 'JournalEntry',
    entityId: id,
    summary: `Posted journal ${updated.entryNumber}`
  });

  return serialize(updated);
}

export async function reverseJournal(user: AuthUser, id: string, memo?: string) {
  const original = await prisma.journalEntry.findFirst({
    where: { id, businessId: user.businessId },
    include: { lines: true }
  });
  if (!original) throw httpError(404, 'Journal not found');
  if (original.status !== 'posted') throw httpError(400, 'Only posted journals can be reversed');
  if (original.reversedByEntryId) throw httpError(400, 'Journal already reversed');

  const reversal = await createJournal(user, {
    entry_date: new Date(),
    memo: memo || `Reversal of ${original.entryNumber}`,
    branch_id: original.branchId || undefined,
    customer_id: original.customerId,
    supplier_id: original.supplierId,
    sales_representative_id: original.salesRepresentativeId,
    source_type: 'reversal',
    source_id: original.id,
    idempotency_key: `reversal:${original.id}`,
    currency_code: original.currencyCode,
    post: true,
    lines: original.lines.map((l) => ({
      account_id: l.accountId,
      description: l.description || undefined,
      debit: Number(l.credit),
      credit: Number(l.debit),
      // Copy line stamps explicitly so remapped default AR/AP still reverses partner balances.
      customer_id: l.customerId,
      supplier_id: l.supplierId,
      sales_representative_id: l.salesRepresentativeId
    }))
  });

  await prisma.journalEntry.update({
    where: { id: original.id },
    data: { status: 'reversed', reversedByEntryId: (reversal as any).id }
  });

  return reversal;
}

export async function listJournals(
  user: AuthUser,
  opts?: {
    limit?: number;
    status?: string;
    entryNumber?: string;
    customerId?: string;
    supplierId?: string;
    salesRepresentativeId?: string;
    sourceType?: string;
    from?: string | Date;
    to?: string | Date;
  } & BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const from = opts?.from ? new Date(opts.from) : null;
  const to = opts?.to ? new Date(opts.to) : null;
  if (to && !Number.isNaN(to.getTime()) && typeof opts?.to === 'string' && opts.to.length <= 10) {
    to.setHours(23, 59, 59, 999);
  }
  const entryNumber = (opts?.entryNumber || '').trim();
  const rows = await prisma.journalEntry.findMany({
    where: {
      businessId: user.businessId,
      ...scope,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(entryNumber ? { entryNumber: { contains: entryNumber } } : {}),
      ...(opts?.customerId ? { customerId: opts.customerId } : {}),
      ...(opts?.supplierId ? { supplierId: opts.supplierId } : {}),
      ...(opts?.salesRepresentativeId
        ? { salesRepresentativeId: opts.salesRepresentativeId }
        : {}),
      ...(opts?.sourceType ? { sourceType: opts.sourceType } : {}),
      ...(from || to
        ? {
            entryDate: {
              ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
              ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {})
            }
          }
        : {})
    },
    include: {
      lines: { include: { account: true } },
      customer: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, code: true, name: true } },
      salesRepresentative: {
        select: {
          id: true,
          code: true,
          employee: { select: { id: true, fullName: true, code: true } }
        }
      },
      branch: { select: { id: true, code: true, name: true } }
    },
    orderBy: { entryDate: 'desc' },
    take: opts?.limit ?? 200
  });
  return serialize(
    rows.map((r) => ({
      ...r,
      salesRepresentative: r.salesRepresentative
        ? {
            ...r.salesRepresentative,
            name: r.salesRepresentative.employee?.fullName ?? null
          }
        : null
    }))
  );
}

/** Entity ledger: posted journals for a customer, supplier, or sales rep. */
export async function entityLedger(
  user: AuthUser,
  opts: {
    entityType: 'customer' | 'supplier' | 'sales_representative';
    entityId: string;
    from?: string | Date;
    to?: string | Date;
  } & BranchListOpts
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts.branchId,
    allowConsolidated: opts.allowConsolidated
  });
  await assertEntityInBusiness(user.businessId, {
    customerId: opts.entityType === 'customer' ? opts.entityId : null,
    supplierId: opts.entityType === 'supplier' ? opts.entityId : null,
    salesRepresentativeId: opts.entityType === 'sales_representative' ? opts.entityId : null
  });

  const from = opts.from ? new Date(opts.from) : null;
  const to = opts.to ? new Date(opts.to) : null;
  const entityWhere =
    opts.entityType === 'customer'
      ? { customerId: opts.entityId }
      : opts.entityType === 'supplier'
        ? { supplierId: opts.entityId }
        : { salesRepresentativeId: opts.entityId };

  const rows = await prisma.journalEntry.findMany({
    where: {
      businessId: user.businessId,
      status: { in: ['posted', 'reversed'] },
      ...scope,
      ...entityWhere,
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {})
            }
          }
        : {})
    },
    include: {
      lines: { include: { account: true } },
      branch: { select: { id: true, code: true, name: true } }
    },
    orderBy: { entryDate: 'asc' }
  });

  return serialize({
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    entries: rows
  });
}

export async function trialBalance(user: AuthUser, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: { businessId: user.businessId, status: 'posted', ...scope }
    },
    include: { account: true }
  });

  const map = new Map<
    string,
    { account_id: string; code: string; name: string; account_type: string; debit: number; credit: number }
  >();

  for (const line of lines) {
    const key = line.accountId;
    const cur = map.get(key) || {
      account_id: line.accountId,
      code: line.account.code,
      name: line.account.name,
      account_type: line.account.accountType,
      debit: 0,
      credit: 0
    };
    cur.debit = roundMoney(cur.debit + Number(line.debit));
    cur.credit = roundMoney(cur.credit + Number(line.credit));
    map.set(key, cur);
  }

  const rows = [...map.values()]
    .map((r) => {
      const net = roundMoney(r.debit - r.credit);
      return {
        ...r,
        balance_debit: net > 0 ? net : 0,
        balance_credit: net < 0 ? Math.abs(net) : 0
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = roundMoney(rows.reduce((s, r) => s + r.balance_debit, 0));
  const totalCredit = roundMoney(rows.reduce((s, r) => s + r.balance_credit, 0));

  return { rows, total_debit: totalDebit, total_credit: totalCredit, balanced: totalDebit === totalCredit };
}

export async function listPeriods(businessId: string) {
  const rows = await prisma.accountingPeriod.findMany({
    where: { businessId },
    include: { financialYear: true },
    orderBy: { startsOn: 'asc' }
  });
  return serialize(rows);
}

export async function setPeriodLocked(user: AuthUser, id: string, locked: boolean) {
  const period = await prisma.accountingPeriod.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!period) throw httpError(404, 'Period not found');
  const updated = await prisma.accountingPeriod.update({
    where: { id },
    data: { isLocked: locked },
    include: { financialYear: true }
  });
  await writeAudit({
    user,
    action: 'edit',
    module: 'accounting',
    entityType: 'AccountingPeriod',
    entityId: id,
    summary: `${locked ? 'Locked' : 'Unlocked'} period ${updated.name}`
  });
  return serialize(updated);
}

function accountNet(debit: number, credit: number, accountType: string) {
  // Assets/expenses/cogs: debit-normal; liabilities/equity/revenue: credit-normal
  const debitNormal = ['asset', 'expense', 'cogs'].includes(accountType);
  return debitNormal ? roundMoney(debit - credit) : roundMoney(credit - debit);
}

async function postedLinesInRange(
  businessId: string,
  from?: Date | null,
  to?: Date | null,
  branchFilter?: { branchId: string } | { branchId: { in: string[] } }
) {
  return prisma.journalLine.findMany({
    where: {
      journalEntry: {
        businessId,
        status: 'posted',
        ...(branchFilter || {}),
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      }
    },
    include: { account: true }
  });
}

export async function profitAndLoss(
  user: AuthUser,
  from?: string | Date,
  to?: string | Date,
  opts?: BranchListOpts
) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const lines = await postedLinesInRange(user.businessId, fromDate, toDate, scope);

  const buckets: Record<string, { code: string; name: string; amount: number }[]> = {
    revenue: [],
    cogs: [],
    expense: []
  };
  const totals = { revenue: 0, cogs: 0, expense: 0 };

  const map = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  for (const line of lines) {
    const t = line.account.accountType;
    if (!['revenue', 'cogs', 'expense'].includes(t)) continue;
    const cur = map.get(line.accountId) || {
      code: line.account.code,
      name: line.account.name,
      type: t,
      debit: 0,
      credit: 0
    };
    cur.debit += Number(line.debit);
    cur.credit += Number(line.credit);
    map.set(line.accountId, cur);
  }

  for (const row of map.values()) {
    const amount = accountNet(row.debit, row.credit, row.type);
    buckets[row.type].push({ code: row.code, name: row.name, amount });
    totals[row.type as keyof typeof totals] = roundMoney(
      totals[row.type as keyof typeof totals] + amount
    );
  }

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => a.code.localeCompare(b.code));
  }

  const grossProfit = roundMoney(totals.revenue - totals.cogs);
  const netProfit = roundMoney(grossProfit - totals.expense);

  return {
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
    revenue: buckets.revenue,
    cogs: buckets.cogs,
    expenses: buckets.expense,
    totals: {
      revenue: totals.revenue,
      cogs: totals.cogs,
      expenses: totals.expense,
      gross_profit: grossProfit,
      net_profit: netProfit
    }
  };
}

export async function balanceSheet(user: AuthUser, asOf?: string | Date, opts?: BranchListOpts) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const lines = await postedLinesInRange(user.businessId, null, asOfDate, scope);

  const map = new Map<
    string,
    { code: string; name: string; type: string; debit: number; credit: number }
  >();
  for (const line of lines) {
    const t = line.account.accountType;
    if (!['asset', 'liability', 'equity'].includes(t)) continue;
    const cur = map.get(line.accountId) || {
      code: line.account.code,
      name: line.account.name,
      type: t,
      debit: 0,
      credit: 0
    };
    cur.debit += Number(line.debit);
    cur.credit += Number(line.credit);
    map.set(line.accountId, cur);
  }

  const sections: Record<string, { code: string; name: string; amount: number }[]> = {
    asset: [],
    liability: [],
    equity: []
  };
  const totals = { asset: 0, liability: 0, equity: 0 };

  for (const row of map.values()) {
    const amount = accountNet(row.debit, row.credit, row.type);
    sections[row.type].push({ code: row.code, name: row.name, amount });
    totals[row.type as keyof typeof totals] = roundMoney(
      totals[row.type as keyof typeof totals] + amount
    );
  }

  // Fold P&L into equity as current-year earnings
  const pl = await profitAndLoss(user, undefined, asOfDate, opts);
  const netProfit = pl.totals.net_profit;
  if (netProfit !== 0) {
    sections.equity.push({
      code: 'NI',
      name: 'Net income (current period)',
      amount: netProfit
    });
    totals.equity = roundMoney(totals.equity + netProfit);
  }

  for (const key of Object.keys(sections)) {
    sections[key].sort((a, b) => a.code.localeCompare(b.code));
  }

  const liabilitiesAndEquity = roundMoney(totals.liability + totals.equity);

  return {
    as_of: asOfDate.toISOString(),
    assets: sections.asset,
    liabilities: sections.liability,
    equity: sections.equity,
    totals: {
      assets: totals.asset,
      liabilities: totals.liability,
      equity: totals.equity,
      liabilities_and_equity: liabilitiesAndEquity,
      balanced: totals.asset === liabilitiesAndEquity
    }
  };
}

/** Default GL keys that form the cash & cash-equivalents pool (excludes sales-rep custody). */
const CASH_POOL_KEYS = ['cash', 'bank', 'petty_cash', 'cash_in_transit'] as const;

type CashFlowSection = 'operating' | 'investing' | 'financing' | 'internal';

const SOURCE_SECTION: Record<string, CashFlowSection> = {
  customer_payment: 'operating',
  customer_credit_refund: 'operating',
  supplier_payment: 'operating',
  expense: 'operating',
  expense_payment: 'operating',
  payroll: 'operating',
  payroll_payment: 'operating',
  sales_rep_cash_retirement: 'operating',
  sales_fulfilment: 'operating',
  sales_return: 'operating',
  grn: 'operating',
  bank_transfer: 'internal',
  asset_acquisition: 'investing',
  depreciation: 'operating',
  stock_transfer: 'operating'
};

function humanizeSourceType(sourceType: string | null | undefined) {
  if (!sourceType) return 'Manual / other';
  return sourceType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function resolveCashPoolAccountIds(businessId: string): Promise<{
  accountIds: Set<string>;
  accounts: { id: string; code: string; name: string }[];
}> {
  const map = await loadDefaultAccountMap(businessId);
  const ids = new Set<string>();
  for (const key of CASH_POOL_KEYS) {
    const id = map[key];
    if (id) ids.add(id);
  }

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { businessId, isActive: true },
    select: { glAccountId: true }
  });
  for (const b of bankAccounts) ids.add(b.glAccountId);

  if (!ids.size) {
    return { accountIds: ids, accounts: [] };
  }

  const accounts = await prisma.account.findMany({
    where: { businessId, id: { in: [...ids] } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' }
  });

  return { accountIds: new Set(accounts.map((a) => a.id)), accounts };
}

function classifyCashFlowJournal(opts: {
  sourceType: string | null;
  cashNet: number;
  outsideLines: { accountType: string; accountId: string }[];
  poolIds: Set<string>;
}): CashFlowSection {
  const { sourceType, cashNet, outsideLines, poolIds } = opts;
  if (!outsideLines.length || cashNet === 0) return 'internal';

  if (sourceType === 'bank_deposit' || sourceType === 'bank_withdrawal') {
    // Offset entirely inside the pool → till↔bank style move
    if (outsideLines.every((l) => poolIds.has(l.accountId))) return 'internal';
    const types = new Set(outsideLines.map((l) => l.accountType));
    if ([...types].every((t) => t === 'equity' || t === 'liability')) return 'financing';
    if ([...types].every((t) => t === 'asset')) return 'investing';
    return 'operating';
  }

  if (sourceType && SOURCE_SECTION[sourceType]) return SOURCE_SECTION[sourceType];

  const types = new Set(outsideLines.map((l) => l.accountType));
  if ([...types].every((t) => t === 'equity' || t === 'liability')) return 'financing';
  if ([...types].some((t) => t === 'asset') && ![...types].some((t) => t === 'expense' || t === 'cogs' || t === 'revenue')) {
    return 'investing';
  }
  return 'operating';
}

/**
 * Direct-method cash flow from the cash pool (cash / bank / petty / CIT + bank GLs).
 * Sales-rep custody is excluded from the pool; retirement into till/bank is operating inflow.
 */
export async function cashFlow(
  user: AuthUser,
  from?: string | Date,
  to?: string | Date,
  opts?: BranchListOpts
) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : new Date();
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });

  const { accountIds: poolIds, accounts: poolAccounts } = await resolveCashPoolAccountIds(
    user.businessId
  );

  if (!poolIds.size) {
    return {
      from: fromDate?.toISOString() || null,
      to: toDate.toISOString(),
      cash_accounts: [],
      operating: { inflows: [], outflows: [], net: 0 },
      investing: { inflows: [], outflows: [], net: 0 },
      financing: { inflows: [], outflows: [], net: 0 },
      internal_transfers: { lines: [], net: 0 },
      totals: {
        opening_cash: 0,
        operating_net: 0,
        investing_net: 0,
        financing_net: 0,
        internal_net: 0,
        net_change: 0,
        closing_cash: 0,
        closing_reconciles: true
      }
    };
  }

  const openingSource = fromDate
    ? await prisma.journalLine.findMany({
        where: {
          accountId: { in: [...poolIds] },
          journalEntry: {
            businessId: user.businessId,
            status: 'posted',
            ...scope,
            entryDate: { lt: fromDate }
          }
        }
      })
    : [];

  const periodJournals = await prisma.journalEntry.findMany({
    where: {
      businessId: user.businessId,
      status: 'posted',
      ...scope,
      ...(fromDate || toDate
        ? {
            entryDate: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {})
            }
          }
        : {}),
      lines: { some: { accountId: { in: [...poolIds] } } }
    },
    include: {
      lines: { include: { account: true } }
    },
    orderBy: { entryDate: 'asc' }
  });

  const closingLines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: [...poolIds] },
      journalEntry: {
        businessId: user.businessId,
        status: 'posted',
        ...scope,
        entryDate: { lte: toDate }
      }
    }
  });

  const sumPool = (lines: { accountId: string; debit: unknown; credit: unknown }[]) => {
    const byAccount = new Map<string, number>();
    for (const id of poolIds) byAccount.set(id, 0);
    for (const line of lines) {
      if (!poolIds.has(line.accountId)) continue;
      const net = roundMoney(Number(line.debit) - Number(line.credit));
      byAccount.set(line.accountId, roundMoney((byAccount.get(line.accountId) || 0) + net));
    }
    return byAccount;
  };

  const openingByAcct = sumPool(openingSource);
  const closingByAcct = sumPool(closingLines);

  const cashAccounts = poolAccounts.map((a) => {
    const opening = openingByAcct.get(a.id) || 0;
    const closing = closingByAcct.get(a.id) || 0;
    return {
      account_id: a.id,
      code: a.code,
      name: a.name,
      opening,
      closing,
      net: roundMoney(closing - opening)
    };
  });

  const openingCash = roundMoney(cashAccounts.reduce((s, r) => s + r.opening, 0));
  const closingCash = roundMoney(cashAccounts.reduce((s, r) => s + r.closing, 0));

  type AggRow = { key: string; label: string; amount: number };
  const buckets: Record<
    CashFlowSection,
    { inflows: Map<string, AggRow>; outflows: Map<string, AggRow> }
  > = {
    operating: { inflows: new Map(), outflows: new Map() },
    investing: { inflows: new Map(), outflows: new Map() },
    financing: { inflows: new Map(), outflows: new Map() },
    internal: { inflows: new Map(), outflows: new Map() }
  };

  const bump = (section: CashFlowSection, cashNet: number, sourceType: string | null) => {
    if (cashNet === 0 && section !== 'internal') return;
    const label = humanizeSourceType(sourceType);
    const key = sourceType || 'other';
    const side = cashNet >= 0 ? 'inflows' : 'outflows';
    const amount = Math.abs(cashNet);
    if (section === 'internal') {
      // Show gross shuffle size on a single net-zero line set using absolute pool movement / 2
      const map = buckets.internal.inflows;
      const cur = map.get(key) || { key, label, amount: 0 };
      cur.amount = roundMoney(cur.amount + amount);
      map.set(key, cur);
      return;
    }
    const map = buckets[section][side];
    const cur = map.get(key) || { key, label, amount: 0 };
    cur.amount = roundMoney(cur.amount + amount);
    map.set(key, cur);
  };

  let operatingNet = 0;
  let investingNet = 0;
  let financingNet = 0;
  let internalGross = 0;

  for (const je of periodJournals) {
    let cashNet = 0;
    const outside: { accountType: string; accountId: string }[] = [];
    for (const line of je.lines) {
      if (poolIds.has(line.accountId)) {
        cashNet = roundMoney(cashNet + Number(line.debit) - Number(line.credit));
      } else {
        outside.push({ accountType: line.account.accountType, accountId: line.accountId });
      }
    }

    const section = classifyCashFlowJournal({
      sourceType: je.sourceType,
      cashNet,
      outsideLines: outside,
      poolIds
    });

    if (section === 'internal') {
      // Pool-only moves net to zero; track gross debit into pool for visibility
      const poolDebit = roundMoney(
        je.lines
          .filter((l) => poolIds.has(l.accountId))
          .reduce((s, l) => s + Number(l.debit), 0)
      );
      internalGross = roundMoney(internalGross + poolDebit);
      bump('internal', poolDebit, je.sourceType);
      continue;
    }

    bump(section, cashNet, je.sourceType);
    if (section === 'operating') operatingNet = roundMoney(operatingNet + cashNet);
    else if (section === 'investing') investingNet = roundMoney(investingNet + cashNet);
    else if (section === 'financing') financingNet = roundMoney(financingNet + cashNet);
  }

  const toList = (m: Map<string, AggRow>) =>
    [...m.values()].sort((a, b) => a.label.localeCompare(b.label));

  const sectionPayload = (section: Exclude<CashFlowSection, 'internal'>, net: number) => {
    const inflows = toList(buckets[section].inflows);
    const outflows = toList(buckets[section].outflows);
    return {
      inflows,
      outflows,
      net
    };
  };

  const netChange = roundMoney(operatingNet + investingNet + financingNet);
  const expectedClosing = roundMoney(openingCash + netChange);

  return {
    from: fromDate?.toISOString() || null,
    to: toDate.toISOString(),
    cash_accounts: cashAccounts,
    operating: sectionPayload('operating', operatingNet),
    investing: sectionPayload('investing', investingNet),
    financing: sectionPayload('financing', financingNet),
    internal_transfers: {
      lines: toList(buckets.internal.inflows),
      net: 0,
      gross: internalGross
    },
    totals: {
      opening_cash: openingCash,
      operating_net: operatingNet,
      investing_net: investingNet,
      financing_net: financingNet,
      internal_net: 0,
      net_change: netChange,
      closing_cash: closingCash,
      closing_reconciles: expectedClosing === closingCash
    }
  };
}
