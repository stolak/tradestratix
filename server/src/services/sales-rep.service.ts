import { prisma } from '../utils/prisma.js';
import { httpError, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';
import * as branchAccess from './branch-access.service.js';

const repInclude = {
  branch: true,
  employee: {
    select: {
      id: true,
      code: true,
      fullName: true,
      email: true,
      phone: true,
      department: true,
      jobTitle: true,
      status: true,
      branchId: true,
      userId: true
    }
  },
  _count: { select: { invoices: true, commissions: true } }
} as const;

async function assertEmployeeAvailable(
  businessId: string,
  employeeId: string,
  excludeSalesRepId?: string
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, businessId },
    include: { salesRep: { select: { id: true } } }
  });
  if (!employee) throw httpError(400, 'employee_id is invalid for this business');
  if (employee.salesRep && employee.salesRep.id !== excludeSalesRepId) {
    throw httpError(409, 'Employee is already linked to another sales rep');
  }
  return employee;
}

/** Ensure HR employee exists for a sales-rep create/update. */
async function resolveEmployeeForRep(
  user: AuthUser,
  body: Record<string, any>,
  opts: {
    name: string;
    code?: string | null;
    phone?: string | null;
    email?: string | null;
    branchId?: string | null;
    userId?: string | null;
    status?: string;
  }
) {
  const employeeId = body.employee_id || body.employeeId || null;
  if (employeeId) {
    return assertEmployeeAvailable(user.businessId, String(employeeId));
  }

  // Auto-create HR employee so every sales rep is also an employee
  const branchId =
    opts.branchId || (await branchAccess.resolveWriteBranchId(user, user.activeBranchId));

  try {
    return await prisma.employee.create({
      data: {
        id: shortId('emp'),
        businessId: user.businessId,
        branchId,
        userId: opts.userId || null,
        code: opts.code || null,
        fullName: opts.name,
        phone: opts.phone || null,
        email: opts.email || null,
        department: body.department || 'Sales',
        jobTitle: body.job_title || body.jobTitle || 'Sales Representative',
        status: opts.status === 'inactive' ? 'inactive' : 'active',
        createdById: user.id
      }
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw httpError(
        409,
        'Employee code already exists — pass employee_id to link an existing employee'
      );
    }
    throw err;
  }
}

export async function listSalesReps(businessId: string) {
  const rows = await prisma.salesRep.findMany({
    where: { businessId },
    include: repInclude,
    orderBy: { name: 'asc' }
  });
  return serialize(rows);
}

export async function createSalesRep(user: AuthUser, body: Record<string, any>) {
  const employeeIdHint = body.employee_id || body.employeeId || null;
  const rawName = body.name || body.full_name || body.fullName;
  if (!employeeIdHint && !rawName) {
    throw httpError(400, 'name is required when employee_id is not provided');
  }

  const code = body.code ? String(body.code).trim() : null;
  const phone = body.phone || null;
  const email = body.email || null;
  const userId = body.user_id || body.userId || null;
  const branchId = body.branch_id || body.branchId || user.defaultBranchId || null;
  const status = body.status || 'active';
  const commissionPercent = Number(body.commission_percent ?? body.commissionPercent ?? 0);

  const employee = await resolveEmployeeForRep(user, body, {
    name: String(rawName || '').trim() || 'Sales Representative',
    code,
    phone,
    email,
    branchId,
    userId,
    status
  });

  const name = String(rawName || employee.fullName).trim();

  try {
    const row = await prisma.salesRep.create({
      data: {
        id: shortId('rep'),
        businessId: user.businessId,
        employeeId: employee.id,
        name,
        code: code || employee.code,
        phone: phone || employee.phone,
        email: email || employee.email,
        userId: userId || employee.userId,
        branchId: branchId || employee.branchId,
        commissionPercent,
        status,
        createdById: user.id
      },
      include: repInclude
    });
    await writeAudit({
      user,
      action: 'create',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: row.id,
      summary: `Created sales rep ${row.name} (employee ${employee.id})`
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
  const map: Record<string, string> = {
    name: 'name',
    code: 'code',
    phone: 'phone',
    email: 'email',
    user_id: 'userId',
    userId: 'userId',
    branch_id: 'branchId',
    branchId: 'branchId',
    commission_percent: 'commissionPercent',
    commissionPercent: 'commissionPercent',
    status: 'status'
  };
  for (const [k, field] of Object.entries(map)) {
    if (body[k] !== undefined) data[field] = body[k];
  }

  if (body.employee_id !== undefined || body.employeeId !== undefined) {
    const nextEmployeeId = body.employee_id ?? body.employeeId;
    if (!nextEmployeeId) throw httpError(400, 'employee_id cannot be cleared; every sales rep must be an employee');
    const employee = await assertEmployeeAvailable(user.businessId, String(nextEmployeeId), id);
    data.employeeId = employee.id;
    if (data.name === undefined) data.name = employee.fullName;
    if (data.phone === undefined) data.phone = employee.phone;
    if (data.email === undefined) data.email = employee.email;
    if (data.userId === undefined) data.userId = employee.userId;
    if (data.branchId === undefined) data.branchId = employee.branchId;
    if (data.code === undefined && employee.code) data.code = employee.code;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const rep = await tx.salesRep.update({
        where: { id },
        data: data as any,
        include: repInclude
      });

      // Keep linked employee identity fields in sync when commercial profile changes
      if (rep.employeeId) {
        const empPatch: Record<string, unknown> = {};
        if (data.name !== undefined) empPatch.fullName = data.name;
        if (data.phone !== undefined) empPatch.phone = data.phone;
        if (data.email !== undefined) empPatch.email = data.email;
        if (data.userId !== undefined) empPatch.userId = data.userId;
        if (data.branchId !== undefined) empPatch.branchId = data.branchId;
        if (data.code !== undefined) empPatch.code = data.code;
        if (data.status !== undefined) {
          empPatch.status = data.status === 'inactive' ? 'inactive' : 'active';
        }
        if (Object.keys(empPatch).length) {
          await tx.employee.update({ where: { id: rep.employeeId }, data: empPatch as any });
        }
      }

      return rep;
    });

    await writeAudit({
      user,
      action: 'update',
      module: 'sales_reps',
      entityType: 'SalesRep',
      entityId: id,
      summary: `Updated sales rep ${updated.name}`
    });
    return serialize(updated);
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
    include: { salesRep: true, invoice: true },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}
