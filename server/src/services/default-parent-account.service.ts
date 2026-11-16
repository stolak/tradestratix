import { prisma } from '../utils/prisma.js';
import { httpError, serialize, shortId } from '../utils/helpers.js';
import type { AuthUser } from '../types/express/index.js';
import { writeAudit } from './audit.service.js';

export type DefaultParentAccountKeyMeta = {
  key: string;
  label: string;
  description: string;
  /** Expected parent account types for validation */
  accountTypes: string[];
  category: string;
  /** Include the mapped parent itself in filtered picker lists */
  includeParent?: boolean;
};

/**
 * Operation keys that scope ledger pickers to a CoA subtree.
 * Map each key to a parent account so UIs fetch only relevant ledgers.
 */
export const DEFAULT_PARENT_ACCOUNT_CATALOG: DefaultParentAccountKeyMeta[] = [
  {
    key: 'cash_ledgers',
    label: 'Cash ledgers',
    description: 'Parent for cash / till / petty-cash account pickers',
    accountTypes: ['asset'],
    category: 'cash',
    includeParent: false
  },
  {
    key: 'bank_ledgers',
    label: 'Bank ledgers',
    description: 'Parent for bank account pickers on receipts and payments',
    accountTypes: ['asset'],
    category: 'cash',
    includeParent: false
  },
  {
    key: 'receivable_ledgers',
    label: 'Receivable ledgers',
    description: 'Parent for AR / customer control account pickers',
    accountTypes: ['asset'],
    category: 'customer',
    includeParent: false
  },
  {
    key: 'payable_ledgers',
    label: 'Payable ledgers',
    description: 'Parent for AP / supplier control account pickers',
    accountTypes: ['liability'],
    category: 'supplier',
    includeParent: false
  },
  {
    key: 'inventory_ledgers',
    label: 'Inventory ledgers',
    description: 'Parent for stock / inventory asset pickers',
    accountTypes: ['asset'],
    category: 'inventory',
    includeParent: false
  },
  {
    key: 'fixed_asset_ledgers',
    label: 'Fixed asset ledgers',
    description: 'Parent for PPE / fixed-asset pickers',
    accountTypes: ['asset'],
    category: 'assets',
    includeParent: false
  },
  {
    key: 'revenue_ledgers',
    label: 'Revenue ledgers',
    description: 'Parent for sales / revenue account pickers',
    accountTypes: ['revenue'],
    category: 'sales',
    includeParent: false
  },
  {
    key: 'cogs_ledgers',
    label: 'COGS ledgers',
    description: 'Parent for cost-of-goods account pickers',
    accountTypes: ['cogs'],
    category: 'inventory',
    includeParent: false
  },
  {
    key: 'expense_ledgers',
    label: 'Expense ledgers',
    description: 'Parent for operating expense account pickers',
    accountTypes: ['expense'],
    category: 'expenses',
    includeParent: false
  },
  {
    key: 'liability_ledgers',
    label: 'Liability ledgers',
    description: 'Parent for general liability account pickers',
    accountTypes: ['liability'],
    category: 'supplier',
    includeParent: false
  },
  {
    key: 'equity_ledgers',
    label: 'Equity ledgers',
    description: 'Parent for equity account pickers',
    accountTypes: ['equity'],
    category: 'equity',
    includeParent: false
  },
  {
    key: 'payroll_expense_ledgers',
    label: 'Payroll expense ledgers',
    description: 'Parent for salary / payroll expense pickers',
    accountTypes: ['expense'],
    category: 'payroll',
    includeParent: false
  },
  {
    key: 'payroll_liability_ledgers',
    label: 'Payroll liability ledgers',
    description: 'Parent for PAYE / pension / salary payable pickers',
    accountTypes: ['liability'],
    category: 'payroll',
    includeParent: false
  },
  {
    key: 'journal_line_ledgers',
    label: 'Manual journal ledgers',
    description:
      'Optional parent that limits accounts shown when creating manual journal lines. Leave unmapped to show the full chart.',
    accountTypes: ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'],
    category: 'journals',
    includeParent: false
  }
];

const CATALOG_BY_KEY = new Map(DEFAULT_PARENT_ACCOUNT_CATALOG.map((k) => [k.key, k]));

