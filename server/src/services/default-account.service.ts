import { prisma } from '../utils/prisma.js';
import { httpError, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export type DefaultAccountKeyMeta = {
  key: string;
  label: string;
  description: string;
  /** Expected account types for validation */
  accountTypes: string[];
  category: string;
};

/** Canonical default-account setting keys used across posting workflows. */
export const DEFAULT_ACCOUNT_CATALOG: DefaultAccountKeyMeta[] = [
  // Customer
  {
    key: 'accounts_receivable',
    label: 'Accounts Receivable',
    description: 'Control account for customer receivables',
    accountTypes: ['asset'],
    category: 'customer'
  },
  {
    key: 'customer_advances',
    label: 'Customer Advances',
    description:
      'Legacy liability mapping (unused). Customer advances now credit Accounts Receivable.',
    accountTypes: ['liability'],
    category: 'customer'
  },
  {
    key: 'customer_deposits',
    label: 'Customer Deposits',
    description:
      'Legacy liability mapping (unused). Deposits / prepaid orders credit Accounts Receivable.',
    accountTypes: ['liability'],
    category: 'customer'
  },
  {
    key: 'unapplied_customer_receipts',
    label: 'Unapplied Customer Receipts',
    description:
      'Legacy clearing mapping (unused). Surplus receipts stay on Accounts Receivable as customer credit.',
    accountTypes: ['liability'],
    category: 'customer'
  },
  // Supplier
  {
    key: 'accounts_payable',
    label: 'Accounts Payable',
    description: 'Control account for supplier payables',
    accountTypes: ['liability'],
    category: 'supplier'
  },
  {
    key: 'supplier_advances',
    label: 'Supplier Advances',
    description: 'Asset for advances paid to suppliers',
    accountTypes: ['asset'],
    category: 'supplier'
  },
  {
    key: 'supplier_deposits',
    label: 'Supplier Deposits',
    description: 'Asset for deposits with suppliers',
    accountTypes: ['asset'],
    category: 'supplier'
  },
  {
    key: 'grni',
    label: 'Goods Received Not Invoiced',
    description: 'Clearing for receipts awaiting supplier invoice',
    accountTypes: ['liability'],
    category: 'supplier'
  },
  // Sales / revenue
  {
    key: 'sales_revenue',
    label: 'Sales Revenue',
    description: 'Primary sales revenue account',
    accountTypes: ['revenue'],
    category: 'sales'
  },
  {
    key: 'sales_returns',
    label: 'Sales Returns',
    description: 'Contra-revenue for returns and credit notes',
    accountTypes: ['revenue'],
    category: 'sales'
  },
  {
    key: 'sales_discounts',
    label: 'Sales Discounts',
    description: 'Contra-revenue or expense for discounts given',
    accountTypes: ['revenue', 'expense'],
    category: 'sales'
  },
  {
    key: 'tax_payable',
    label: 'Sales / VAT Tax Payable',
    description: 'Tax collected on sales',
    accountTypes: ['liability'],
    category: 'sales'
  },
  // Cash / banking
  {
    key: 'cash',
    label: 'Cash on Hand',
    description: 'Petty / till cash',
    accountTypes: ['asset'],
    category: 'cash'
  },
  {
    key: 'bank',
    label: 'Bank Account',
    description: 'Primary operating bank account',
    accountTypes: ['asset'],
    category: 'cash'
  },
  {
    key: 'petty_cash',
    label: 'Petty Cash',
    description: 'Petty cash float',
    accountTypes: ['asset'],
    category: 'cash'
  },
  {
    key: 'cash_in_custody_sales_rep',
    label: 'Cash in Custody — Sales Reps',
    description: 'Cash held by sales representatives',
    accountTypes: ['asset'],
    category: 'sales_rep'
  },
  {
    key: 'cash_in_transit',
    label: 'Cash in Transit',
    description: 'Cash moving between locations or to bank',
    accountTypes: ['asset'],
    category: 'cash'
  },
  {
    key: 'payment_clearing',
    label: 'Payment Clearing',
    description: 'Temporary clearing for card / transfer receipts',
    accountTypes: ['asset', 'liability'],
    category: 'cash'
  },
  // Inventory
  {
    key: 'inventory',
    label: 'Inventory Asset',
    description: 'Stock on hand at cost',
    accountTypes: ['asset'],
    category: 'inventory'
  },
  {
    key: 'cogs',
    label: 'Cost of Goods Sold',
    description: 'Cost of inventory sold',
    accountTypes: ['cogs'],
    category: 'inventory'
  },
  {
    key: 'purchase_returns',
    label: 'Purchase Returns',
    description: 'Contra / clearing for purchase returns',
    accountTypes: ['liability', 'expense'],
    category: 'inventory'
  },
  {
    key: 'inventory_adjustment',
    label: 'Inventory Adjustment',
    description: 'Gains/losses from stock counts',
    accountTypes: ['expense', 'revenue'],
    category: 'inventory'
  },
  {
    key: 'inventory_write_off',
    label: 'Inventory Write-off',
    description: 'Loss from damaged / expired stock',
    accountTypes: ['expense'],
    category: 'inventory'
  },
  {
    key: 'inter_branch_clearing',
    label: 'Inter-branch Clearing',
    description:
      'Due to / due from between branches, e.g. goods sold in one branch and collected from another',
    accountTypes: ['asset', 'liability'],
    category: 'inventory'
  },
  // Sales reps
  {
    key: 'sales_rep_commission_expense',
    label: 'Sales Rep Commission Expense',
    description: 'Commission expense for representatives',
    accountTypes: ['expense'],
    category: 'sales_rep'
  },
  {
    key: 'sales_rep_commission_payable',
    label: 'Sales Rep Commission Payable',
    description: 'Accrued commissions owed to representatives',
    accountTypes: ['liability'],
    category: 'sales_rep'
  },
  {
    key: 'sales_rep_receivable',
    label: 'Sales Rep Recoveries / Receivable',
    description: 'Amounts recoverable from representatives',
    accountTypes: ['asset'],
    category: 'sales_rep'
  },
  // Other ops (existing keys retained)
  {
    key: 'fixed_assets',
    label: 'Fixed Assets',
    description: 'PPE / fixed asset control',
    accountTypes: ['asset'],
    category: 'assets'
  },
  {
    key: 'accumulated_depreciation',
    label: 'Accumulated Depreciation',
    description: 'Contra-asset for depreciation',
    accountTypes: ['asset'],
    category: 'assets'
  },
  {
    key: 'depreciation_expense',
    label: 'Depreciation Expense',
    description: 'Periodic depreciation expense',
    accountTypes: ['expense'],
    category: 'assets'
  },
  {
    key: 'salary_expense',
    label: 'Salary Expense',
    description: 'Payroll gross salary expense',
    accountTypes: ['expense'],
    category: 'payroll'
  },
  {
    key: 'salary_payable',
    label: 'Salary Payable',
    description: 'Net pay liability',
    accountTypes: ['liability'],
    category: 'payroll'
  },
  {
    key: 'paye_payable',
    label: 'PAYE Payable',
    description: 'Payroll tax liability',
    accountTypes: ['liability'],
    category: 'payroll'
  },
  {
    key: 'pension_payable',
    label: 'Pension Payable',
    description: 'Pension contribution liability',
    accountTypes: ['liability'],
    category: 'payroll'
  },
  {
    key: 'expense',
    label: 'General Expense',
    description: 'Default operating expense account',
    accountTypes: ['expense'],
    category: 'expenses'
  },
  {
    key: 'rent_expense',
    label: 'Rent Expense',
    description: 'Facility rent',
    accountTypes: ['expense'],
    category: 'expenses'
  },
  {
    key: 'equity',
    label: 'Owner Equity',
    description: 'Owner capital / equity',
    accountTypes: ['equity'],
    category: 'equity'
  },
  {
    key: 'retained_earnings',
    label: 'Retained Earnings',
    description: 'Accumulated earnings',
    accountTypes: ['equity'],
    category: 'equity'
  }
];

const CATALOG_BY_KEY = new Map(DEFAULT_ACCOUNT_CATALOG.map((k) => [k.key, k]));

export function listDefaultAccountCatalog() {
  return DEFAULT_ACCOUNT_CATALOG;
}

export async function getDefaultAccountMap(businessId: string): Promise<Record<string, string>> {
  const settings = await prisma.defaultAccountSetting.findMany({ where: { businessId } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.settingKey] = s.accountId;
  return map;
}

/**
 * Resolve required default accounts for a business.
 * Validates ownership, active status, and expected account classification.
 */
export async function resolveDefaultAccounts(
  businessId: string,
  requiredKeys: string[]
): Promise<Record<string, { accountId: string; code: string; name: string; accountType: string }>> {
  const uniqueKeys = [...new Set(requiredKeys.filter(Boolean))];
  if (!uniqueKeys.length) return {};

  const settings = await prisma.defaultAccountSetting.findMany({
    where: { businessId, settingKey: { in: uniqueKeys } },
    include: { account: true }
  });
  const byKey = new Map(settings.map((s) => [s.settingKey, s]));

  const missing: string[] = [];
  const invalid: string[] = [];
  const out: Record<
    string,
    { accountId: string; code: string; name: string; accountType: string }
  > = {};

  for (const key of uniqueKeys) {
    const setting = byKey.get(key);
    if (!setting) {
      missing.push(key);
      continue;
    }
    const account = setting.account;
    if (!account || account.businessId !== businessId) {
      invalid.push(`${key} (wrong business)`);
      continue;
    }
    if (!account.isActive) {
      invalid.push(`${key} (account ${account.code} inactive)`);
      continue;
    }
    const meta = CATALOG_BY_KEY.get(key);
    if (meta && !meta.accountTypes.includes(account.accountType)) {
      invalid.push(
        `${key} expects [${meta.accountTypes.join('|')}] but ${account.code} is ${account.accountType}`
      );
      continue;
    }
    out[key] = {
      accountId: account.id,
      code: account.code,
      name: account.name,
      accountType: account.accountType
    };
  }

  if (missing.length || invalid.length) {
    const parts = [
      missing.length ? `Missing mappings: ${missing.join(', ')}` : null,
      invalid.length ? `Invalid mappings: ${invalid.join('; ')}` : null
    ].filter(Boolean);
    throw httpError(400, `Default account configuration incomplete. ${parts.join('. ')}`);
  }

  return out;
}

/** Convenience: return accountId map for required keys (throws if incomplete). */
export async function requireDefaultAccountIds(
  businessId: string,
  requiredKeys: string[]
): Promise<Record<string, string>> {
  const resolved = await resolveDefaultAccounts(businessId, requiredKeys);
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolved)) map[k] = v.accountId;
  return map;
}

