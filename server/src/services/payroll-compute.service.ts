import { prisma } from '../utils/prisma.js';
import { roundMoney } from '../utils/helpers.js';

export type ComponentRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  calculationMethod: string;
  isTaxable: boolean;
  isPensionable: boolean;
  isStatutory: boolean;
  isPrimary: boolean;
  functionElements: unknown;
  functionPercentage: number | null;
  statutoryKey: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type StatutoryRuleRow = {
  id: string;
  key: string;
  method: string;
  rate: number | null;
  baseKey: string | null;
  isActive: boolean;
  brackets: { sortOrder: number; upperLimit: number | null; rate: number }[];
};

export type ChartAmount = { componentId: string; amount: number };
export type OverrideAmount = {
  componentId: string;
  amount: number;
  isContinuous: boolean;
  /** Total ceiling for one-off target mode; null/0 = single-shot */
  targetAmount: number | null;
  /** Remaining toward target (legacy / UI); ledger is source of truth at compute */
  balanceRemaining: number | null;
  overrideId: string;
  /** Any application in another period (one-shot gate) */
  hasPriorApplication?: boolean;
  /** Σ application amounts in other periods (target mode) */
  appliedTotal?: number;
};

/**
 * School-app parity: continuous / one-off / target.
 * Uses the per-period application ledger (other periods), not post-time balance alone.
 *
 * - Continuous → full amount every period
 * - One-off, target null/0 → full amount once (skip if any prior application exists)
 * - One-off, target > 0 → min(amount, target − Σ prior applications)
 */
export function resolveOverridePayable(
  override: OverrideAmount,
  opts?: { hasPriorApplication?: boolean; appliedTotal?: number }
): number | null {
  const amount = roundMoney(Number(override.amount) || 0);
  if (amount <= 0) return null;

  if (override.isContinuous) return amount;

  const targetRaw = override.targetAmount;
  const target =
    targetRaw != null && Number(targetRaw) > 0 ? roundMoney(Number(targetRaw)) : null;

  if (target == null) {
    // Single-shot: any prior-period application → skip (school hasPriorProcessOverride)
    if (opts?.hasPriorApplication) return null;
    return amount;
  }

  const applied = roundMoney(Math.max(0, Number(opts?.appliedTotal ?? 0)));
  const remaining = roundMoney(target - applied);
  if (remaining <= 0) return null;
  return roundMoney(Math.min(amount, remaining));
}

export type ComputedLine = {
  componentId: string;
  componentCode: string;
  componentName: string;
  componentType: string;
  calculationMethod: string;
  amount: number;
  isEmployerContribution: boolean;
  sortOrder: number;
};

export type ComputedEmployeePay = {
  employeeId: string;
  lines: ComputedLine[];
  basicSalary: number;
  allowances: number;
  deductions: number;
  taxAmount: number;
  pensionEmployee: number;
  pensionEmployer: number;
  commissionAmount: number;
  netPay: number;
  /** Override ids whose one-time balance should be reduced by this amount */
  overrideConsumptions: { overrideId: string; amount: number }[];
  /** Accrued commission ids included in this compute (link on pay) */
  commissionIds: string[];
};

function parseElementCodes(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,;\s]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

/** Progressive tax on annual income using cumulative upper-limit brackets; returns monthly tax. */
export function progressiveMonthlyTax(
  monthlyTaxable: number,
  brackets: { upperLimit: number | null; rate: number }[]
): number {
  if (monthlyTaxable <= 0 || !brackets.length) return 0;
  const annual = monthlyTaxable * 12;
  const sorted = [...brackets].sort((a, b) => {
    if (a.upperLimit == null) return 1;
    if (b.upperLimit == null) return -1;
    return a.upperLimit - b.upperLimit;
  });

  let tax = 0;
  let prev = 0;
  for (const b of sorted) {
    const top = b.upperLimit == null ? Number.POSITIVE_INFINITY : Number(b.upperLimit);
    const slice = Math.max(0, Math.min(annual, top) - prev);
    if (slice > 0) tax += slice * (Number(b.rate) / 100);
    prev = top;
    if (annual <= top) break;
  }
  return roundMoney(tax / 12);
}

