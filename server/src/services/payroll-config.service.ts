import { prisma } from '../utils/prisma.js';
import { httpError, requireString, roundMoney, serialize, shortId, toDec } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

const COMPONENT_TYPES = new Set(['earning', 'deduction', 'employer_contribution']);
const CALC_METHODS = new Set([
  'fixed',
  'percent_of_components',
  'progressive_tax',
  'statutory_rate',
  'sales_commission'
]);
const EMPLOYMENT_TYPES = new Set(['permanent', 'contract', 'casual', 'intern']);
const STATUTORY_METHODS = new Set(['progressive_brackets', 'flat_rate']);

type StarterComponent = {
  code: string;
  name: string;
  shortName: string;
  type: string;
  calculationMethod: string;
  isTaxable?: boolean;
  isPensionable?: boolean;
  isStatutory?: boolean;
  isPrimary?: boolean;
  functionElements?: string[];
  functionPercentage?: number;
  statutoryKey?: string;
  sortOrder: number;
};

const STARTER_COMPONENTS: StarterComponent[] = [
  {
    code: 'BASIC',
    name: 'Basic salary',
    shortName: 'Basic',
    type: 'earning',
    calculationMethod: 'fixed',
    isTaxable: true,
    isPensionable: true,
    isPrimary: true,
    sortOrder: 10
  },
  {
    code: 'HOUSING',
    name: 'Housing allowance',
    shortName: 'Housing',
    type: 'earning',
    calculationMethod: 'fixed',
    isTaxable: true,
    isPensionable: true,
    sortOrder: 20
  },
  {
    code: 'TRANSPORT',
    name: 'Transport allowance',
    shortName: 'Transport',
    type: 'earning',
    calculationMethod: 'fixed',
    isTaxable: true,
    isPensionable: false,
    sortOrder: 30
  },
  {
    code: 'SALES_COMMISSION',
    name: 'Sales commission',
    shortName: 'Commission',
    type: 'earning',
    calculationMethod: 'sales_commission',
    isTaxable: true,
    isPensionable: false,
    sortOrder: 40
  },
  {
    code: 'PAYE',
    name: 'PAYE tax',
    shortName: 'PAYE',
    type: 'deduction',
    calculationMethod: 'progressive_tax',
    isStatutory: true,
    statutoryKey: 'paye',
    functionElements: ['BASIC', 'HOUSING', 'TRANSPORT', 'SALES_COMMISSION'],
    sortOrder: 100
  },
  {
    code: 'PENSION_EE',
    name: 'Pension (employee)',
    shortName: 'Pension EE',
    type: 'deduction',
    calculationMethod: 'statutory_rate',
    isStatutory: true,
    statutoryKey: 'pension_employee',
    functionElements: ['BASIC', 'HOUSING'],
    sortOrder: 110
  },
  {
    code: 'PENSION_ER',
    name: 'Pension (employer)',
    shortName: 'Pension ER',
    type: 'employer_contribution',
    calculationMethod: 'statutory_rate',
    isStatutory: true,
    statutoryKey: 'pension_employer',
    functionElements: ['BASIC', 'HOUSING'],
    sortOrder: 120
  },
  {
    code: 'NHF',
    name: 'National Housing Fund',
    shortName: 'NHF',
    type: 'deduction',
    calculationMethod: 'statutory_rate',
    isStatutory: true,
    statutoryKey: 'nhf',
    functionElements: ['BASIC'],
    sortOrder: 130
  }
];

/** Nigerian PAYE-style annual brackets (monthly tax = annual/12). Amounts in NGN. */
const DEFAULT_PAYE_BRACKETS: { upperLimit: number | null; rate: number }[] = [
  { upperLimit: 300_000, rate: 7 },
  { upperLimit: 600_000, rate: 11 },
  { upperLimit: 1_100_000, rate: 15 },
  { upperLimit: 1_600_000, rate: 19 },
  { upperLimit: 3_200_000, rate: 21 },
  { upperLimit: null, rate: 24 }
];

async function assertAccount(businessId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const acc = await prisma.account.findFirst({ where: { id: accountId, businessId } });
  if (!acc) throw httpError(400, 'Invalid account_id');
  if (!acc.isActive) throw httpError(400, 'Account is inactive');
  return acc.id;
}