export async function listDefaultAccountSettingsStatus(businessId: string) {
  const settings = await prisma.defaultAccountSetting.findMany({
    where: { businessId },
    include: { account: true }
  });
  const byKey = new Map(settings.map((s) => [s.settingKey, s]));

  const rows = DEFAULT_ACCOUNT_CATALOG.map((meta) => {
    const setting = byKey.get(meta.key);
    if (!setting) {
      return {
        ...meta,
        status: 'missing' as const,
        account: null,
        setting_id: null,
        mapped_description: null
      };
    }
    const account = setting.account;
    let status: 'valid' | 'inactive' | 'wrong_type' | 'invalid' = 'valid';
    if (!account || account.businessId !== businessId) status = 'invalid';
    else if (!account.isActive) status = 'inactive';
    else if (!meta.accountTypes.includes(account.accountType)) status = 'wrong_type';

    return {
      ...meta,
      status,
      setting_id: setting.id,
      mapped_description: setting.description,
      account: account
        ? {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.accountType,
            is_active: account.isActive
          }
        : null
    };
  });

  // Include any custom keys not in catalog
  for (const setting of settings) {
    if (CATALOG_BY_KEY.has(setting.settingKey)) continue;
    const account = setting.account;
    rows.push({
      key: setting.settingKey,
      label: setting.settingKey,
      description: setting.description || 'Custom mapping',
      accountTypes: account ? [account.accountType] : [],
      category: 'custom',
      status: !account ? 'invalid' : !account.isActive ? 'inactive' : 'valid',
      setting_id: setting.id,
      mapped_description: setting.description,
      account: account
        ? {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.accountType,
            is_active: account.isActive
          }
        : null
    } as any);
  }

  return serialize(rows);
}