/** Suggested CoA codes used when seeding parent filters for a fresh business. */
export const DEFAULT_PARENT_SEED_CODES: Record<string, string> = {
  cash_ledgers: '1100',
  bank_ledgers: '1100',
  receivable_ledgers: '1100',
  payable_ledgers: '2000',
  inventory_ledgers: '1100',
  fixed_asset_ledgers: '1200',
  revenue_ledgers: '4000',
  cogs_ledgers: '5000',
  expense_ledgers: '6000',
  liability_ledgers: '2000',
  equity_ledgers: '3000',
  payroll_expense_ledgers: '6000',
  payroll_liability_ledgers: '2000'
};

export function listDefaultParentAccountCatalog() {
  return DEFAULT_PARENT_ACCOUNT_CATALOG;
}

export async function getDefaultParentAccountMap(
  businessId: string
): Promise<Record<string, string>> {
  const settings = await prisma.defaultParentAccountSetting.findMany({ where: { businessId } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.settingKey] = s.parentAccountId;
  return map;
}

/** Collect account ids in the subtree rooted at `rootId` (BFS). */
export async function collectAccountSubtreeIds(
  businessId: string,
  rootId: string
): Promise<{ ids: Set<string>; childCount: Map<string, number> }> {
  const all = await prisma.account.findMany({
    where: { businessId },
    select: { id: true, parentId: true }
  });
  const childrenByParent = new Map<string, string[]>();
  const childCount = new Map<string, number>();
  for (const a of all) {
    if (!a.parentId) continue;
    const list = childrenByParent.get(a.parentId) || [];
    list.push(a.id);
    childrenByParent.set(a.parentId, list);
  }
  for (const [parent, kids] of childrenByParent) childCount.set(parent, kids.length);

  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of childrenByParent.get(id) || []) queue.push(child);
  }
  return { ids, childCount };
}

/**
 * List ledgers scoped by a parent-account setting key.
 * If unmapped: falls back to active accounts matching the catalog account types
 * (or the full chart when the key allows every type).
 */
export async function listAccountsForParentSetting(
  businessId: string,
  settingKey: string,
  opts?: { includeInactive?: boolean; postableOnly?: boolean }
) {
  const meta = CATALOG_BY_KEY.get(settingKey);
  const setting = await prisma.defaultParentAccountSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey } },
    include: { parentAccount: true }
  });

  const includeInactive = Boolean(opts?.includeInactive);
  const postableOnly = opts?.postableOnly !== false;

  let accounts = await prisma.account.findMany({
    where: {
      businessId,
      ...(includeInactive ? {} : { isActive: true })
    },
    orderBy: { code: 'asc' }
  });

  if (setting?.parentAccountId) {
    const { ids, childCount } = await collectAccountSubtreeIds(
      businessId,
      setting.parentAccountId
    );
    const includeParent = meta?.includeParent ?? false;
    accounts = accounts.filter((a) => {
      if (!ids.has(a.id)) return false;
      if (!includeParent && a.id === setting.parentAccountId && (childCount.get(a.id) || 0) > 0) {
        return false;
      }
      if (postableOnly && (childCount.get(a.id) || 0) > 0) return false;
      return true;
    });
  } else if (meta?.accountTypes?.length) {
    const allowAll =
      meta.accountTypes.length >= 6 &&
      ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'].every((t) =>
        meta.accountTypes.includes(t)
      );
    if (!allowAll) {
      accounts = accounts.filter((a) => meta.accountTypes.includes(a.accountType));
    }
    if (postableOnly) {
      const all = await prisma.account.findMany({
        where: { businessId },
        select: { id: true, parentId: true }
      });
      const counts = new Map<string, number>();
      for (const a of all) {
        if (!a.parentId) continue;
        counts.set(a.parentId, (counts.get(a.parentId) || 0) + 1);
      }
      accounts = accounts.filter((a) => (counts.get(a.id) || 0) === 0);
    }
  }

  return serialize(accounts);
}

export async function listDefaultParentAccountSettings(businessId: string) {
  const rows = await prisma.defaultParentAccountSetting.findMany({
    where: { businessId },
    include: { parentAccount: true },
    orderBy: { settingKey: 'asc' }
  });
  return serialize(rows);
}

