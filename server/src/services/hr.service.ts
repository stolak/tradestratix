import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import { promoteEmployeeToSalesRep } from './sales-rep.service.js';
import { assignBranchWarehousesToUser } from './warehouse.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function dateOnly(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function slugUsername(fullName: string) {
  const base = fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24);
  return base || 'employee';
}

function tempPassword() {
  return `Tsx${Math.random().toString(36).slice(2, 8)}!${Date.now().toString().slice(-3)}`;
}

/** Home branch for HR: selected branch, else HQ (code HQ / Head Office fallback). */
export async function resolveEmployeeHomeBranch(
  businessId: string,
  requestedBranchId?: string | null
): Promise<string> {
  if (requestedBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: requestedBranchId, businessId, isActive: true }
    });
    if (!branch) throw httpError(400, 'branch_id is invalid or inactive for this business');
    return branch.id;
  }

  const hq =
    (await prisma.branch.findFirst({
      where: { businessId, code: 'HQ', isActive: true }
    })) ||
    (await prisma.branch.findFirst({
      where: { businessId, name: { contains: 'Head' }, isActive: true },
      orderBy: { createdAt: 'asc' }
    }));
  if (hq) return hq.id;
  const fallback = await branchAccess.ensureDefaultBranch(businessId);
  return fallback.id;
}

const employeeInclude = {
  branch: true,
  user: {
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      defaultBranchId: true,
      status: true
    }
  },
  salesRep: {
    select: { id: true, code: true, status: true, commissionPercent: true }
  }
} as const;

export async function listEmployees(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.employee.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: employeeInclude,
    orderBy: { fullName: 'asc' }
  });
  return serialize(rows);
}