export async function upsertDefaultAccountSetting(
  user: AuthUser,
  body: Record<string, any>
) {
  const settingKey = String(body.setting_key || body.settingKey || '').trim();
  const accountId = String(body.account_id || body.accountId || '').trim();
  if (!settingKey) throw httpError(400, 'setting_key is required');
  if (!accountId) throw httpError(400, 'account_id is required');

  const account = await prisma.account.findFirst({
    where: { id: accountId, businessId: user.businessId }
  });
  if (!account) throw httpError(400, 'Account not found for this business');
  if (!account.isActive) throw httpError(400, 'Cannot map an inactive account');

  const meta = CATALOG_BY_KEY.get(settingKey);
  if (meta && !meta.accountTypes.includes(account.accountType)) {
    throw httpError(
      400,
      `Account type ${account.accountType} is not valid for ${settingKey} (expected ${meta.accountTypes.join(', ')})`
    );
  }

  const description =
    body.description !== undefined
      ? body.description || null
      : meta?.description || null;

  const row = await prisma.defaultAccountSetting.upsert({
    where: {
      businessId_settingKey: { businessId: user.businessId, settingKey }
    },
    create: {
      id: shortId('das'),
      businessId: user.businessId,
      settingKey,
      accountId,
      description
    },
    update: { accountId, description },
    include: { account: true }
  });

  await writeAudit({
    user,
    action: 'upsert',
    module: 'accounting',
    entityType: 'DefaultAccountSetting',
    entityId: row.id,
    summary: `Mapped ${settingKey} → ${account.code}`
  });

  return serialize(row);
}