export async function listDefaultParentAccountSettingsStatus(businessId: string) {
  const settings = await prisma.defaultParentAccountSetting.findMany({
    where: { businessId },
    include: { parentAccount: true }
  });
  const byKey = new Map(settings.map((s) => [s.settingKey, s]));

  const rows = DEFAULT_PARENT_ACCOUNT_CATALOG.map((meta) => {
    const setting = byKey.get(meta.key);
    if (!setting) {
      return {
        ...meta,
        status: 'missing' as const,
        parent_account: null,
        setting_id: null,
        mapped_description: null
      };
    }
    const account = setting.parentAccount;
    let status: 'valid' | 'inactive' | 'wrong_type' | 'invalid' = 'valid';
    if (!account || account.businessId !== businessId) status = 'invalid';
    else if (!account.isActive) status = 'inactive';
    else if (!meta.accountTypes.includes(account.accountType)) status = 'wrong_type';

    return {
      ...meta,
      status,
      setting_id: setting.id,
      mapped_description: setting.description,
      parent_account: account
        ? {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.accountType,
            is_active: account.isActive,
            parent_id: account.parentId
          }
        : null
    };
  });

  for (const setting of settings) {
    if (CATALOG_BY_KEY.has(setting.settingKey)) continue;
    const account = setting.parentAccount;
    rows.push({
      key: setting.settingKey,
      label: setting.settingKey,
      description: setting.description || 'Custom ledger filter',
      accountTypes: account ? [account.accountType] : [],
      category: 'custom',
      status: !account ? 'invalid' : !account.isActive ? 'inactive' : 'valid',
      setting_id: setting.id,
      mapped_description: setting.description,
      parent_account: account
        ? {
            id: account.id,
            code: account.code,
            name: account.name,
            account_type: account.accountType,
            is_active: account.isActive,
            parent_id: account.parentId
          }
        : null
    } as any);
  }

  return serialize(rows);
}

export async function upsertDefaultParentAccountSetting(
  user: AuthUser,
  body: Record<string, any>
) {
  const settingKey = String(body.setting_key || body.settingKey || '').trim();
  const parentAccountId = String(
    body.parent_account_id || body.parentAccountId || body.account_id || body.accountId || ''
  ).trim();
  if (!settingKey) throw httpError(400, 'setting_key is required');
  if (!parentAccountId) throw httpError(400, 'parent_account_id is required');

  const account = await prisma.account.findFirst({
    where: { id: parentAccountId, businessId: user.businessId }
  });
  if (!account) throw httpError(400, 'Parent account not found for this business');
  if (!account.isActive) throw httpError(400, 'Cannot map an inactive parent account');

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

  const row = await prisma.defaultParentAccountSetting.upsert({
    where: {
      businessId_settingKey: { businessId: user.businessId, settingKey }
    },
    create: {
      id: shortId('dpas'),
      businessId: user.businessId,
      settingKey,
      parentAccountId,
      description
    },
    update: { parentAccountId, description },
    include: { parentAccount: true }
  });

  await writeAudit({
    user,
    action: 'upsert',
    module: 'accounting',
    entityType: 'DefaultParentAccountSetting',
    entityId: row.id,
    summary: `Mapped ledger filter ${settingKey} → ${account.code}`,
    before: undefined,
    after: {
      setting_key: settingKey,
      parent_account_id: parentAccountId,
      parent_code: account.code
    }
  });

  return serialize(row);
}

export async function clearDefaultParentAccountSetting(user: AuthUser, settingKey: string) {
  const key = String(settingKey || '').trim();
  if (!key) throw httpError(400, 'setting_key is required');

  const existing = await prisma.defaultParentAccountSetting.findUnique({
    where: { businessId_settingKey: { businessId: user.businessId, settingKey: key } }
  });
  if (!existing) throw httpError(404, 'Parent account setting not found');

  await prisma.defaultParentAccountSetting.delete({ where: { id: existing.id } });

  await writeAudit({
    user,
    action: 'delete',
    module: 'accounting',
    entityType: 'DefaultParentAccountSetting',
    entityId: existing.id,
    summary: `Cleared ledger filter ${key}`
  });

  return { ok: true, setting_key: key };
}