export async function createEmployee(user: AuthUser, body: Record<string, any>) {
  const fullName = requireString(body.full_name || body.fullName, 'full_name');
  const isSalesRep = Boolean(
    body.is_sales_rep ?? body.isSalesRep ?? body.make_sales_rep ?? body.makeSalesRep
  );
  const branchId = await resolveEmployeeHomeBranch(
    user.businessId,
    body.branch_id || body.branchId || null
  );

  const roleCode = requireString(
    body.role || (isSalesRep ? 'sales_representative' : 'cashier'),
    'role'
  );
  const roleRow = await prisma.role.findFirst({
    where: {
      code: roleCode,
      OR: [{ businessId: user.businessId }, { businessId: null }]
    }
  });
  if (!roleRow) throw httpError(400, `Invalid role: ${roleCode}`);

  let username = String(body.username || '')
    .trim()
    .toLowerCase();
  if (!username) {
    username = slugUsername(fullName);
    const clash = await prisma.user.findFirst({
      where: { businessId: user.businessId, username }
    });
    if (clash) username = `${username}.${Date.now().toString(36).slice(-4)}`;
  }

  const password = body.password ? String(body.password) : tempPassword();
  if (password.length < 6) throw httpError(400, 'password must be at least 6 characters');
  const passwordHash = await bcrypt.hash(password, 10);

  // Extra branches the login may access (multi-branch). Home branch always included.
  const extraBranchIds = Array.isArray(body.branch_ids || body.branchIds)
    ? (body.branch_ids || body.branchIds).map(String)
    : [];
  const membershipBranchIds = Array.from(new Set([branchId, ...extraBranchIds]));
  for (const bid of membershipBranchIds) {
    const ok = await prisma.branch.findFirst({
      where: { id: bid, businessId: user.businessId, isActive: true }
    });
    if (!ok) throw httpError(400, `Invalid branch_id in branch access list: ${bid}`);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const login = await tx.user.create({
        data: {
          id: shortId('usr'),
          businessId: user.businessId,
          username,
          passwordHash,
          fullName,
          role: roleCode,
          email: body.email || null,
          phone: body.phone || null,
          department: body.department || null,
          defaultBranchId: branchId,
          createdById: user.id,
          userRoles: { create: [{ roleId: roleRow.id }] },
          userBranches: {
            create: membershipBranchIds.map((bid) => ({
              branchId: bid,
              businessId: user.businessId,
              status: 'active',
              assignedById: user.id
            }))
          }
        }
      });

      const emp = await tx.employee.create({
        data: {
          id: shortId('emp'),
          businessId: user.businessId,
          branchId,
          userId: login.id,
          code: body.code ? String(body.code).trim() : null,
          fullName,
          email: body.email || null,
          phone: body.phone || null,
          department: body.department || null,
          jobTitle:
            body.job_title ||
            body.jobTitle ||
            (isSalesRep ? 'Sales Representative' : null),
          hireDate:
            body.hire_date || body.hireDate ? new Date(body.hire_date || body.hireDate) : null,
          baseSalary: toDec(Number(body.base_salary ?? body.baseSalary ?? 0)),
          payFrequency: body.pay_frequency || body.payFrequency || 'monthly',
          bankName: body.bank_name || body.bankName || null,
          bankAccount: body.bank_account || body.bankAccount || null,
          taxId: body.tax_id || body.taxId || null,
          pensionId: body.pension_id || body.pensionId || null,
          status: body.status || 'active',
          createdById: user.id
        },
        include: employeeInclude
      });

      return { emp, login };
    });

    // Default warehouse access = active warehouses in the employee's authorised branches
    const requestedWarehouseIds = Array.isArray(body.warehouse_ids || body.warehouseIds)
      ? (body.warehouse_ids || body.warehouseIds).map(String)
      : null;
    if (requestedWarehouseIds?.length) {
      for (const warehouseId of requestedWarehouseIds) {
        await prisma.userWarehouse.upsert({
          where: {
            userId_warehouseId: { userId: created.login.id, warehouseId }
          },
          create: {
            userId: created.login.id,
            businessId: user.businessId,
            warehouseId,
            status: 'active',
            assignedById: user.id
          },
          update: { status: 'active', assignedById: user.id, assignedAt: new Date() }
        });
      }
    } else {
      await assignBranchWarehousesToUser({
        businessId: user.businessId,
        userId: created.login.id,
        branchIds: membershipBranchIds,
        assignedById: user.id
      });
    }

    let salesRep = null as any;
    if (isSalesRep) {
      salesRep = await promoteEmployeeToSalesRep(user, {
        employeeId: created.emp.id,
        code: body.sales_rep_code || body.salesRepCode || body.code || null,
        commissionPercent: Number(body.commission_percent ?? body.commissionPercent ?? 0)
      });
    }

    await writeAudit({
      user,
      action: 'create',
      module: 'hr',
      entityType: 'Employee',
      entityId: created.emp.id,
      summary: `Created employee ${fullName} (user ${username})${isSalesRep ? ' as sales rep' : ''}`
    });

    const fresh = await prisma.employee.findUnique({
      where: { id: created.emp.id },
      include: employeeInclude
    });

    return serialize({
      ...fresh,
      temporary_password: body.password ? undefined : password,
      login_username: username,
      sales_rep: salesRep
        ? {
            id: salesRep.id,
            code: salesRep.code,
            commission_percent: salesRep.commissionPercent ?? salesRep.commission_percent
          }
        : fresh?.salesRep || null
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const target = String(err?.meta?.target || '');
      if (target.includes('username')) throw httpError(409, 'Username already exists');
      if (target.includes('code')) throw httpError(409, 'Employee code already exists');
      throw httpError(409, 'Duplicate employee or user record');
    }
    throw err;
  }
}

