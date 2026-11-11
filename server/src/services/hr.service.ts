import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function dateOnly(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function listEmployees(user: AuthUser, status?: string, opts?: BranchListOpts) {
  const scope = await branchAccess.branchScopeWhere(user, {
    branchId: opts?.branchId,
    allowConsolidated: opts?.allowConsolidated
  });
  const rows = await prisma.employee.findMany({
    where: { businessId: user.businessId, ...scope, ...(status ? { status } : {}) },
    include: {
      branch: true,
      salesRep: { select: { id: true, code: true, name: true, status: true, commissionPercent: true } }
    },
    orderBy: { fullName: 'asc' }
  });
  return serialize(rows);
}

export async function createEmployee(user: AuthUser, body: Record<string, any>) {
  const fullName = requireString(body.full_name || body.fullName, 'full_name');
  const branchId = await branchAccess.resolveWriteBranchId(
    user,
    body.branch_id || body.branchId || user.activeBranchId
  );
  try {
    const row = await prisma.employee.create({
      data: {
        id: shortId('emp'),
        businessId: user.businessId,
        branchId,
        userId: body.user_id || body.userId || null,
        code: body.code ? String(body.code).trim() : null,
        fullName,
        email: body.email || null,
        phone: body.phone || null,
        department: body.department || null,
        jobTitle: body.job_title || body.jobTitle || null,
        hireDate: body.hire_date || body.hireDate ? new Date(body.hire_date || body.hireDate) : null,
        baseSalary: toDec(Number(body.base_salary ?? body.baseSalary ?? 0)),
        payFrequency: body.pay_frequency || body.payFrequency || 'monthly',
        bankName: body.bank_name || body.bankName || null,
        bankAccount: body.bank_account || body.bankAccount || null,
        taxId: body.tax_id || body.taxId || null,
        pensionId: body.pension_id || body.pensionId || null,
        status: body.status || 'active',
        createdById: user.id
      },
      include: { branch: true }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'hr',
      entityType: 'Employee',
      entityId: row.id,
      summary: `Created employee ${fullName}`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Employee code already exists');
    throw err;
  }
}

export async function updateEmployee(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.employee.findFirst({
    where: { id, businessId: user.businessId }
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
    branch_id: 'branchId',
    branchId: 'branchId',
    user_id: 'userId',
    userId: 'userId',
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

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.update({
        where: { id },
        data: data as any,
        include: {
          branch: true,
          salesRep: { select: { id: true, code: true, name: true, status: true, commissionPercent: true } }
        }
      });

      // Keep linked sales-rep commercial profile aligned with HR identity fields
      if (emp.salesRep) {
        const repPatch: Record<string, unknown> = {};
        if (data.fullName !== undefined) repPatch.name = data.fullName;
        if (data.phone !== undefined) repPatch.phone = data.phone;
        if (data.email !== undefined) repPatch.email = data.email;
        if (data.userId !== undefined) repPatch.userId = data.userId;
        if (data.branchId !== undefined) repPatch.branchId = data.branchId;
        if (data.code !== undefined) repPatch.code = data.code;
        if (data.status !== undefined) {
          repPatch.status = data.status === 'inactive' ? 'inactive' : 'active';
        }
        if (Object.keys(repPatch).length) {
          await tx.salesRep.update({ where: { id: emp.salesRep.id }, data: repPatch as any });
        }
      }

      return emp;
    });
    await writeAudit({
      user,
      action: 'edit',
      module: 'hr',
      entityType: 'Employee',
      entityId: id,
      summary: `Updated employee ${updated.fullName}`
    });
    return serialize(updated);
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
