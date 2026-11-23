import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { httpError, requireString, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';
import { promoteEmployeeToSalesRep } from './sales-rep.service.js';
import { assignBranchWarehousesToUser } from './warehouse.service.js';
import { issuePasswordSetupInvite } from './password-setup.service.js';

type BranchListOpts = {
  branchId?: string | null;
  allowConsolidated?: boolean;
};

function dateOnly(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'Invalid date');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function normalizeStaffNumber(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw httpError(400, 'staff_number is required');
  if (value.length < 2) throw httpError(400, 'staff_number is too short');
  if (/\s/.test(value)) throw httpError(400, 'staff_number cannot contain spaces');
  return value;
}

async function resolveDepartment(
  businessId: string,
  rawId: unknown
): Promise<{ id: string; name: string } | null> {
  if (rawId == null || rawId === '') return null;
  const row = await prisma.department.findFirst({
    where: { id: String(rawId), businessId, isActive: true }
  });
  if (!row) throw httpError(400, 'Invalid department_id');
  return { id: row.id, name: row.name };
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
  departmentRef: { select: { id: true, code: true, name: true, isActive: true } },
  payGrade: { select: { id: true, code: true, name: true, maxStep: true } },
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

async function resolvePayGradeId(businessId: string, raw: unknown) {
  if (raw == null || raw === '') return null;
  const id = String(raw);
  const grade = await prisma.payGrade.findFirst({ where: { id, businessId } });
  if (!grade) throw httpError(400, 'Invalid pay_grade_id');
  return grade.id;
}

function resolvePayStep(raw: unknown, maxStep?: number | null): number | null {
  if (raw == null || raw === '') return null;
  const step = Number(raw);
  if (!Number.isInteger(step) || step < 1) {
    throw httpError(400, 'pay_step must be a positive integer');
  }
  if (maxStep != null && step > maxStep) {
    throw httpError(400, `pay_step cannot exceed grade max step (${maxStep})`);
  }
  return step;
}

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
  const staffNumber = normalizeStaffNumber(
    body.staff_number ?? body.staffNumber ?? body.code
  );
  const email = requireString(body.email, 'email').toLowerCase();
  const isSalesRep = Boolean(
    body.is_sales_rep ?? body.isSalesRep ?? body.make_sales_rep ?? body.makeSalesRep
  );
  const branchId = await resolveEmployeeHomeBranch(
    user.businessId,
    body.branch_id || body.branchId || null
  );
  const department = await resolveDepartment(
    user.businessId,
    body.department_id ?? body.departmentId
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

  // Staff number is the login username.
  const username = staffNumber;
  const userClash = await prisma.user.findFirst({
    where: { businessId: user.businessId, username }
  });
  if (userClash) throw httpError(409, 'Staff number is already used as a username');
  const codeClash = await prisma.employee.findFirst({
    where: { businessId: user.businessId, code: staffNumber }
  });
  if (codeClash) throw httpError(409, 'Staff number already exists');

  // Placeholder hash until the staff sets a password via invite link.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

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

  const resolvedPayGradeId = await resolvePayGradeId(
    user.businessId,
    body.pay_grade_id ?? body.payGradeId
  );
  const gradeMax = resolvedPayGradeId
    ? (
        await prisma.payGrade.findFirst({
          where: { id: resolvedPayGradeId, businessId: user.businessId },
          select: { maxStep: true }
        })
      )?.maxStep
    : null;
  const resolvedPayStep = resolvePayStep(body.pay_step ?? body.payStep, gradeMax);

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
          email,
          phone: body.phone || null,
          department: department?.name || null,
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
          code: staffNumber,
          fullName,
          email,
          phone: body.phone || null,
          department: department?.name || null,
          departmentId: department?.id || null,
          jobTitle:
            body.job_title ||
            body.jobTitle ||
            (isSalesRep ? 'Sales Representative' : null),
          hireDate:
            body.hire_date || body.hireDate ? new Date(body.hire_date || body.hireDate) : null,
          baseSalary: toDec(Number(body.base_salary ?? body.baseSalary ?? 0)),
          payFrequency: body.pay_frequency || body.payFrequency || 'monthly',
          payGradeId: resolvedPayGradeId,
          payStep: resolvedPayStep,
          employmentType: body.employment_type || body.employmentType || 'permanent',
          includeSalesCommission:
            body.include_sales_commission ?? body.includeSalesCommission ?? true,
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

    const business = await prisma.business.findUnique({
      where: { id: user.businessId },
      select: { name: true }
    });
    const invite = await issuePasswordSetupInvite({
      userId: created.login.id,
      email,
      fullName,
      username,
      businessName: business?.name
    });

    await writeAudit({
      user,
      action: 'create',
      module: 'hr',
      entityType: 'Employee',
      entityId: created.emp.id,
      summary: `Created employee ${fullName} (staff ${username})${isSalesRep ? ' as sales rep' : ''}`
    });

    const fresh = await prisma.employee.findUnique({
      where: { id: created.emp.id },
      include: employeeInclude
    });

    return serialize({
      ...fresh,
      login_username: username,
      staff_number: staffNumber,
      invite_link: invite.invite_link,
      invite_email_sent: invite.email_sent,
      invite_email_error: invite.email_error,
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
      if (target.includes('username')) throw httpError(409, 'Staff number is already used as a username');
      if (target.includes('code')) throw httpError(409, 'Staff number already exists');
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
    email: 'email',
    phone: 'phone',
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

  let nextStaffNumber: string | undefined;
  if (
    body.staff_number !== undefined ||
    body.staffNumber !== undefined ||
    body.code !== undefined
  ) {
    nextStaffNumber = normalizeStaffNumber(
      body.staff_number ?? body.staffNumber ?? body.code
    );
    data.code = nextStaffNumber;
  }

  if (body.department_id !== undefined || body.departmentId !== undefined) {
    const department = await resolveDepartment(
      user.businessId,
      body.department_id ?? body.departmentId
    );
    data.departmentId = department?.id || null;
    data.department = department?.name || null;
  }
  if (body.hire_date !== undefined || body.hireDate !== undefined) {
    data.hireDate = body.hire_date || body.hireDate ? new Date(body.hire_date || body.hireDate) : null;
  }
  if (body.base_salary !== undefined || body.baseSalary !== undefined) {
    data.baseSalary = toDec(Number(body.base_salary ?? body.baseSalary));
  }
  const nextPayGradeId =
    body.pay_grade_id !== undefined || body.payGradeId !== undefined
      ? await resolvePayGradeId(user.businessId, body.pay_grade_id ?? body.payGradeId)
      : existing.payGradeId;
  if (body.pay_grade_id !== undefined || body.payGradeId !== undefined) {
    data.payGradeId = nextPayGradeId;
  }
  if (
    body.pay_step !== undefined ||
    body.payStep !== undefined ||
    body.pay_grade_id !== undefined ||
    body.payGradeId !== undefined
  ) {
    const gradeMax = nextPayGradeId
      ? (
          await prisma.payGrade.findFirst({
            where: { id: nextPayGradeId, businessId: user.businessId },
            select: { maxStep: true }
          })
        )?.maxStep
      : null;
    const stepRaw =
      body.pay_step !== undefined || body.payStep !== undefined
        ? (body.pay_step ?? body.payStep)
        : existing.payStep;
    data.payStep = nextPayGradeId ? resolvePayStep(stepRaw, gradeMax) : null;
  }
  if (body.employment_type !== undefined || body.employmentType !== undefined) {
    data.employmentType = body.employment_type || body.employmentType || 'permanent';
  }
  if (
    body.include_sales_commission !== undefined ||
    body.includeSalesCommission !== undefined
  ) {
    data.includeSalesCommission = Boolean(
      body.include_sales_commission ?? body.includeSalesCommission
    );
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
        if (nextStaffNumber) userPatch.username = nextStaffNumber;
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

export async function listDepartments(user: AuthUser, activeOnly = false) {
  const rows = await prisma.department.findMany({
    where: {
      businessId: user.businessId,
      ...(activeOnly ? { isActive: true } : {})
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  return serialize(rows);
}

export async function createDepartment(user: AuthUser, body: Record<string, any>) {
  const name = requireString(body.name, 'name');
  const code = body.code != null && String(body.code).trim() ? String(body.code).trim() : null;
  try {
    const row = await prisma.department.create({
      data: {
        id: shortId('dep'),
        businessId: user.businessId,
        name,
        code,
        isActive: body.is_active === false || body.isActive === false ? false : true,
        sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0) || 0
      }
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'hr',
      entityType: 'Department',
      entityId: row.id,
      summary: `Created department ${name}`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Department name or code already exists');
    throw err;
  }
}

export async function updateDepartment(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.department.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Department not found');

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = requireString(body.name, 'name');
  if (body.code !== undefined) {
    data.code = body.code != null && String(body.code).trim() ? String(body.code).trim() : null;
  }
  if (body.is_active !== undefined || body.isActive !== undefined) {
    data.isActive = Boolean(body.is_active ?? body.isActive);
  }
  if (body.sort_order !== undefined || body.sortOrder !== undefined) {
    data.sortOrder = Number(body.sort_order ?? body.sortOrder ?? 0) || 0;
  }

  try {
    const row = await prisma.department.update({ where: { id }, data: data as any });
    if (data.name && data.name !== existing.name) {
      await prisma.employee.updateMany({
        where: { businessId: user.businessId, departmentId: id },
        data: { department: String(data.name) }
      });
    }
    await writeAudit({
      user,
      action: 'update',
      module: 'hr',
      entityType: 'Department',
      entityId: id,
      summary: `Updated department ${row.name}`
    });
    return serialize(row);
  } catch (err: any) {
    if (err?.code === 'P2002') throw httpError(409, 'Department name or code already exists');
    throw err;
  }
}

export async function resendEmployeePasswordInvite(user: AuthUser, employeeId: string) {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, businessId: user.businessId },
    include: { user: true, business: { select: { name: true } } }
  });
  if (!emp) throw httpError(404, 'Employee not found');
  if (!emp.user?.email) throw httpError(400, 'Employee has no email address');

  const invite = await issuePasswordSetupInvite({
    userId: emp.userId,
    email: emp.user.email,
    fullName: emp.fullName,
    username: emp.user.username,
    businessName: emp.business?.name
  });

  await writeAudit({
    user,
    action: 'invite',
    module: 'hr',
    entityType: 'Employee',
    entityId: emp.id,
    summary: `Resent password setup invite to ${emp.user.email}`
  });

  return serialize({
    id: emp.id,
    login_username: emp.user.username,
    invite_link: invite.invite_link,
    invite_email_sent: invite.email_sent,
    invite_email_error: invite.email_error
  });
}