export async function updateEmployee(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.employee.findFirst({
    where: { id, businessId: user.businessId },
    include: { salesRep: true, user: true }
  });
  if (!existing) throw httpError(404, 'Employee not found');

  const data: Record<string, unknown> = {};
  const map: Record<string, string> = {
    full_name: 'fullName',
    fullName: 'fullName',
    code: 'code',
    email: 'email',
    phone: 'phone',
    department: 'department',
    job_title: 'jobTitle',
    jobTitle: 'jobTitle',
    pay_frequency: 'payFrequency',
    payFrequency: 'payFrequency',
    bank_name: 'bankName',
    bankName: 'bankName',
    bank_account: 'bankAccount',
    bankAccount: 'bankAccount',
    tax_id: 'taxId',
    taxId: 'taxId',
    pension_id: 'pensionId',
    pensionId: 'pensionId',
    status: 'status'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }
  if (body.hire_date !== undefined || body.hireDate !== undefined) {
    data.hireDate = body.hire_date || body.hireDate ? new Date(body.hire_date || body.hireDate) : null;
  }
  if (body.base_salary !== undefined || body.baseSalary !== undefined) {
    data.baseSalary = toDec(Number(body.base_salary ?? body.baseSalary));
  }

  // Home branch change — does NOT follow session switch; updates user.defaultBranchId
  if (body.branch_id !== undefined || body.branchId !== undefined) {
    const nextBranchId = await resolveEmployeeHomeBranch(
      user.businessId,
      body.branch_id ?? body.branchId
    );
    data.branchId = nextBranchId;
  }

  const makeSalesRep = Boolean(body.is_sales_rep ?? body.isSalesRep ?? body.make_sales_rep);
  const promoteLater = makeSalesRep && !existing.salesRep;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({
        where: { id },
        data: data as any,
        include: employeeInclude
      });

      if (emp.userId) {
        const userPatch: Record<string, unknown> = {};
        if (data.fullName !== undefined) userPatch.fullName = data.fullName;
        if (data.phone !== undefined) userPatch.phone = data.phone;
        if (data.email !== undefined) userPatch.email = data.email;
        if (data.department !== undefined) userPatch.department = data.department;
        if (data.status !== undefined) {
          userPatch.status = data.status === 'inactive' ? 'inactive' : 'active';
        }
        if (data.branchId !== undefined) {
          userPatch.defaultBranchId = data.branchId;
        }
        if (Object.keys(userPatch).length) {
          await tx.user.update({ where: { id: emp.userId }, data: userPatch as any });
        }
        if (data.branchId) {
          await branchAccess.ensureUserMembership(
            user.businessId,
            emp.userId,
            String(data.branchId),
            user.id
          );
        }
      }

      if (emp.salesRep && data.status !== undefined) {
        await tx.salesRep.update({
          where: { id: emp.salesRep.id },
          data: { status: data.status === 'inactive' ? 'inactive' : 'active' }
        });
      }

      return emp;
    });

    let salesRep = updated.salesRep;
    if (promoteLater) {
      const promoted = await promoteEmployeeToSalesRep(user, {
        employeeId: id,
        code: body.sales_rep_code || body.code || existing.code,
        commissionPercent: Number(body.commission_percent ?? body.commissionPercent ?? 0)
      });
      salesRep = {
        id: promoted.id,
        code: promoted.code,
        status: promoted.status,
        commissionPercent: promoted.commissionPercent ?? promoted.commission_percent
      } as any;
    }

    await writeAudit({
      user,
      action: 'edit',
      module: 'hr',
      entityType: 'Employee',
      entityId: id,
      summary: `Updated employee ${updated.fullName}${promoteLater ? ' (promoted to sales rep)' : ''}`
    });

    return serialize({ ...updated, salesRep });
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Employee code already exists');
    throw err;
  }
}

export async function listAttendance(
  user: AuthUser,
  opts: { employee_id?: string; from?: string; to?: string } & BranchListOpts = {}
) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts.branchId,
    allowConsolidated: opts.allowConsolidated
  });
  const rows = await prisma.attendanceRecord.findMany({
    where: {
      businessId: user.businessId,
      ...(opts.employee_id ? { employeeId: opts.employee_id } : {}),
      employee: { ...scope },
      ...(opts.from || opts.to
        ? {
            workDate: {
              ...(opts.from ? { gte: dateOnly(opts.from) } : {}),
              ...(opts.to ? { lte: dateOnly(opts.to) } : {})
            }
          }
        : {})
    },
    include: { employee: true },
    orderBy: { workDate: 'desc' },
    take: 500
  });
  return serialize(rows);
}

