import { prisma } from '../utils/prisma.js';
import { httpError, roundMoney, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import {
  createJournal,
  getDefaultAccountMap,
  partnerLineBalances,
  resolveTransactionDate
} from './accounting.service.js';
import { userHasAnyPermission } from './permission.service.js';

const employeeSelect = {
  id: true,
  code: true,
  fullName: true,
  email: true,
  phone: true,
  department: true,
  jobTitle: true,
  status: true,
  branchId: true,
  userId: true,
  branch: { select: { id: true, code: true, name: true } },
  user: {
    select: {
      id: true,
      username: true,
      defaultBranchId: true,
      role: true,
      status: true,
      userBranches: {
        where: { status: 'active' },
        select: {
          branchId: true,
          status: true,
          branch: { select: { id: true, code: true, name: true, isActive: true } }
        },
        orderBy: { assignedAt: 'asc' }
      }
    }
  }
} as const;

const repInclude = {
  employee: { select: employeeSelect },
  _count: { select: { invoices: true, commissions: true, journalEntries: true } }
} as const;

function activityCount(row: {
  _count?: { invoices?: number; commissions?: number; journalEntries?: number };
}) {
  return (
    (row._count?.invoices || 0) +
    (row._count?.commissions || 0) +
    (row._count?.journalEntries || 0)
  );
}

/** Flatten employee identity onto the sales-rep DTO for UI compatibility. */
function presentRep<T extends { employee?: any; _count?: any }>(row: T) {
  const emp = row.employee;
  const activity = activityCount(row);
  const operatingBranches = (emp?.user?.userBranches || [])
    .map((ub: any) => ub.branch)
    .filter((b: any) => b && b.isActive !== false);
  return {
    ...row,
    name: emp?.fullName ?? null,
    phone: emp?.phone ?? null,
    email: emp?.email ?? null,
    branch_id: emp?.branchId ?? null,
    user_id: emp?.userId ?? null,
    branch: emp?.branch ?? null,
    operating_branches: operatingBranches,
    can_delete: activity === 0,
    activity_count: activity
  };
}

async function assertEmployeeAvailable(
  businessId: string,
  employeeId: string,
  excludeSalesRepId?: string
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, businessId },
    include: {
      salesRep: { select: { id: true } },
      user: true,
      branch: true
    }
  });
  if (!employee) throw httpError(400, 'employee_id is invalid for this business');
  if (!employee.userId) throw httpError(400, 'Employee must have a user login before becoming a sales rep');
  if (!employee.branchId) throw httpError(400, 'Employee must have a home branch before becoming a sales rep');
  if (employee.salesRep && employee.salesRep.id !== excludeSalesRepId) {
    throw httpError(409, 'Employee is already a sales rep');
  }
  return employee;
}

/** Align login default branch with employee home branch; keep multi-branch membership. */
async function syncRepUserDefaultBranch(
  tx: typeof prisma,
  opts: { userId: string; businessId: string; homeBranchId: string; actorId?: string | null }
) {
  await tx.user.update({
    where: { id: opts.userId },
    data: { defaultBranchId: opts.homeBranchId }
  });
  await branchAccess.ensureUserMembership(
    opts.businessId,
    opts.userId,
    opts.homeBranchId,
    opts.actorId || undefined
  );
}

export async function promoteEmployeeToSalesRep(
  user: AuthUser,
  opts: {
    employeeId: string;
    code?: string | null;
    commissionPercent?: number;
    status?: string;
  }
) {
  const employee = await assertEmployeeAvailable(user.businessId, opts.employeeId);
  const code = opts.code ? String(opts.code).trim() : employee.code;

  const row = await prisma.$transaction(async (tx) => {
    const rep = await tx.salesRep.create({
      data: {
        id: shortId('rep'),
        businessId: user.businessId,
        employeeId: employee.id,
        code,
        commissionPercent: Number(opts.commissionPercent ?? 0),
        status: opts.status || 'active',
        createdById: user.id
      },
      include: repInclude
    });

    await syncRepUserDefaultBranch(tx as any, {
      userId: employee.userId,
      businessId: user.businessId,
      homeBranchId: employee.branchId,
      actorId: user.id
    });

    // Prefer sales_representative role for the linked login
    const roleRow = await tx.role.findFirst({
      where: {
        code: 'sales_representative',
        OR: [{ businessId: user.businessId }, { businessId: null }]
      }
    });
    if (roleRow) {
      await tx.user.update({
        where: { id: employee.userId },
        data: { role: 'sales_representative' }
      });
      const existingRole = await tx.userRole.findFirst({
        where: { userId: employee.userId, roleId: roleRow.id }
      });
      if (!existingRole) {
        await tx.userRole.create({
          data: { userId: employee.userId, roleId: roleRow.id }
        });
      }
    }

    return rep;
  });

  return presentRep(row);
}