function normalizeType(raw: unknown) {
  const v = String(raw || '').trim().toLowerCase();
  if (!COMPONENT_TYPES.has(v)) {
    throw httpError(400, `type must be one of: ${[...COMPONENT_TYPES].join(', ')}`);
  }
  return v;
}

function normalizeMethod(raw: unknown, fallback = 'fixed') {
  const v = String(raw || fallback).trim().toLowerCase() || fallback;
  if (!CALC_METHODS.has(v)) {
    throw httpError(400, `calculation_method must be one of: ${[...CALC_METHODS].join(', ')}`);
  }
  return v;
}

function normalizeEmploymentType(raw: unknown, fallback = 'permanent') {
  const v = String(raw || fallback).trim().toLowerCase() || fallback;
  if (!EMPLOYMENT_TYPES.has(v)) {
    throw httpError(400, `employment_type must be one of: ${[...EMPLOYMENT_TYPES].join(', ')}`);
  }
  return v;
}

function parseFunctionElements(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\s]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
  }
  throw httpError(400, 'function_elements must be an array or comma-separated codes');
}

// ── Ensure defaults ──────────────────────────────────────────────────────────

/** Idempotent starter components + PAYE/pension/NHF statutory rules. */
export async function ensurePayrollDefaults(user: AuthUser) {
  const businessId = user.businessId;

  for (const def of STARTER_COMPONENTS) {
    const existing = await prisma.salaryComponent.findFirst({
      where: { businessId, code: def.code }
    });
    if (existing) continue;
    await prisma.salaryComponent.create({
      data: {
        id: shortId('sc'),
        businessId,
        code: def.code,
        name: def.name,
        shortName: def.shortName,
        type: def.type,
        calculationMethod: def.calculationMethod,
        isTaxable: def.isTaxable ?? false,
        isPensionable: def.isPensionable ?? false,
        isStatutory: def.isStatutory ?? false,
        isPrimary: def.isPrimary ?? false,
        functionElements: def.functionElements ?? undefined,
        functionPercentage: def.functionPercentage != null ? toDec(def.functionPercentage) : null,
        statutoryKey: def.statutoryKey ?? null,
        sortOrder: def.sortOrder,
        isActive: def.code !== 'NHF',
        createdById: user.id
      }
    });
  }

  const paye = await prisma.payrollStatutoryRule.findFirst({
    where: { businessId, key: 'paye' },
    include: { brackets: true }
  });
  if (!paye) {
    await prisma.payrollStatutoryRule.create({
      data: {
        id: shortId('psr'),
        businessId,
        key: 'paye',
        name: 'PAYE (progressive)',
        method: 'progressive_brackets',
        baseKey: 'taxable',
        isActive: true,
        createdById: user.id,
        brackets: {
          create: DEFAULT_PAYE_BRACKETS.map((b, i) => ({
            id: shortId('ptb'),
            sortOrder: i,
            upperLimit: b.upperLimit != null ? toDec(b.upperLimit) : null,
            rate: toDec(b.rate)
          }))
        }
      }
    });
  } else if (!paye.brackets.length) {
    await prisma.payrollTaxBracket.createMany({
      data: DEFAULT_PAYE_BRACKETS.map((b, i) => ({
        id: shortId('ptb'),
        ruleId: paye.id,
        sortOrder: i,
        upperLimit: b.upperLimit != null ? toDec(b.upperLimit) : null,
        rate: toDec(b.rate)
      }))
    });
  }

  const flatRules: { key: string; name: string; rate: number; baseKey: string; active: boolean }[] =
    [
      { key: 'pension_employee', name: 'Pension employee', rate: 8, baseKey: 'pensionable', active: true },
      { key: 'pension_employer', name: 'Pension employer', rate: 10, baseKey: 'pensionable', active: true },
      { key: 'nhf', name: 'National Housing Fund', rate: 2.5, baseKey: 'gross', active: false }
    ];

  for (const rule of flatRules) {
    const exists = await prisma.payrollStatutoryRule.findFirst({
      where: { businessId, key: rule.key }
    });
    if (exists) continue;
    await prisma.payrollStatutoryRule.create({
      data: {
        id: shortId('psr'),
        businessId,
        key: rule.key,
        name: rule.name,
        method: 'flat_rate',
        rate: toDec(rule.rate),
        baseKey: rule.baseKey,
        isActive: rule.active,
        createdById: user.id
      }
    });
  }

  const now = new Date();
  const period = await prisma.activePayrollPeriod.findUnique({ where: { businessId } });
  if (!period) {
    await prisma.activePayrollPeriod.create({
      data: {
        id: shortId('app'),
        businessId,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        updatedById: user.id
      }
    });
  }

  return getPayrollConfigSummary(user);
}