function sumCodes(
  codes: string[],
  amountsByCode: Map<string, number>,
  filter?: (code: string) => boolean
): number {
  let sum = 0;
  for (const code of codes) {
    if (filter && !filter(code)) continue;
    sum += amountsByCode.get(code) ?? 0;
  }
  return roundMoney(sum);
}

function baseFromKey(
  baseKey: string | null | undefined,
  amountsByCode: Map<string, number>,
  componentsByCode: Map<string, ComponentRow>,
  elementCodes: string[]
): number {
  const key = String(baseKey || '').toLowerCase();
  if (key === 'pensionable') {
    let sum = 0;
    for (const [code, amt] of amountsByCode) {
      const c = componentsByCode.get(code);
      if (c?.type === 'earning' && c.isPensionable) sum += amt;
    }
    return roundMoney(sum);
  }
  if (key === 'taxable') {
    let sum = 0;
    for (const [code, amt] of amountsByCode) {
      const c = componentsByCode.get(code);
      if (c?.type === 'earning' && c.isTaxable) sum += amt;
    }
    return roundMoney(sum);
  }
  if (key === 'gross') {
    let sum = 0;
    for (const [code, amt] of amountsByCode) {
      const c = componentsByCode.get(code);
      if (c?.type === 'earning') sum += amt;
    }
    return roundMoney(sum);
  }
  if (elementCodes.length) return sumCodes(elementCodes, amountsByCode);
  return 0;
}

/**
 * Resolve one employee's pay lines from components + chart/package/overrides + commissions.
 */
