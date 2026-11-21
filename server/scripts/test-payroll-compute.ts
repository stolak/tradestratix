/**
 * Smoke test for payroll compute engine (progressive tax + component resolution).
 * Run: npx tsx scripts/test-payroll-compute.ts
 */
import {
  computeEmployeePay,
  progressiveMonthlyTax,
  type ComponentRow,
  type StatutoryRuleRow
} from '../src/services/payroll-compute.service.js';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const components: ComponentRow[] = [
  {
    id: '1',
    code: 'BASIC',
    name: 'Basic',
    type: 'earning',
    calculationMethod: 'fixed',
    isTaxable: true,
    isPensionable: true,
    isStatutory: false,
    isPrimary: true,
    functionElements: null,
    functionPercentage: null,
    statutoryKey: null,
    sortOrder: 10,
    isActive: true
  },
  {
    id: '2',
    code: 'HOUSING',
    name: 'Housing',
    type: 'earning',
    calculationMethod: 'fixed',
    isTaxable: true,
    isPensionable: true,
    isStatutory: false,
    isPrimary: false,
    functionElements: null,
    functionPercentage: null,
    statutoryKey: null,
    sortOrder: 20,
    isActive: true
  },
  {
    id: '3',
    code: 'SALES_COMMISSION',
    name: 'Commission',
    type: 'earning',
    calculationMethod: 'sales_commission',
    isTaxable: true,
    isPensionable: false,
    isStatutory: false,
    isPrimary: false,
    functionElements: null,
    functionPercentage: null,
    statutoryKey: null,
    sortOrder: 40,
    isActive: true
  },
  {
    id: '4',
    code: 'PAYE',
    name: 'PAYE',
    type: 'deduction',
    calculationMethod: 'progressive_tax',
    isTaxable: false,
    isPensionable: false,
    isStatutory: true,
    isPrimary: false,
    functionElements: ['BASIC', 'HOUSING', 'SALES_COMMISSION'],
    functionPercentage: null,
    statutoryKey: 'paye',
    sortOrder: 100,
    isActive: true
  },
  {
    id: '5',
    code: 'PENSION_EE',
    name: 'Pension EE',
    type: 'deduction',
    calculationMethod: 'statutory_rate',
    isTaxable: false,
    isPensionable: false,
    isStatutory: true,
    isPrimary: false,
    functionElements: ['BASIC', 'HOUSING'],
    functionPercentage: null,
    statutoryKey: 'pension_employee',
    sortOrder: 110,
    isActive: true
  },
  {
    id: '6',
    code: 'PENSION_ER',
    name: 'Pension ER',
    type: 'employer_contribution',
    calculationMethod: 'statutory_rate',
    isTaxable: false,
    isPensionable: false,
    isStatutory: true,
    isPrimary: false,
    functionElements: ['BASIC', 'HOUSING'],
    functionPercentage: null,
    statutoryKey: 'pension_employer',
    sortOrder: 120,
    isActive: true
  }
];

const statutoryByKey = new Map<string, StatutoryRuleRow>([
  [
    'paye',
    {
      id: 'r1',
      key: 'paye',
      method: 'progressive_brackets',
      rate: null,
      baseKey: 'taxable',
      isActive: true,
      brackets: [
        { sortOrder: 0, upperLimit: 300_000, rate: 7 },
        { sortOrder: 1, upperLimit: 600_000, rate: 11 },
        { sortOrder: 2, upperLimit: 1_100_000, rate: 15 },
        { sortOrder: 3, upperLimit: 1_600_000, rate: 19 },
        { sortOrder: 4, upperLimit: 3_200_000, rate: 21 },
        { sortOrder: 5, upperLimit: null, rate: 24 }
      ]
    }
  ],
  [
    'pension_employee',
    {
      id: 'r2',
      key: 'pension_employee',
      method: 'flat_rate',
      rate: 8,
      baseKey: 'pensionable',
      isActive: true,
      brackets: []
    }
  ],
  [
    'pension_employer',
    {
      id: 'r3',
      key: 'pension_employer',
      method: 'flat_rate',
      rate: 10,
      baseKey: 'pensionable',
      isActive: true,
      brackets: []
    }
  ]
]);

const tax = progressiveMonthlyTax(500_000, statutoryByKey.get('paye')!.brackets);
assert(tax > 0, 'progressive tax should be > 0 for 500k monthly');
console.log('progressive monthly tax @ 500k =', tax);

const result = computeEmployeePay({
  employeeId: 'emp1',
  baseSalary: 200_000,
  includeSalesCommission: true,
  components,
  chartByComponentId: new Map([
    ['1', 250_000],
    ['2', 50_000]
  ]),
  packageByComponentId: new Map(),
  overridesByComponentId: new Map(),
  statutoryByKey,
  commissionAmount: 25_000,
  commissionIds: ['c1']
});

assert(result.basicSalary === 250_000, `basic expected 250000 got ${result.basicSalary}`);
assert(result.commissionAmount === 25_000, `commission expected 25000 got ${result.commissionAmount}`);
assert(result.pensionEmployee === 24_000, `pension EE 8% of 300k = 24000 got ${result.pensionEmployee}`);
assert(result.pensionEmployer === 30_000, `pension ER 10% of 300k = 30000 got ${result.pensionEmployer}`);
assert(result.taxAmount > 0, 'PAYE should be positive');
assert(result.allowances === 75_000, `allowances expected 75000 got ${result.allowances}`);
const expectedNet = Math.round((325_000 - result.taxAmount - result.pensionEmployee) * 100) / 100;
assert(
  result.netPay === expectedNet,
  `net mismatch got ${result.netPay} expected ${expectedNet} tax=${result.taxAmount}`
);
assert(result.lines.length === 6, 'expected 6 lines');
assert(result.commissionIds.includes('c1'), 'commission ids should be kept');

console.log('OK computeEmployeePay', {
  basic: result.basicSalary,
  allowances: result.allowances,
  commission: result.commissionAmount,
  tax: result.taxAmount,
  pensionEE: result.pensionEmployee,
  pensionER: result.pensionEmployer,
  net: result.netPay
});