export async function getPayrollConfigSummary(user: AuthUser) {
  const businessId = user.businessId;
  const [components, grades, statutory, period, chartCount] = await Promise.all([
    prisma.salaryComponent.count({ where: { businessId } }),
    prisma.payGrade.count({ where: { businessId } }),
    prisma.payrollStatutoryRule.count({ where: { businessId } }),
    prisma.activePayrollPeriod.findUnique({ where: { businessId } }),
    prisma.salaryChartEntry.count({ where: { businessId } })
  ]);
  return serialize({
    components,
    grades,
    statutory,
    chartEntries: chartCount,
    activePeriod: period
  });
}

// ── Components ───────────────────────────────────────────────────────────────

export async function listComponents(user: AuthUser, activeOnly = false) {
  const rows = await prisma.salaryComponent.findMany({
    where: {
      businessId: user.businessId,
      ...(activeOnly ? { isActive: true } : {})
    },
    include: { account: { select: { id: true, code: true, name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });
  return serialize(rows);
}

export async function createComponent(user: AuthUser, body: Record<string, any>) {
  const code = requireString(body.code, 'code').toUpperCase();
  const name = requireString(body.name, 'name');
  const type = normalizeType(body.type);
  const calculationMethod = normalizeMethod(body.calculation_method || body.calculationMethod);
  const accountId = await assertAccount(user.businessId, body.account_id || body.accountId);

  const dup = await prisma.salaryComponent.findFirst({
    where: { businessId: user.businessId, code }
  });
  if (dup) throw httpError(409, `Component code ${code} already exists`);

  if (body.is_primary || body.isPrimary) {
    await prisma.salaryComponent.updateMany({
      where: { businessId: user.businessId, isPrimary: true },
      data: { isPrimary: false }
    });
  }

  const row = await prisma.salaryComponent.create({
    data: {
      id: shortId('sc'),
      businessId: user.businessId,
      code,
      name,
      shortName: body.short_name || body.shortName || null,
      type,
      calculationMethod,
      isTaxable: Boolean(body.is_taxable ?? body.isTaxable),
      isPensionable: Boolean(body.is_pensionable ?? body.isPensionable),
      isStatutory: Boolean(body.is_statutory ?? body.isStatutory),
      isPrimary: Boolean(body.is_primary ?? body.isPrimary),
      functionElements: parseFunctionElements(body.function_elements ?? body.functionElements),
      functionPercentage:
        body.function_percentage != null || body.functionPercentage != null
          ? toDec(Number(body.function_percentage ?? body.functionPercentage))
          : null,
      statutoryKey: body.statutory_key || body.statutoryKey || null,
      accountId,
      sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
      isActive: body.is_active ?? body.isActive ?? true,
      createdById: user.id
    },
    include: { account: { select: { id: true, code: true, name: true } } }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'payroll',
    entityType: 'SalaryComponent',
    entityId: row.id,
    summary: 'payroll.component.create'
  });

  return serialize(row);
}

export async function updateComponent(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.salaryComponent.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Salary component not found');

  const accountId =
    body.account_id !== undefined || body.accountId !== undefined
      ? await assertAccount(user.businessId, body.account_id ?? body.accountId)
      : undefined;

  if (body.is_primary || body.isPrimary) {
    await prisma.salaryComponent.updateMany({
      where: { businessId: user.businessId, isPrimary: true, NOT: { id } },
      data: { isPrimary: false }
    });
  }

  const row = await prisma.salaryComponent.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: requireString(body.name, 'name') } : {}),
      ...(body.short_name !== undefined || body.shortName !== undefined
        ? { shortName: body.short_name ?? body.shortName ?? null }
        : {}),
      ...(body.type != null ? { type: normalizeType(body.type) } : {}),
      ...(body.calculation_method != null || body.calculationMethod != null
        ? {
            calculationMethod: normalizeMethod(
              body.calculation_method ?? body.calculationMethod,
              existing.calculationMethod
            )
          }
        : {}),
      ...(body.is_taxable !== undefined || body.isTaxable !== undefined
        ? { isTaxable: Boolean(body.is_taxable ?? body.isTaxable) }
        : {}),
      ...(body.is_pensionable !== undefined || body.isPensionable !== undefined
        ? { isPensionable: Boolean(body.is_pensionable ?? body.isPensionable) }
        : {}),
      ...(body.is_statutory !== undefined || body.isStatutory !== undefined
        ? { isStatutory: Boolean(body.is_statutory ?? body.isStatutory) }
        : {}),
      ...(body.is_primary !== undefined || body.isPrimary !== undefined
        ? { isPrimary: Boolean(body.is_primary ?? body.isPrimary) }
        : {}),
      ...(body.function_elements !== undefined || body.functionElements !== undefined
        ? {
            functionElements: parseFunctionElements(
              body.function_elements ?? body.functionElements
            )
          }
        : {}),
      ...(body.function_percentage !== undefined || body.functionPercentage !== undefined
        ? {
            functionPercentage:
              body.function_percentage != null || body.functionPercentage != null
                ? toDec(Number(body.function_percentage ?? body.functionPercentage))
                : null
          }
        : {}),
      ...(body.statutory_key !== undefined || body.statutoryKey !== undefined
        ? { statutoryKey: body.statutory_key ?? body.statutoryKey ?? null }
        : {}),
      ...(accountId !== undefined ? { accountId } : {}),
      ...(body.sort_order !== undefined || body.sortOrder !== undefined
        ? { sortOrder: Number(body.sort_order ?? body.sortOrder) }
        : {}),
      ...(body.is_active !== undefined || body.isActive !== undefined
        ? { isActive: Boolean(body.is_active ?? body.isActive) }
        : {})
    },
    include: { account: { select: { id: true, code: true, name: true } } }
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'payroll',
    entityType: 'SalaryComponent',
    entityId: row.id,
    summary: 'payroll.component.update'
  });

  return serialize(row);
}