export function computeEmployeePay(input: {
  employeeId: string;
  baseSalary: number;
  includeSalesCommission: boolean;
  components: ComponentRow[];
  chartByComponentId: Map<string, number>;
  packageByComponentId: Map<string, number>;
  /** One or more active overrides per component (amounts summed when several apply). */
  overridesByComponentId: Map<string, OverrideAmount[]>;
  statutoryByKey: Map<string, StatutoryRuleRow>;
  commissionAmount: number;
  commissionIds: string[];
}): ComputedEmployeePay {
  const components = input.components
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const componentsByCode = new Map(components.map((c) => [c.code, c]));
  const amountsByCode = new Map<string, number>();
  const overrideConsumptions: { overrideId: string; amount: number }[] = [];
  const consumedOverrideIds = new Set<string>();

  const applyOverrides = (comp: ComponentRow): number | null => {
    const list = input.overridesByComponentId.get(comp.id);
    if (!list?.length) return null;
    let sum = 0;
    let any = false;
    for (const override of list) {
      const payable = resolveOverridePayable(override, {
        hasPriorApplication: Boolean(override.hasPriorApplication),
        appliedTotal: override.appliedTotal
      });
      if (payable == null || payable <= 0) continue;
      any = true;
      sum = roundMoney(sum + payable);
      // Ledger every payable (continuous + one-off), like school process overrides
      if (!consumedOverrideIds.has(override.overrideId)) {
        consumedOverrideIds.add(override.overrideId);
        overrideConsumptions.push({ overrideId: override.overrideId, amount: payable });
      }
    }
    return any ? sum : null;
  };

  const resolveFixed = (comp: ComponentRow): number => {
    const overridden = applyOverrides(comp);
    if (overridden != null) return overridden;
    if (input.packageByComponentId.has(comp.id)) {
      return roundMoney(Number(input.packageByComponentId.get(comp.id)));
    }
    if (input.chartByComponentId.has(comp.id)) {
      return roundMoney(Number(input.chartByComponentId.get(comp.id)));
    }
    if (comp.isPrimary) return roundMoney(input.baseSalary);
    return 0;
  };

  // Pass 1: fixed + sales_commission
  for (const comp of components) {
    if (comp.calculationMethod === 'fixed') {
      amountsByCode.set(comp.code, resolveFixed(comp));
    } else if (comp.calculationMethod === 'sales_commission') {
      const overridden = applyOverrides(comp);
      if (overridden != null) {
        amountsByCode.set(comp.code, overridden);
      } else if (input.includeSalesCommission) {
        amountsByCode.set(comp.code, roundMoney(input.commissionAmount));
      } else {
        amountsByCode.set(comp.code, 0);
      }
    }
  }

  // Pass 2+: dependent methods until stable
  const dependent = components.filter((c) =>
    ['percent_of_components', 'statutory_rate', 'progressive_tax'].includes(c.calculationMethod)
  );

  for (let pass = 0; pass < dependent.length + 2; pass++) {
    let changed = false;
    for (const comp of dependent) {
      const overridden = applyOverrides(comp);
      if (overridden != null) {
        if (amountsByCode.get(comp.code) !== overridden) {
          amountsByCode.set(comp.code, overridden);
          changed = true;
        }
        continue;
      }

      const elements = parseElementCodes(comp.functionElements);
      let next = 0;

      if (comp.calculationMethod === 'percent_of_components') {
        const pct = Number(comp.functionPercentage ?? 0);
        next = roundMoney(sumCodes(elements, amountsByCode) * (pct / 100));
      } else if (comp.calculationMethod === 'statutory_rate') {
        const rule = comp.statutoryKey
          ? input.statutoryByKey.get(comp.statutoryKey)
          : undefined;
        if (rule?.isActive) {
          const base = baseFromKey(rule.baseKey, amountsByCode, componentsByCode, elements);
          const rate = Number(rule.rate ?? 0);
          next = roundMoney(base * (rate / 100));
        }
      } else if (comp.calculationMethod === 'progressive_tax') {
        const rule = comp.statutoryKey
          ? input.statutoryByKey.get(comp.statutoryKey)
          : undefined;
        if (rule?.isActive) {
          const taxable =
            elements.length > 0
              ? sumCodes(elements, amountsByCode)
              : baseFromKey('taxable', amountsByCode, componentsByCode, []);
          // Non-taxable deductions that reduce PAYE base (optional future)
          next = progressiveMonthlyTax(taxable, rule.brackets);
        }
      }

      const prev = amountsByCode.get(comp.code);
      if (prev !== next) {
        amountsByCode.set(comp.code, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const lines: ComputedLine[] = components.map((comp) => {
    const amount = roundMoney(amountsByCode.get(comp.code) ?? 0);
    return {
      componentId: comp.id,
      componentCode: comp.code,
      componentName: comp.name,
      componentType: comp.type,
      calculationMethod: comp.calculationMethod,
      amount,
      isEmployerContribution: comp.type === 'employer_contribution',
      sortOrder: comp.sortOrder
    };
  });

  const earnings = lines.filter((l) => l.componentType === 'earning');
  const deductionLines = lines.filter((l) => l.componentType === 'deduction');
  const employerLines = lines.filter((l) => l.componentType === 'employer_contribution');

  const primary = lines.find(
    (l) => componentsByCode.get(l.componentCode)?.isPrimary
  );
  const basicSalary = roundMoney(primary?.amount ?? 0);
  const commissionLine = lines.find((l) => l.calculationMethod === 'sales_commission');
  const commissionAmount = roundMoney(commissionLine?.amount ?? 0);
  const grossEarnings = roundMoney(earnings.reduce((s, l) => s + l.amount, 0));
  const allowances = roundMoney(grossEarnings - basicSalary);
  const deductions = roundMoney(deductionLines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = roundMoney(
    lines.find((l) => l.componentCode === 'PAYE' || l.calculationMethod === 'progressive_tax')
      ?.amount ?? 0
  );
  const pensionEmployee = roundMoney(
    lines.find((l) => l.componentCode === 'PENSION_EE')?.amount ?? 0
  );
  const pensionEmployer = roundMoney(
    employerLines.find((l) => l.componentCode === 'PENSION_ER')?.amount ??
      employerLines.reduce((s, l) => s + l.amount, 0)
  );
  const netPay = roundMoney(grossEarnings - deductions);

  return {
    employeeId: input.employeeId,
    lines,
    basicSalary,
    allowances,
    deductions: roundMoney(deductions - taxAmount - pensionEmployee), // other deductions only (legacy field)
    taxAmount,
    pensionEmployee,
    pensionEmployer,
    commissionAmount,
    netPay,
    overrideConsumptions,
    commissionIds:
      commissionAmount > 0 && input.includeSalesCommission ? input.commissionIds : []
  };
}

/** Load config + per-employee inputs and compute pay for a set of employees. */
export async function computeEmployeesForPeriod(opts: {
  businessId: string;
  employees: {
    id: string;
    baseSalary: unknown;
    payGradeId: string | null;
    payStep: number | null;
    employmentType: string;
    includeSalesCommission: boolean;
    salesRepId: string | null;
  }[];
  periodStart: Date;
  periodEnd: Date;
  year?: number;
  month?: number;
  /** When true, only commissions created within the period; else all accrued unpaid */
  commissionPeriodOnly?: boolean;
}): Promise<ComputedEmployeePay[]> {
  const { businessId, employees, periodStart, periodEnd } = opts;
  if (!employees.length) return [];

  const year = opts.year ?? periodEnd.getFullYear();
  const month = opts.month ?? periodEnd.getMonth() + 1;

  const [componentsRaw, statutoryRaw, chartRows, packageRows, overrideRows] = await Promise.all([
    prisma.salaryComponent.findMany({
      where: { businessId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }]
    }),
    prisma.payrollStatutoryRule.findMany({
      where: { businessId },
      include: { brackets: { orderBy: { sortOrder: 'asc' } } }
    }),
    prisma.salaryChartEntry.findMany({
      where: { businessId, isActive: true }
    }),
    prisma.employeePayPackageLine.findMany({
      where: {
        businessId,
        isActive: true,
        employeeId: { in: employees.map((e) => e.id) }
      }
    }),
    prisma.employeePayOverride.findMany({
      where: {
        businessId,
        isActive: true,
        employeeId: { in: employees.map((e) => e.id) }
      }
    })
  ]);

  const components: ComponentRow[] = componentsRaw.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: c.type,
    calculationMethod: c.calculationMethod,
    isTaxable: c.isTaxable,
    isPensionable: c.isPensionable,
    isStatutory: c.isStatutory,
    isPrimary: c.isPrimary,
    functionElements: c.functionElements,
    functionPercentage: c.functionPercentage != null ? Number(c.functionPercentage) : null,
    statutoryKey: c.statutoryKey,
    sortOrder: c.sortOrder,
    isActive: c.isActive
  }));

  const statutoryByKey = new Map<string, StatutoryRuleRow>();
  for (const r of statutoryRaw) {
    statutoryByKey.set(r.key, {
      id: r.id,
      key: r.key,
      method: r.method,
      rate: r.rate != null ? Number(r.rate) : null,
      baseKey: r.baseKey,
      isActive: r.isActive,
      brackets: r.brackets.map((b) => ({
        sortOrder: b.sortOrder,
        upperLimit: b.upperLimit != null ? Number(b.upperLimit) : null,
        rate: Number(b.rate)
      }))
    });
  }

  const chartByEmpKey = new Map<string, Map<string, number>>();
  for (const emp of employees) {
    if (!emp.payGradeId || emp.payStep == null) continue;
    const key = `${emp.payGradeId}|${emp.payStep}|${emp.employmentType}`;
    if (chartByEmpKey.has(key)) continue;
    const map = new Map<string, number>();
    for (const row of chartRows) {
      if (
        row.payGradeId === emp.payGradeId &&
        row.step === emp.payStep &&
        row.employmentType === emp.employmentType
      ) {
        map.set(row.componentId, Number(row.amount));
      }
    }
    chartByEmpKey.set(key, map);
  }

  const packageByEmp = new Map<string, Map<string, number>>();
  for (const row of packageRows) {
    let m = packageByEmp.get(row.employeeId);
    if (!m) {
      m = new Map();
      packageByEmp.set(row.employeeId, m);
    }
    m.set(row.componentId, Number(row.amount));
  }

  // Prior-period application ledger (current year/month must already be cleared by caller)
  const overrideIds = overrideRows.map((r) => r.id);
  const priorApps =
    overrideIds.length > 0
      ? await prisma.employeePayOverrideApplication.findMany({
          where: {
            businessId,
            overrideId: { in: overrideIds },
            isActive: true,
            NOT: { AND: [{ year }, { month }] }
          },
          select: { overrideId: true, amount: true }
        })
      : [];
  const hasPriorApplication = new Set<string>();
  const appliedTotalByOverride = new Map<string, number>();
  for (const app of priorApps) {
    hasPriorApplication.add(app.overrideId);
    appliedTotalByOverride.set(
      app.overrideId,
      roundMoney((appliedTotalByOverride.get(app.overrideId) || 0) + Number(app.amount))
    );
  }

  // Multiple active overrides for the same component are summed (school parity).
  const overrideByEmp = new Map<string, Map<string, OverrideAmount[]>>();
  for (const row of overrideRows) {
    // Effective window vs pay period (not wall-clock)
    if (row.effectiveFrom && row.effectiveFrom > periodEnd) continue;
    if (row.effectiveTo && row.effectiveTo < periodStart) continue;
    let byComp = overrideByEmp.get(row.employeeId);
    if (!byComp) {
      byComp = new Map();
      overrideByEmp.set(row.employeeId, byComp);
    }
    const list = byComp.get(row.componentId) || [];
    list.push({
      componentId: row.componentId,
      amount: Number(row.amount),
      isContinuous: row.isContinuous,
      targetAmount: row.targetAmount != null ? Number(row.targetAmount) : null,
      balanceRemaining: row.balanceRemaining != null ? Number(row.balanceRemaining) : null,
      overrideId: row.id,
      hasPriorApplication: hasPriorApplication.has(row.id),
      appliedTotal: appliedTotalByOverride.get(row.id) || 0
    });
    byComp.set(row.componentId, list);
  }

  const salesRepIds = employees.map((e) => e.salesRepId).filter((id): id is string => Boolean(id));
  const commissions =
    salesRepIds.length > 0
      ? await prisma.salesCommission.findMany({
          where: {
            businessId,
            status: 'accrued',
            salesRepId: { in: salesRepIds },
            ...(opts.commissionPeriodOnly
              ? { createdAt: { gte: periodStart, lte: periodEnd } }
              : {})
          },
          select: { id: true, salesRepId: true, commissionAmount: true }
        })
      : [];

  const commissionsByRep = new Map<string, { ids: string[]; total: number }>();
  for (const c of commissions) {
    let bucket = commissionsByRep.get(c.salesRepId);
    if (!bucket) {
      bucket = { ids: [], total: 0 };
      commissionsByRep.set(c.salesRepId, bucket);
    }
    bucket.ids.push(c.id);
    bucket.total = roundMoney(bucket.total + Number(c.commissionAmount));
  }

  return employees.map((emp) => {
    const chartKey =
      emp.payGradeId && emp.payStep != null
        ? `${emp.payGradeId}|${emp.payStep}|${emp.employmentType}`
        : null;
    const commission = emp.salesRepId ? commissionsByRep.get(emp.salesRepId) : undefined;

    return computeEmployeePay({
      employeeId: emp.id,
      baseSalary: Number(emp.baseSalary ?? 0),
      includeSalesCommission: emp.includeSalesCommission,
      components,
      chartByComponentId: chartKey ? chartByEmpKey.get(chartKey) ?? new Map() : new Map(),
      packageByComponentId: packageByEmp.get(emp.id) ?? new Map(),
      overridesByComponentId: overrideByEmp.get(emp.id) ?? new Map(),
      statutoryByKey,
      commissionAmount: commission?.total ?? 0,
      commissionIds: commission?.ids ?? []
    });
  });
}