export async function findSalesRepForUser(
  businessId: string,
  userId: string,
  opts?: { withBalance?: boolean }
) {
  const row = await prisma.salesRep.findFirst({
    where: {
      businessId,
      status: 'active',
      employee: { userId }
    },
    include: repInclude
  });
  if (!row) return null;
  const presented = presentRep(row);
  if (!opts?.withBalance) return serialize(presented);
  const balances = await partnerLineBalances(businessId, 'sales_representative', row.id);
  return serialize({
    ...presented,
    balance: roundMoney(balances.get(row.id) ?? 0)
  });
}

/**
 * Hand over cash held in sales-rep custody into a company till / bank ledger.
 * Dr received-into account / Cr Cash in Custody (sales rep).
 */
export async function retireSalesRepCash(
  user: AuthUser,
  salesRepId: string,
  body: Record<string, any>
) {
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw httpError(400, 'amount must be greater than 0');

  const accountId = String(body.account_id || body.accountId || '');
  if (!accountId) throw httpError(400, 'account_id is required (ledger the cash is retired into)');

  const rep = await prisma.salesRep.findFirst({
    where: { id: salesRepId, businessId: user.businessId },
    include: { employee: { select: { id: true, fullName: true, userId: true } } }
  });
  if (!rep) throw httpError(404, 'Sales rep not found');

  // Retirement is a Finance / management action — sales reps cannot clear their own custody.
  const canManage = await userHasAnyPermission(user.id, [
    'sales_reps.edit',
    'banking.post',
    'banking.create',
    'accounting.post',
    'sales.post'
  ]);
  const isOwner = user.role === 'business_owner' || user.role === 'managing_director';
  if (!canManage && !isOwner) {
    throw httpError(403, 'Only Finance / management can retire sales-rep custody cash');
  }

  const accountMap = await getDefaultAccountMap(user.businessId);
  const custodyId = accountMap.cash_in_custody_sales_rep;
  if (!custodyId) {
    throw httpError(400, 'Default account "cash_in_custody_sales_rep" is not configured');
  }
  if (accountId === custodyId) {
    throw httpError(400, 'Choose a till or bank account — not sales-rep custody');
  }

  const dest = await prisma.account.findFirst({
    where: { id: accountId, businessId: user.businessId, isActive: true }
  });
  if (!dest) throw httpError(400, 'account_id is invalid for this business');
  if (String(dest.accountType) !== 'asset') {
    throw httpError(400, 'Retire into an asset ledger (cash / bank / till)');
  }

  const balances = await partnerLineBalances(user.businessId, 'sales_representative', rep.id);
  const held = roundMoney(balances.get(rep.id) ?? 0);
  if (amount > held + 0.01) {
    throw httpError(400, `Only ${held.toLocaleString()} in custody to retire`);
  }

  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  const transactionDate = resolveTransactionDate(
    body.transaction_date || body.transactionDate || body.payment_date || null
  );
  const retirementId = shortId('srr');
  const name = rep.employee?.fullName || rep.code || rep.id;

  const journal: any = await createJournal(user, {
    source_type: 'sales_rep_cash_retirement',
    source_id: retirementId,
    sales_representative_id: rep.id,
    post: true,
    memo: `Cash retirement — ${name}`,
    idempotency_key:
      body.idempotency_key || body.idempotencyKey || `sales_rep_retire:${retirementId}`,
    branch_id: branchId,
    transaction_date: transactionDate,
    entry_date: transactionDate,
    lines: [
      {
        account_id: accountId,
        debit: amount,
        description: `Cash retired from ${name}`
      },
      {
        account_id: custodyId,
        credit: amount,
        description: `Custody cleared — ${name}`
      }
    ]
  });

  await writeAudit({
    user,
    action: 'post',
    module: 'sales_reps',
    entityType: 'SalesRepCashRetirement',
    entityId: retirementId,
    summary: `Retired ${amount} from ${name} into ${dest.code || dest.name}`
  });

  const after = await partnerLineBalances(user.businessId, 'sales_representative', rep.id);
  return serialize({
    id: retirementId,
    sales_rep_id: rep.id,
    sales_rep_name: name,
    amount,
    account_id: accountId,
    account: { id: dest.id, code: dest.code, name: dest.name },
    journal_entry_id: journal.id,
    journal_entry_number: journal.entryNumber || journal.entry_number,
    balance_remaining: roundMoney(after.get(rep.id) ?? 0),
    transaction_date: transactionDate
  });
}