// ── Pay grades ───────────────────────────────────────────────────────────────

export async function listPayGrades(user: AuthUser, activeOnly = false) {
  const rows = await prisma.payGrade.findMany({
    where: {
      businessId: user.businessId,
      ...(activeOnly ? { isActive: true } : {})
    },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }]
  });
  return serialize(rows);
}

export async function createPayGrade(user: AuthUser, body: Record<string, any>) {
  const code = requireString(body.code, 'code').toUpperCase();
  const name = requireString(body.name, 'name');
  const maxStep = Math.max(1, Number(body.max_step ?? body.maxStep ?? 1));

  const dup = await prisma.payGrade.findFirst({
    where: { businessId: user.businessId, code }
  });
  if (dup) throw httpError(409, `Pay grade ${code} already exists`);

  const row = await prisma.payGrade.create({
    data: {
      id: shortId('pg'),
      businessId: user.businessId,
      code,
      name,
      maxStep,
      sortOrder: Number(body.sort_order ?? body.sortOrder ?? 0),
      isActive: body.is_active ?? body.isActive ?? true,
      createdById: user.id
    }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'payroll',
    entityType: 'PayGrade',
    entityId: row.id,
    summary: 'payroll.grade.create'
  });

  return serialize(row);
}

export async function updatePayGrade(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.payGrade.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Pay grade not found');

  const row = await prisma.payGrade.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: requireString(body.name, 'name') } : {}),
      ...(body.max_step !== undefined || body.maxStep !== undefined
        ? { maxStep: Math.max(1, Number(body.max_step ?? body.maxStep)) }
        : {}),
      ...(body.sort_order !== undefined || body.sortOrder !== undefined
        ? { sortOrder: Number(body.sort_order ?? body.sortOrder) }
        : {}),
      ...(body.is_active !== undefined || body.isActive !== undefined
        ? { isActive: Boolean(body.is_active ?? body.isActive) }
        : {})
    }
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'payroll',
    entityType: 'PayGrade',
    entityId: row.id,
    summary: 'payroll.grade.update'
  });

  return serialize(row);
}

