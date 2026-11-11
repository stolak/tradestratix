import { prisma } from '../utils/prisma.js';
import { httpError, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

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
  user: { select: { id: true, username: true, defaultBranchId: true, role: true, status: true } }
} as const;

const repInclude = {
  employee: { select: employeeSelect },
  _count: { select: { invoices: true, commissions: true } }
} as const;

/** Flatten employee identity onto the sales-rep DTO for UI compatibility. */
function presentRep<T extends { employee?: any }>(row: T) {
  const emp = row.employee;
  return {
    ...row,
    name: emp?.fullName ?? null,
    phone: emp?.phone ?? null,
    email: emp?.email ?? null,
    branch_id: emp?.branchId ?? null,
    user_id: emp?.userId ?? null,
    branch: emp?.branch ?? null
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

export async function listSalesReps(businessId: string) {
  const rows = await prisma.salesRep.findMany({
    where: { businessId },
    include: repInclude,
    orderBy: { employee: { fullName: 'asc' } }
  });
  return serialize(rows.map(presentRep));
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

      if (data.status !== undefined && rep.employeeId) {
        await tx.employee.update({
          where: { id: rep.employeeId },
          data: { status: data.status === 'inactive' ? 'inactive' : 'active' }
        });
      }

      // Keep linked user default branch = employee home branch
      if (rep.employee?.userId && rep.employee.branchId) {
        await syncRepUserDefaultBranch(tx as any, {
          userId: rep.employee.userId,
          businessId: user.businessId,
          homeBranchId: rep.employee.branchId,
          actorId: user.id
        });
      }

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