/** Active sales reps whose linked login can operate in the given branch. */
export async function listSalesReps(
  businessId: string,
  opts?: { branchId?: string | null; activeOnly?: boolean; withBalances?: boolean }
) {
  const branchId = opts?.branchId || null;
  const rows = await prisma.salesRep.findMany({
    where: {
      businessId,
      ...(opts?.activeOnly === false ? {} : { status: 'active' }),
      ...(branchId
        ? {
            employee: {
              user: {
                userBranches: {
                  some: { branchId, status: 'active' }
                }
              }
            }
          }
        : {})
    },
    include: repInclude,
    orderBy: { employee: { fullName: 'asc' } }
  });
  const presented = rows.map(presentRep);
  if (!opts?.withBalances) return serialize(presented);

  const balances = await partnerLineBalances(businessId, 'sales_representative');
  return serialize(
    presented.map((r) => ({
      ...r,
      balance: roundMoney(balances.get(r.id) ?? 0)
    }))
  );
}

export async function assertSalesRepInBranch(
  businessId: string,
  salesRepId: string,
  branchId: string
) {
  const rep = await prisma.salesRep.findFirst({
    where: {
      id: salesRepId,
      businessId,
      status: 'active',
      employee: {
        user: {
          userBranches: { some: { branchId, status: 'active' } }
        }
      }
    },
    include: { employee: { select: { id: true, fullName: true, userId: true } } }
  });
  if (!rep) {
    throw httpError(
      400,
      'sales_rep_id is invalid or the representative cannot operate in this branch'
    );
  }
  return rep;
}

export async function createSalesRep(user: AuthUser, body: Record<string, any>) {
  const employeeId = body.employee_id || body.employeeId;
  if (!employeeId) {
    throw httpError(
      400,
      'employee_id is required — register the person as an employee first, then make them a sales rep'
    );
  }

  try {
    const row = await promoteEmployeeToSalesRep(user, {
      employeeId: String(employeeId),
      code: body.code ?? null,
      commissionPercent: Number(body.commission_percent ?? body.commissionPercent ?? 0),
      status: body.status || 'active'
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: row.id,
      summary: `Promoted employee ${employeeId} to sales rep`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Sales rep code already exists');
    throw err;
  }
}

export async function updateSalesRep(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.salesRep.findFirst({
    where: { id, businessId: user.businessId },
    include: { employee: true }
  });
  if (!existing) throw httpError(404, 'Sales rep not found');

  const data: Record<string, unknown> = {};
  if (body.code !== undefined) data.code = body.code ? String(body.code).trim() : null;
  if (body.commission_percent !== undefined || body.commissionPercent !== undefined) {
    data.commissionPercent = Number(body.commission_percent ?? body.commissionPercent);
  }
  if (body.status !== undefined) data.status = body.status;

  if (body.employee_id !== undefined || body.employeeId !== undefined) {
    throw httpError(400, 'Cannot reassign employee_id on a sales rep; create a new sales-rep profile instead');
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const rep = await tx.salesRep.update({
        where: { id },
        data: data as any,
        include: repInclude
      });

      // Disabling a sales-rep profile does not deactivate the employee HR record.
      return rep;
    });

    await writeAudit({
      user,
      action: 'update',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: id,
      summary: `Updated sales rep ${updated.employee?.fullName || id}`
    });
    return serialize(presentRep(updated));
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Sales rep code already exists');
    throw err;
  }
}

export async function setSalesRepActive(user: AuthUser, id: string, active: boolean) {
  return updateSalesRep(user, id, { status: active ? 'active' : 'inactive' });
}

/** Remove sales-rep profile only when there is no commercial/accounting activity. Employee remains. */
export async function deleteSalesRep(user: AuthUser, id: string) {
  const existing = await prisma.salesRep.findFirst({
    where: { id, businessId: user.businessId },
    include: {
      employee: { select: { id: true, fullName: true } },
      _count: { select: { invoices: true, commissions: true, journalEntries: true } }
    }
  });
  if (!existing) throw httpError(404, 'Sales rep not found');

  const activity = activityCount(existing);
  if (activity > 0) {
    throw httpError(
      400,
      `Cannot remove sales rep with activity (${existing._count.invoices} invoices, ${existing._count.commissions} commissions, ${existing._count.journalEntries} journals). Disable instead.`
    );
  }

  await prisma.salesRep.delete({ where: { id } });
  await writeAudit({
    user,
    action: 'delete',
    module: 'sales_reps',
    entityType: 'SalesRep',
    entityId: id,
    summary: `Removed sales rep profile for ${existing.employee?.fullName || id}`
  });
  return { ok: true, id };
}

export async function listCommissions(businessId: string, salesRepId?: string) {
  const rows = await prisma.salesCommission.findMany({
    where: {
      businessId,
      ...(salesRepId ? { salesRepId } : {})
    },
    include: {
      salesRep: { include: { employee: { select: { id: true, fullName: true, code: true } } } },
      invoice: true
    },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(
    rows.map((r) => ({
      ...r,
      salesRep: r.salesRep ? presentRep(r.salesRep) : r.salesRep
    }))
  );
}