// ── Salary chart ─────────────────────────────────────────────────────────────

export async function listChartEntries(
  user: AuthUser,
  opts?: { payGradeId?: string; employmentType?: string }
) {
  const rows = await prisma.salaryChartEntry.findMany({
    where: {
      businessId: user.businessId,
      ...(opts?.payGradeId ? { payGradeId: opts.payGradeId } : {}),
      ...(opts?.employmentType
        ? { employmentType: normalizeEmploymentType(opts.employmentType) }
        : {})
    },
    include: {
      payGrade: { select: { id: true, code: true, name: true } },
      component: { select: { id: true, code: true, name: true, type: true } }
    },
    orderBy: [{ payGradeId: 'asc' }, { step: 'asc' }, { employmentType: 'asc' }]
  });
  return serialize(rows);
}

export async function upsertChartEntry(user: AuthUser, body: Record<string, any>) {
  const payGradeId = requireString(body.pay_grade_id || body.payGradeId, 'pay_grade_id');
  const componentId = requireString(body.component_id || body.componentId, 'component_id');
  const step = Math.max(1, Number(body.step ?? 1));
  const employmentType = normalizeEmploymentType(body.employment_type || body.employmentType);
  const amount = roundMoney(Number(body.amount ?? 0));
  if (amount < 0) throw httpError(400, 'amount cannot be negative');

  const grade = await prisma.payGrade.findFirst({
    where: { id: payGradeId, businessId: user.businessId }
  });
  if (!grade) throw httpError(400, 'Invalid pay_grade_id');
  if (step > grade.maxStep) throw httpError(400, `step cannot exceed grade max_step (${grade.maxStep})`);

  const component = await prisma.salaryComponent.findFirst({
    where: { id: componentId, businessId: user.businessId }
  });
  if (!component) throw httpError(400, 'Invalid component_id');
  if (component.calculationMethod !== 'fixed') {
    throw httpError(400, 'Only fixed components can be set on the salary chart');
  }

  const existing = await prisma.salaryChartEntry.findFirst({
    where: { payGradeId, step, employmentType, componentId }
  });

  const row = existing
    ? await prisma.salaryChartEntry.update({
        where: { id: existing.id },
        data: {
          amount: toDec(amount),
          isActive: body.is_active ?? body.isActive ?? true
        },
        include: {
          payGrade: { select: { id: true, code: true, name: true } },
          component: { select: { id: true, code: true, name: true, type: true } }
        }
      })
    : await prisma.salaryChartEntry.create({
        data: {
          id: shortId('sce'),
          businessId: user.businessId,
          payGradeId,
          step,
          employmentType,
          componentId,
          amount: toDec(amount),
          isActive: body.is_active ?? body.isActive ?? true,
          createdById: user.id
        },
        include: {
          payGrade: { select: { id: true, code: true, name: true } },
          component: { select: { id: true, code: true, name: true, type: true } }
        }
      });

  await writeAudit({
    user,
    action: existing ? 'update' : 'create',
    module: 'payroll',
    entityType: 'SalaryChartEntry',
    entityId: row.id,
    summary: existing ? 'payroll.chart.update' : 'payroll.chart.create'
  });

  return serialize(row);
}

export async function deleteChartEntry(user: AuthUser, id: string) {
  const existing = await prisma.salaryChartEntry.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Chart entry not found');
  await prisma.salaryChartEntry.delete({ where: { id } });
  await writeAudit({
    user,
    action: 'delete',
    module: 'payroll',
    entityType: 'SalaryChartEntry',
    entityId: id,
    summary: 'payroll.chart.delete'
  });
  return { ok: true };
}

// ── Statutory ────────────────────────────────────────────────────────────────