export async function upsertAttendance(user: AuthUser, body: Record<string, any>) {
  const employeeId = requireString(body.employee_id || body.employeeId, 'employee_id');
  const workDateRaw = body.work_date || body.workDate;
  if (!workDateRaw) throw httpError(400, 'work_date is required');
  const workDate = dateOnly(workDateRaw);

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, businessId: user.businessId }
  });
  if (!employee) throw httpError(404, 'Employee not found');

  const status = body.status || 'present';
  const checkInAt = body.check_in_at || body.checkInAt ? new Date(body.check_in_at || body.checkInAt) : null;
  const checkOutAt =
    body.check_out_at || body.checkOutAt ? new Date(body.check_out_at || body.checkOutAt) : null;

  const row = await prisma.attendanceRecord.upsert({
    where: { employeeId_workDate: { employeeId, workDate } },
    create: {
      id: shortId('att'),
      businessId: user.businessId,
      employeeId,
      workDate,
      checkInAt,
      checkOutAt,
      status,
      notes: body.notes || null
    },
    update: {
      checkInAt,
      checkOutAt,
      status,
      notes: body.notes !== undefined ? body.notes : undefined
    },
    include: { employee: true }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'hr',
    entityType: 'AttendanceRecord',
    entityId: row.id,
    summary: `Attendance ${status} for ${employee.fullName} on ${workDate.toISOString().slice(0, 10)}`
  });
  return serialize(row);
}

export async function listLeave(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.leaveRequest.findMany({
    where: {
      businessId: user.businessId,
      ...(status ? { status } : {}),
      employee: { ...scope }
    },
    include: { employee: true },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function createLeave(user: AuthUser, body: Record<string, any>) {
  const employeeId = requireString(body.employee_id || body.employeeId, 'employee_id');
  const startsOn = body.starts_on || body.startsOn;
  const endsOn = body.ends_on || body.endsOn;
  if (!startsOn || !endsOn) throw httpError(400, 'starts_on and ends_on are required');

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, businessId: user.businessId }
  });
  if (!employee) throw httpError(404, 'Employee not found');

  const start = dateOnly(startsOn);
  const end = dateOnly(endsOn);
  if (end < start) throw httpError(400, 'ends_on must be on or after starts_on');

  const days =
    body.days != null
      ? Number(body.days)
      : Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  const row = await prisma.leaveRequest.create({
    data: {
      id: shortId('lve'),
      businessId: user.businessId,
      employeeId,
      leaveType: body.leave_type || body.leaveType || 'annual',
      startsOn: start,
      endsOn: end,
      days: toDec(days),
      reason: body.reason || null,
      status: 'pending'
    },
    include: { employee: true }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'hr',
    entityType: 'LeaveRequest',
    entityId: row.id,
    summary: `Leave request for ${employee.fullName}`
  });
  return serialize(row);
}

export async function approveLeave(
  user: AuthUser,
  id: string,
  body: Record<string, any> = {}
) {
  const leave = await prisma.leaveRequest.findFirst({
    where: { id, businessId: user.businessId },
    include: { employee: true }
  });
  if (!leave) throw httpError(404, 'Leave request not found');
  if (leave.status !== 'pending') throw httpError(400, 'Only pending leave can be approved/rejected');

  const decision = String(body.status || 'approved').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    throw httpError(400, 'status must be approved or rejected');
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: decision,
      approvedById: user.id
    },
    include: { employee: true }
  });

  await writeAudit({
    user,
    action: decision === 'approved' ? 'approve' : 'reject',
    module: 'hr',
    entityType: 'LeaveRequest',
    entityId: id,
    summary: `${decision} leave for ${leave.employee.fullName}`
  });
  return serialize(updated);
}