export async function listStatutoryRules(user: AuthUser) {
  const rows = await prisma.payrollStatutoryRule.findMany({
    where: { businessId: user.businessId },
    include: { brackets: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { key: 'asc' }
  });
  return serialize(rows);
}

export async function upsertStatutoryRule(user: AuthUser, body: Record<string, any>) {
  const key = requireString(body.key, 'key').toLowerCase();
  const name = requireString(body.name, 'name');
  const method = String(body.method || 'flat_rate').toLowerCase();
  if (!STATUTORY_METHODS.has(method)) {
    throw httpError(400, `method must be one of: ${[...STATUTORY_METHODS].join(', ')}`);
  }

  const existing = await prisma.payrollStatutoryRule.findFirst({
    where: { businessId: user.businessId, key },
    include: { brackets: true }
  });

  const rate =
    body.rate != null && body.rate !== '' ? toDec(Number(body.rate)) : existing?.rate ?? null;

  const rule = existing
    ? await prisma.payrollStatutoryRule.update({
        where: { id: existing.id },
        data: {
          name,
          method,
          rate,
          baseKey: body.base_key || body.baseKey || existing.baseKey,
          isActive: body.is_active ?? body.isActive ?? existing.isActive
        }
      })
    : await prisma.payrollStatutoryRule.create({
        data: {
          id: shortId('psr'),
          businessId: user.businessId,
          key,
          name,
          method,
          rate,
          baseKey: body.base_key || body.baseKey || null,
          isActive: body.is_active ?? body.isActive ?? true,
          createdById: user.id
        }
      });

  const bracketsRaw = body.brackets;
  if (Array.isArray(bracketsRaw)) {
    await prisma.payrollTaxBracket.deleteMany({ where: { ruleId: rule.id } });
    if (bracketsRaw.length) {
      await prisma.payrollTaxBracket.createMany({
        data: bracketsRaw.map((b: any, i: number) => ({
          id: shortId('ptb'),
          ruleId: rule.id,
          sortOrder: Number(b.sort_order ?? b.sortOrder ?? i),
          upperLimit:
            b.upper_limit != null || b.upperLimit != null
              ? toDec(Number(b.upper_limit ?? b.upperLimit))
              : null,
          rate: toDec(Number(b.rate ?? 0))
        }))
      });
    }
  }

  const full = await prisma.payrollStatutoryRule.findUnique({
    where: { id: rule.id },
    include: { brackets: { orderBy: { sortOrder: 'asc' } } }
  });

  await writeAudit({
    user,
    action: existing ? 'update' : 'create',
    module: 'payroll',
    entityType: 'PayrollStatutoryRule',
    entityId: rule.id,
    summary: existing ? 'payroll.statutory.update' : 'payroll.statutory.create'
  });

  return serialize(full);
}

// ── Active period ────────────────────────────────────────────────────────────

export async function getActivePeriod(user: AuthUser) {
  let period = await prisma.activePayrollPeriod.findUnique({
    where: { businessId: user.businessId }
  });
  if (!period) {
    const now = new Date();
    period = await prisma.activePayrollPeriod.create({
      data: {
        id: shortId('app'),
        businessId: user.businessId,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        updatedById: user.id
      }
    });
  }
  return serialize(period);
}

export async function setActivePeriod(user: AuthUser, body: Record<string, any>) {
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw httpError(400, 'year must be a valid calendar year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw httpError(400, 'month must be 1–12');
  }

  const period = await prisma.activePayrollPeriod.upsert({
    where: { businessId: user.businessId },
    create: {
      id: shortId('app'),
      businessId: user.businessId,
      year,
      month,
      updatedById: user.id
    },
    update: { year, month, updatedById: user.id }
  });

  await writeAudit({
    user,
    action: 'update',
    module: 'payroll',
    entityType: 'ActivePayrollPeriod',
    entityId: period.id,
    summary: 'payroll.period.set'
  });

  return serialize(period);
}

// ── Employee package & overrides (H2 foothold) ───────────────────────────────

export async function listEmployeePackage(user: AuthUser, employeeId: string) {
  await assertEmployee(user.businessId, employeeId);
  const rows = await prisma.employeePayPackageLine.findMany({
    where: { businessId: user.businessId, employeeId },
    include: { component: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: 'asc' }
  });
  return serialize(rows);
}

export async function upsertEmployeePackageLine(user: AuthUser, body: Record<string, any>) {
  const employeeId = requireString(body.employee_id || body.employeeId, 'employee_id');
  const componentId = requireString(body.component_id || body.componentId, 'component_id');
  const amount = roundMoney(Number(body.amount ?? 0));
  if (amount < 0) throw httpError(400, 'amount cannot be negative');

  await assertEmployee(user.businessId, employeeId);
  const component = await prisma.salaryComponent.findFirst({
    where: { id: componentId, businessId: user.businessId }
  });
  if (!component) throw httpError(400, 'Invalid component_id');
  if (component.calculationMethod !== 'fixed') {
    throw httpError(400, 'Only fixed components belong on an employee package');
  }

  const existing = await prisma.employeePayPackageLine.findFirst({
    where: { employeeId, componentId }
  });

  const row = existing
    ? await prisma.employeePayPackageLine.update({
        where: { id: existing.id },
        data: {
          amount: toDec(amount),
          isActive: body.is_active ?? body.isActive ?? true
        },
        include: { component: { select: { id: true, code: true, name: true, type: true } } }
      })
    : await prisma.employeePayPackageLine.create({
        data: {
          id: shortId('epl'),
          businessId: user.businessId,
          employeeId,
          componentId,
          amount: toDec(amount),
          isActive: body.is_active ?? body.isActive ?? true,
          createdById: user.id
        },
        include: { component: { select: { id: true, code: true, name: true, type: true } } }
      });

  return serialize(row);
}

export async function listEmployeeOverrides(user: AuthUser, employeeId?: string) {
  const rows = await prisma.employeePayOverride.findMany({
    where: {
      businessId: user.businessId,
      ...(employeeId ? { employeeId } : {})
    },
    include: {
      employee: { select: { id: true, fullName: true, code: true } },
      component: { select: { id: true, code: true, name: true, type: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  return serialize(rows);
}

export async function createEmployeeOverride(user: AuthUser, body: Record<string, any>) {
  const employeeId = requireString(body.employee_id || body.employeeId, 'employee_id');
  const componentId = requireString(body.component_id || body.componentId, 'component_id');
  const amount = roundMoney(Number(body.amount ?? 0));
  const isContinuous = body.is_continuous ?? body.isContinuous ?? true;
  const targetAmount =
    body.target_amount != null || body.targetAmount != null
      ? roundMoney(Number(body.target_amount ?? body.targetAmount))
      : null;

  await assertEmployee(user.businessId, employeeId);
  const component = await prisma.salaryComponent.findFirst({
    where: { id: componentId, businessId: user.businessId }
  });
  if (!component) throw httpError(400, 'Invalid component_id');

  const row = await prisma.employeePayOverride.create({
    data: {
      id: shortId('epo'),
      businessId: user.businessId,
      employeeId,
      componentId,
      amount: toDec(amount),
      isContinuous: Boolean(isContinuous),
      targetAmount: targetAmount != null ? toDec(targetAmount) : null,
      balanceRemaining: !isContinuous && targetAmount != null ? toDec(targetAmount) : null,
      effectiveFrom: body.effective_from || body.effectiveFrom
        ? new Date(body.effective_from || body.effectiveFrom)
        : null,
      effectiveTo: body.effective_to || body.effectiveTo
        ? new Date(body.effective_to || body.effectiveTo)
        : null,
      notes: body.notes || null,
      createdById: user.id
    },
    include: {
      employee: { select: { id: true, fullName: true, code: true } },
      component: { select: { id: true, code: true, name: true, type: true } }
    }
  });

  await writeAudit({
    user,
    action: 'create',
    module: 'payroll',
    entityType: 'EmployeePayOverride',
    entityId: row.id,
    summary: 'payroll.override.create'
  });

  return serialize(row);
}

export async function updateEmployeeOverride(user: AuthUser, id: string, body: Record<string, any>) {
  const existing = await prisma.employeePayOverride.findFirst({
    where: { id, businessId: user.businessId }
  });
  if (!existing) throw httpError(404, 'Override not found');

  const row = await prisma.employeePayOverride.update({
    where: { id },
    data: {
      ...(body.amount != null ? { amount: toDec(roundMoney(Number(body.amount))) } : {}),
      ...(body.is_active !== undefined || body.isActive !== undefined
        ? { isActive: Boolean(body.is_active ?? body.isActive) }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {})
    },
    include: {
      employee: { select: { id: true, fullName: true, code: true } },
      component: { select: { id: true, code: true, name: true, type: true } }
    }
  });

  return serialize(row);
}

async function assertEmployee(businessId: string, employeeId: string) {
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, businessId } });
  if (!emp) throw httpError(400, 'Invalid employee_id');
  return emp;
}
