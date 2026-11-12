import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function id(prefix: string) {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

const MODULES = [
  'dashboard',
  'sales',
  'pos',
  'purchases',
  'products',
  'inventory',
  'warehouses',
  'suppliers',
  'customers',
  'sales_reps',
  'distribution',
  'accounting',
  'banking',
  'expenses',
  'assets',
  'hr',
  'payroll',
  'reports',
  'notifications',
  'settings',
  'users',
  'roles',
  'branches',
  'audit'
];

const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'post',
  'reverse',
  'export',
  'print'
];

const SYSTEM_ROLES = [
  { code: 'business_owner', name: 'Business Owner', sortOrder: 1 },
  { code: 'managing_director', name: 'Managing Director', sortOrder: 2 },
  { code: 'general_manager', name: 'General Manager', sortOrder: 3 },
  { code: 'branch_manager', name: 'Branch Manager', sortOrder: 4 },
  { code: 'warehouse_manager', name: 'Warehouse Manager', sortOrder: 5 },
  { code: 'inventory_officer', name: 'Inventory Officer', sortOrder: 6 },
  { code: 'procurement_officer', name: 'Procurement Officer', sortOrder: 7 },
  { code: 'sales_manager', name: 'Sales Manager', sortOrder: 8 },
  { code: 'sales_representative', name: 'Sales Representative', sortOrder: 9 },
  { code: 'cashier', name: 'Cashier', sortOrder: 10 },
  { code: 'accountant', name: 'Accountant', sortOrder: 11 },
  { code: 'finance_manager', name: 'Finance Manager', sortOrder: 12 },
  { code: 'hr_manager', name: 'HR Manager', sortOrder: 13 },
  { code: 'payroll_officer', name: 'Payroll Officer', sortOrder: 14 },
  { code: 'auditor', name: 'Auditor', sortOrder: 15 },
  { code: 'delivery_officer', name: 'Delivery Officer', sortOrder: 16 }
];

const MENUS = [
  { code: 'dashboard', name: 'Dashboard', route: 'dashboard', section: 'Overview', sortOrder: 1, icon: 'LayoutDashboard' },
  { code: 'sales', name: 'Sales', route: 'sales', section: 'Commerce', sortOrder: 10, icon: 'ShoppingCart' },
  { code: 'pos', name: 'POS', route: 'pos', section: 'Commerce', sortOrder: 11, icon: 'Monitor' },
  { code: 'pickups', name: 'Pickups', route: 'pickups', section: 'Commerce', sortOrder: 13, icon: 'PackageCheck' },
  { code: 'purchases', name: 'Purchases', route: 'purchases', section: 'Commerce', sortOrder: 12, icon: 'Truck' },
  { code: 'products', name: 'Products', route: 'products', section: 'Inventory', sortOrder: 20, icon: 'Package' },
  { code: 'branch_pricing', name: 'Branch Pricing', route: 'branch_pricing', section: 'Inventory', sortOrder: 23, icon: 'Tags' },
  { code: 'inventory', name: 'Inventory', route: 'inventory', section: 'Inventory', sortOrder: 21, icon: 'Boxes' },
  { code: 'warehouses', name: 'Warehouses', route: 'warehouses', section: 'Inventory', sortOrder: 22, icon: 'Warehouse' },
  { code: 'suppliers', name: 'Suppliers', route: 'suppliers', section: 'Partners', sortOrder: 30, icon: 'Factory' },
  { code: 'customers', name: 'Customers', route: 'customers', section: 'Partners', sortOrder: 31, icon: 'Users' },
  { code: 'sales_reps', name: 'Sales Reps', route: 'sales_reps', section: 'Partners', sortOrder: 32, icon: 'UserCheck' },
  { code: 'distribution', name: 'Distribution', route: 'distribution', section: 'Logistics', sortOrder: 40, icon: 'Route' },
  { code: 'accounting', name: 'Accounting', route: 'accounting', section: 'Finance', sortOrder: 50, icon: 'BookOpen' },
  { code: 'banking', name: 'Banking', route: 'banking', section: 'Finance', sortOrder: 51, icon: 'Landmark' },
  { code: 'expenses', name: 'Expenses', route: 'expenses', section: 'Finance', sortOrder: 52, icon: 'Receipt' },
  { code: 'assets', name: 'Assets', route: 'assets', section: 'Finance', sortOrder: 53, icon: 'Building2' },
  { code: 'hr', name: 'Human Resources', route: 'hr', section: 'People', sortOrder: 60, icon: 'BadgeCheck' },
  { code: 'payroll', name: 'Payroll', route: 'payroll', section: 'People', sortOrder: 61, icon: 'Wallet' },
  { code: 'reports', name: 'Reports', route: 'reports', section: 'Insights', sortOrder: 70, icon: 'BarChart3' },
  { code: 'branches', name: 'Branches', route: 'branches', section: 'Settings', sortOrder: 80, icon: 'MapPin' },
  { code: 'users', name: 'Users', route: 'users', section: 'Settings', sortOrder: 81, icon: 'UserCog' },
  { code: 'roles', name: 'Roles', route: 'roles', section: 'Settings', sortOrder: 82, icon: 'Shield' },
  { code: 'settings', name: 'Business Settings', route: 'settings', section: 'Settings', sortOrder: 83, icon: 'Settings' },
  { code: 'audit', name: 'Audit Log', route: 'audit', section: 'Settings', sortOrder: 84, icon: 'ScrollText' }
];

/** Expand `module.*` / exact codes against the known permission catalog. */
function resolvePermissionCodes(spec: string[] | '*', allCodes: string[]): string[] {
  if (spec === '*') return [...allCodes];
  const out = new Set<string>();
  for (const item of spec) {
    if (item === '*') {
      for (const c of allCodes) out.add(c);
      continue;
    }
    if (item.endsWith('.*')) {
      const prefix = item.slice(0, -1); // keep trailing '.'
      for (const c of allCodes) {
        if (c.startsWith(prefix)) out.add(c);
      }
      continue;
    }
    if (allCodes.includes(item)) out.add(item);
  }
  return [...out];
}

/**
 * Per-role menus + privileges.
 * Permission entries may be exact (`sales.view`) or module wildcards (`sales.*`).
 * Menus use menu codes from MENUS (`*` = all).
 */
const ROLE_ACCESS: Record<string, { menus: string[] | '*'; permissions: string[] | '*' }> = {
  business_owner: {
    menus: '*',
    permissions: '*'
  },
  managing_director: {
    menus: '*',
    permissions: '*'
  },
  general_manager: {
    menus: [
      'dashboard',
      'sales',
      'pos',
      'pickups',
      'purchases',
      'products',
      'branch_pricing',
      'inventory',
      'warehouses',
      'suppliers',
      'customers',
      'sales_reps',
      'distribution',
      'accounting',
      'banking',
      'expenses',
      'assets',
      'hr',
      'payroll',
      'reports',
      'branches',
      'users',
      'audit'
    ],
    permissions: [
      'dashboard.*',
      'sales.*',
      'fulfilment.*',
      'pos.*',
      'purchases.*',
      'products.*',
      'inventory.*',
      'warehouses.*',
      'suppliers.*',
      'customers.*',
      'sales_reps.*',
      'distribution.*',
      'accounting.view',
      'accounting.export',
      'accounting.print',
      'banking.view',
      'banking.export',
      'expenses.*',
      'assets.view',
      'hr.*',
      'payroll.view',
      'payroll.approve',
      'reports.*',
      'notifications.*',
      'branches.view',
      'branches.edit',
      'branches.report_all',
      'users.view',
      'users.create',
      'users.edit',
      'audit.view',
      'audit.export',
      'settings.view'
    ]
  },
  branch_manager: {
    menus: [
      'dashboard',
      'sales',
      'pos',
      'pickups',
      'purchases',
      'products',
      'inventory',
      'warehouses',
      'suppliers',
      'customers',
      'sales_reps',
      'distribution',
      'expenses',
      'hr',
      'reports',
      'branch_pricing'
    ],
    permissions: [
      'dashboard.view',
      'sales.*',
      'fulfilment.reallocate',
      'pos.*',
      'products.branch_price',
      'purchases.view',
      'purchases.create',
      'purchases.edit',
      'purchases.approve',
      'products.view',
      'inventory.view',
      'inventory.create',
      'inventory.edit',
      'warehouses.view',
      'suppliers.view',
      'customers.*',
      'sales_reps.view',
      'sales_reps.create',
      'sales_reps.edit',
      'distribution.*',
      'expenses.view',
      'expenses.create',
      'expenses.edit',
      'expenses.approve',
      'hr.view',
      'reports.view',
      'reports.export',
      'reports.print',
      'notifications.view',
      'branches.view'
    ]
  },
  warehouse_manager: {
    menus: [
      'dashboard',
      'products',
      'inventory',
      'warehouses',
      'pickups',
      'purchases',
      'customers',
      'distribution',
      'reports'
    ],
    permissions: [
      'dashboard.view',
      'products.view',
      'products.edit',
      'sales.fulfil',
      'fulfilment.reallocate',
      'inventory.*',
      'warehouses.*',
      'purchases.view',
      'customers.view',
      'distribution.view',
      'distribution.edit',
      'distribution.post',
      'reports.view',
      'reports.export',
      'notifications.view'
    ]
  },
  inventory_officer: {
    menus: ['dashboard', 'products', 'inventory', 'warehouses', 'pickups', 'customers'],
    permissions: [
      'dashboard.view',
      'sales.fulfil',
      'products.view',
      'inventory.view',
      'inventory.create',
      'inventory.edit',
      'warehouses.view',
      'customers.view',
      'notifications.view'
    ]
  },
  procurement_officer: {
    menus: [
      'dashboard',
      'purchases',
      'suppliers',
      'customers',
      'products',
      'inventory',
      'warehouses',
      'reports'
    ],
    permissions: [
      'dashboard.view',
      'purchases.*',
      'suppliers.*',
      'customers.view',
      'products.view',
      'inventory.view',
      'warehouses.view',
      'reports.view',
      'reports.export',
      'notifications.view'
    ]
  },
  sales_manager: {
    menus: [
      'dashboard',
      'sales',
      'pos',
      'pickups',
      'customers',
      'sales_reps',
      'products',
      'inventory',
      'distribution',
      'reports',
      'branch_pricing'
    ],
    permissions: [
      'dashboard.view',
      'sales.*',
      'fulfilment.reallocate',
      'pos.*',
      'customers.*',
      'sales_reps.*',
      'products.view',
      'products.branch_price',
      'inventory.view',
      'distribution.view',
      'distribution.create',
      'distribution.edit',
      'reports.view',
      'reports.export',
      'reports.print',
      'notifications.view'
    ]
  },
  sales_representative: {
    menus: ['dashboard', 'sales', 'pos', 'customers', 'products', 'inventory'],
    permissions: [
      'dashboard.view',
      'sales.view',
      'sales.create',
      'sales.edit',
      'sales.print',
      'pos.view',
      'pos.create',
      'pos.edit',
      'pos.post',
      'customers.view',
      'customers.create',
      'customers.edit',
      'products.view',
      'inventory.view',
      'warehouses.view',
      'sales_reps.view',
      'notifications.view'
    ]
  },
  cashier: {
    menus: ['dashboard', 'pos', 'sales', 'pickups', 'customers', 'products'],
    permissions: [
      'dashboard.view',
      'pos.*',
      'sales.view',
      'sales.create',
      'sales.print',
      'sales.fulfil',
      'customers.view',
      'products.view',
      'warehouses.view',
      'sales_reps.view',
      'notifications.view'
    ]
  },
  accountant: {
    menus: [
      'dashboard',
      'accounting',
      'banking',
      'expenses',
      'assets',
      'reports',
      'sales',
      'purchases',
      'customers',
      'suppliers'
    ],
    permissions: [
      'dashboard.view',
      'accounting.*',
      'banking.*',
      'expenses.view',
      'expenses.create',
      'expenses.edit',
      'expenses.post',
      'assets.view',
      'assets.edit',
      'reports.*',
      'sales.view',
      'purchases.view',
      'customers.view',
      'customers.balances',
      'suppliers.view',
      'notifications.view',
      'audit.view'
    ]
  },
  finance_manager: {
    menus: [
      'dashboard',
      'accounting',
      'banking',
      'expenses',
      'assets',
      'payroll',
      'customers',
      'reports',
      'branches',
      'audit'
    ],
    permissions: [
      'dashboard.view',
      'accounting.*',
      'banking.*',
      'expenses.*',
      'assets.*',
      'payroll.view',
      'payroll.approve',
      'payroll.post',
      'customers.view',
      'customers.credit',
      'customers.balances',
      'reports.*',
      'branches.view',
      'branches.report_all',
      'audit.view',
      'audit.export',
      'notifications.view'
    ]
  },
  hr_manager: {
    menus: ['dashboard', 'hr', 'payroll', 'users', 'customers', 'reports'],
    permissions: [
      'dashboard.view',
      'hr.*',
      'payroll.view',
      'payroll.create',
      'payroll.edit',
      'payroll.approve',
      'users.view',
      'users.create',
      'users.edit',
      'customers.view',
      'reports.view',
      'reports.export',
      'notifications.view',
      'sales_reps.view'
    ]
  },
  payroll_officer: {
    menus: ['dashboard', 'payroll', 'hr', 'customers', 'reports'],
    permissions: [
      'dashboard.view',
      'payroll.*',
      'hr.view',
      'customers.view',
      'reports.view',
      'reports.export',
      'notifications.view'
    ]
  },
  auditor: {
    menus: '*',
    permissions: [
      ...MODULES.map((m) => `${m}.view`),
      ...MODULES.map((m) => `${m}.export`),
      ...MODULES.map((m) => `${m}.print`),
      'customers.balances',
      'branches.report_all',
      'audit.view',
      'audit.export'
    ]
  },
  delivery_officer: {
    menus: ['dashboard', 'distribution', 'sales', 'customers'],
    permissions: [
      'dashboard.view',
      'distribution.view',
      'distribution.edit',
      'distribution.post',
      'sales.view',
      'customers.view',
      'notifications.view'
    ]
  }
};

const COA: { code: string; name: string; accountType: string; key?: string }[] = [
  { code: '1000', name: 'Assets', accountType: 'asset' },
  { code: '1100', name: 'Current Assets', accountType: 'asset' },
  { code: '1110', name: 'Cash on Hand', accountType: 'asset', key: 'cash' },
  { code: '1115', name: 'Petty Cash', accountType: 'asset', key: 'petty_cash' },
  { code: '1120', name: 'Bank Account', accountType: 'asset', key: 'bank' },
  { code: '1125', name: 'Cash in Transit', accountType: 'asset', key: 'cash_in_transit' },
  { code: '1128', name: 'Payment Clearing', accountType: 'asset', key: 'payment_clearing' },
  { code: '1130', name: 'Accounts Receivable', accountType: 'asset', key: 'accounts_receivable' },
  { code: '1132', name: 'Sales Rep Cash Custody', accountType: 'asset', key: 'cash_in_custody_sales_rep' },
  { code: '1134', name: 'Sales Rep Recoveries', accountType: 'asset', key: 'sales_rep_receivable' },
  { code: '1135', name: 'Supplier Advances', accountType: 'asset', key: 'supplier_advances' },
  { code: '1136', name: 'Supplier Deposits', accountType: 'asset', key: 'supplier_deposits' },
  { code: '1140', name: 'Inventory Asset', accountType: 'asset', key: 'inventory' },
  { code: '1150', name: 'Inter-branch Clearing', accountType: 'asset', key: 'inter_branch_clearing' },
  { code: '1200', name: 'Fixed Assets', accountType: 'asset' },
  { code: '1210', name: 'Property, Plant & Equipment', accountType: 'asset', key: 'fixed_assets' },
  { code: '1220', name: 'Accumulated Depreciation', accountType: 'asset', key: 'accumulated_depreciation' },
  { code: '2000', name: 'Liabilities', accountType: 'liability' },
  { code: '2100', name: 'Accounts Payable', accountType: 'liability', key: 'accounts_payable' },
  { code: '2110', name: 'Goods Received Not Invoiced', accountType: 'liability', key: 'grni' },
  { code: '2120', name: 'Customer Advances', accountType: 'liability', key: 'customer_advances' },
  { code: '2125', name: 'Customer Deposits', accountType: 'liability', key: 'customer_deposits' },
  { code: '2130', name: 'Unapplied Customer Receipts', accountType: 'liability', key: 'unapplied_customer_receipts' },
  { code: '2140', name: 'Sales Rep Commission Payable', accountType: 'liability', key: 'sales_rep_commission_payable' },
  { code: '2200', name: 'VAT Payable', accountType: 'liability', key: 'tax_payable' },
  { code: '2300', name: 'Salary Payable', accountType: 'liability', key: 'salary_payable' },
  { code: '2400', name: 'PAYE Payable', accountType: 'liability', key: 'paye_payable' },
  { code: '2500', name: 'Pension Payable', accountType: 'liability', key: 'pension_payable' },
  { code: '3000', name: 'Equity', accountType: 'equity' },
  { code: '3100', name: 'Owner Equity', accountType: 'equity', key: 'equity' },
  { code: '3200', name: 'Retained Earnings', accountType: 'equity', key: 'retained_earnings' },
  { code: '4000', name: 'Revenue', accountType: 'revenue' },
  { code: '4100', name: 'Sales Revenue', accountType: 'revenue', key: 'sales_revenue' },
  { code: '4200', name: 'Sales Returns', accountType: 'revenue', key: 'sales_returns' },
  { code: '4300', name: 'Sales Discounts', accountType: 'revenue', key: 'sales_discounts' },
  { code: '5000', name: 'Cost of Goods Sold', accountType: 'cogs', key: 'cogs' },
  { code: '6000', name: 'Operating Expenses', accountType: 'expense' },
  { code: '6100', name: 'Salaries Expense', accountType: 'expense', key: 'salary_expense' },
  { code: '6150', name: 'Sales Rep Commission Expense', accountType: 'expense', key: 'sales_rep_commission_expense' },
  { code: '6200', name: 'Rent Expense', accountType: 'expense', key: 'rent_expense' },
  { code: '6300', name: 'Depreciation Expense', accountType: 'expense', key: 'depreciation_expense' },
  { code: '6400', name: 'General Expenses', accountType: 'expense', key: 'expense' },
  { code: '6500', name: 'Inventory Adjustment', accountType: 'expense', key: 'inventory_adjustment' },
  { code: '6510', name: 'Inventory Write-off', accountType: 'expense', key: 'inventory_write_off' },
  { code: '6520', name: 'Purchase Returns', accountType: 'expense', key: 'purchase_returns' }
];

async function main() {
  console.log('Seeding TradeStratix...');

  // Permissions (global)
  const permissionIds: Record<string, string> = {};
  let sort = 0;
  for (const mod of MODULES) {
    for (const action of ACTIONS) {
      const code = `${mod}.${action}`;
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) {
        permissionIds[code] = existing.id;
        continue;
      }
      const row = await prisma.permission.create({
        data: {
          id: id('perm'),
          code,
          name: `${mod} ${action}`,
          module: mod,
          action,
          sortOrder: sort++
        }
      });
      permissionIds[code] = row.id;
    }
  }

  // Special-purpose permissions outside the module × action grid
  const EXTRA_PERMISSIONS = [
    {
      module: 'branches',
      action: 'report_all',
      description: 'Consolidate / report across all authorised branches'
    },
    {
      module: 'sales',
      action: 'fulfil',
      description: 'Release invoiced goods to customers collecting from your warehouses (pickups)'
    },
    {
      module: 'sales',
      action: 'revenue_branch',
      description: 'Book an invoice’s revenue to a branch other than the one making the sale'
    },
    {
      module: 'sales',
      action: 'cancel',
      description: 'Cancel confirmed orders or close the unfulfilled balance of lines (releases stock, credit and deposits)'
    },
    {
      module: 'sales',
      action: 'override_credit_limit',
      description: 'Confirm an order beyond the customer credit limit (reason recorded)'
    },
    {
      module: 'fulfilment',
      action: 'reallocate',
      description: 'Move order reservations between warehouses, allocate backorders and run reservation expiry'
    },
    {
      module: 'sales',
      action: 'change_price',
      description: 'Override the unit price on sales and POS lines (otherwise the UoM selling price is used)'
    },
    {
      module: 'products',
      action: 'branch_price',
      description: 'Set or clear branch-specific selling prices and % discounts (otherwise the global price applies)'
    },
    {
      module: 'customers',
      action: 'credit',
      description: 'Set a customer credit limit and customer-wide discount %'
    },
    {
      module: 'customers',
      action: 'balances',
      description: 'View customer balances, purchase totals and invoice history'
    }
  ];
  for (const p of EXTRA_PERMISSIONS) {
    const code = `${p.module}.${p.action}`;
    const existing = await prisma.permission.findUnique({ where: { code } });
    if (existing) {
      permissionIds[code] = existing.id;
      continue;
    }
    const row = await prisma.permission.create({
      data: {
        id: id('perm'),
        code,
        name: `${p.module} ${p.action}`,
        description: p.description,
        module: p.module,
        action: p.action,
        sortOrder: sort++
      }
    });
    permissionIds[code] = row.id;
  }

  // System roles (platform-wide templates, businessId null)
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    let role = await prisma.role.findFirst({ where: { code: r.code, businessId: null } });
    if (!role) {
      role = await prisma.role.create({
        data: {
          id: id('role'),
          businessId: null,
          code: r.code,
          name: r.name,
          isSystem: true,
          sortOrder: r.sortOrder,
          description: `System role: ${r.name}`
        }
      });
    }
    roleIds[r.code] = role.id;
  }

  // Menus
  const menuIds: Record<string, string> = {};
  for (const m of MENUS) {
    let menu = await prisma.menu.findFirst({ where: { code: m.code, businessId: null } });
    if (!menu) {
      menu = await prisma.menu.create({
        data: {
          id: id('menu'),
          businessId: null,
          code: m.code,
          name: m.name,
          route: m.route,
          section: m.section,
          icon: m.icon,
          sortOrder: m.sortOrder
        }
      });
    }
    menuIds[m.code] = menu.id;
  }

  // Sync privileges + menus for every system role from ROLE_ACCESS
  const allPermissionCodes = Object.keys(permissionIds);
  for (const role of SYSTEM_ROLES) {
    const roleId = roleIds[role.code];
    const access = ROLE_ACCESS[role.code];
    if (!roleId || !access) {
      console.warn(`No ROLE_ACCESS defined for ${role.code}; skipping grants`);
      continue;
    }

    // Every role can view the full customer list (business-wide, not branch-scoped).
    const wantedPermCodes = Array.from(
      new Set([...resolvePermissionCodes(access.permissions, allPermissionCodes), 'customers.view'])
    );
    const wantedMenuCodes = Array.from(
      new Set(
        access.menus === '*'
          ? Object.keys(menuIds)
          : [...access.menus.filter((c) => menuIds[c]), 'customers']
      )
    );

    // Replace grants so re-seed corrects over/under-privileged roles
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.roleMenu.deleteMany({ where: { roleId } });

    if (wantedPermCodes.length) {
      await prisma.rolePermission.createMany({
        data: wantedPermCodes
          .map((code) => permissionIds[code])
          .filter(Boolean)
          .map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true
      });
    }

    if (wantedMenuCodes.length) {
      await prisma.roleMenu.createMany({
        data: wantedMenuCodes
          .map((code) => menuIds[code])
          .filter(Boolean)
          .map((menuId) => ({ roleId, menuId })),
        skipDuplicates: true
      });
    }

    console.log(
      `Role ${role.code}: ${wantedPermCodes.length} permissions, ${wantedMenuCodes.length} menus`
    );
  }

  // Subscription plan
  let plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'growth' } });
  if (!plan) {
    plan = await prisma.subscriptionPlan.create({
      data: {
        id: id('plan'),
        code: 'growth',
        name: 'Growth',
        description: 'Multi-branch wholesale/retail starter plan',
        monthlyPrice: 75000,
        yearlyPrice: 750000,
        maxUsers: 25,
        maxBranches: 10,
        maxWarehouses: 30,
        modulesJson: JSON.stringify(MODULES)
      }
    });
  }

  const currency = process.env.SEED_CURRENCY || 'NGN';

  // Demo business
  let business = await prisma.business.findFirst({ where: { name: 'Demo Distribution Co.' } });
  if (!business) {
    business = await prisma.business.create({
      data: {
        id: id('biz'),
        name: 'Demo Distribution Co.',
        legalName: 'Demo Distribution Company Ltd',
        registrationNumber: 'RC-DEMO-001',
        taxId: 'TIN-DEMO-001',
        email: 'ops@demodistro.local',
        phone: '+2348000000000',
        addressLine1: '12 Warehouse Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
        businessType: 'distributor_retailer',
        defaultCurrency: currency,
        inventoryValuation: 'weighted_average',
        enabledModulesJson: JSON.stringify(MODULES),
        status: 'active'
      }
    });
  }

  await prisma.businessCurrency.upsert({
    where: { businessId_code: { businessId: business.id, code: currency } },
    create: {
      id: id('cur'),
      businessId: business.id,
      code: currency,
      name: currency === 'NGN' ? 'Nigerian Naira' : currency,
      symbol: currency === 'NGN' ? '₦' : currency,
      isDefault: true,
      exchangeRate: 1
    },
    update: { isDefault: true }
  });

  await prisma.businessSubscription.create({
    data: {
      id: id('sub'),
      businessId: business.id,
      planId: plan.id,
      status: 'trial',
      startsAt: new Date(),
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  }).catch(() => undefined);

  // Branch + warehouse
  let branch = await prisma.branch.findFirst({
    where: { businessId: business.id, code: 'HQ' }
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        id: id('br'),
        businessId: business.id,
        name: 'Lagos HQ',
        code: 'HQ',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
        addressLine1: '12 Warehouse Road'
      }
    });
  }

  let branch2 = await prisma.branch.findFirst({
    where: { businessId: business.id, code: 'BR2' }
  });
  if (!branch2) {
    branch2 = await prisma.branch.create({
      data: {
        id: id('br'),
        businessId: business.id,
        name: 'Ikeja Retail',
        code: 'BR2',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'NG',
        addressLine1: '45 Allen Avenue'
      }
    });
  }

  let warehouse = await prisma.warehouse.findFirst({
    where: { businessId: business.id, code: 'MAIN' }
  });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        id: id('wh'),
        businessId: business.id,
        branchId: branch.id,
        name: 'Main Warehouse',
        code: 'MAIN',
        category: 'main'
      }
    });
  }

  let warehouse2 = await prisma.warehouse.findFirst({
    where: { businessId: business.id, code: 'IKEJA' }
  });
  if (!warehouse2) {
    warehouse2 = await prisma.warehouse.create({
      data: {
        id: id('wh'),
        businessId: business.id,
        branchId: branch2.id,
        name: 'Ikeja Retail Store',
        code: 'IKEJA',
        category: 'retail'
      }
    });
  }

  // Owner user
  const passwordHash = await bcrypt.hash('password123', 10);
  let owner = await prisma.user.findFirst({
    where: { businessId: business.id, username: 'owner' }
  });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        id: id('usr'),
        businessId: business.id,
        username: 'owner',
        passwordHash,
        fullName: 'Ada Okoro',
        role: 'business_owner',
        email: 'owner@demodistro.local',
        defaultBranchId: branch.id,
        userRoles: { create: [{ roleId: ownerRoleId }] },
        userBranches: {
          create: [
            {
              branchId: branch.id,
              businessId: business.id,
              status: 'active'
            },
            {
              branchId: branch2.id,
              businessId: business.id,
              status: 'active'
            }
          ]
        }
      }
    });
  } else {
    for (const b of [branch, branch2]) {
      const membership = await prisma.userBranch.findUnique({
        where: { userId_branchId: { userId: owner.id, branchId: b.id } }
      });
      if (!membership) {
        await prisma.userBranch.create({
          data: {
            userId: owner.id,
            businessId: business.id,
            branchId: b.id,
            status: 'active',
            assignedById: owner.id
          }
        });
      } else {
        await prisma.userBranch.update({
          where: { userId_branchId: { userId: owner.id, branchId: b.id } },
          data: {
            businessId: business.id,
            status: 'active',
            assignedById: membership.assignedById || owner.id
          }
        });
      }
    }
    if (!owner.defaultBranchId) {
      owner = await prisma.user.update({
        where: { id: owner.id },
        data: { defaultBranchId: branch.id }
      });
    }
  }

  // Chart of accounts for business
  const accountByCode: Record<string, string> = {};
  const parentByType: Record<string, string | null> = {};
  for (const a of COA) {
    let acc = await prisma.account.findFirst({
      where: { businessId: business.id, code: a.code }
    });
    if (!acc) {
      const parentId =
        a.code.length === 4 && a.code.endsWith('000')
          ? null
          : a.code.endsWith('00')
            ? parentByType[`${a.accountType}-root`] || null
            : parentByType[`${a.accountType}-group`] || parentByType[`${a.accountType}-root`] || null;

      // Simple hierarchy: x000 root, x?00 group under root
      let resolvedParent: string | null = null;
      if (a.code === '1000' || a.code === '2000' || a.code === '3000' || a.code === '4000' || a.code === '5000' || a.code === '6000') {
        resolvedParent = null;
        parentByType[`${a.accountType}-root`] = undefined as any;
      } else if (a.code.endsWith('00')) {
        const rootCode = a.code[0] + '000';
        resolvedParent = accountByCode[rootCode] || null;
        parentByType[`${a.accountType}-group`] = undefined as any;
      } else {
        const groupCode = a.code.slice(0, 2) + '00';
        resolvedParent = accountByCode[groupCode] || accountByCode[a.code[0] + '000'] || null;
      }

      acc = await prisma.account.create({
        data: {
          id: id('acc'),
          businessId: business.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          parentId: resolvedParent,
          isSystem: true
        }
      });
    }
    accountByCode[a.code] = acc.id;
    if (a.code.endsWith('000')) parentByType[`${a.accountType}-root`] = acc.id;
    if (a.code.endsWith('00') && !a.code.endsWith('000')) parentByType[`${a.accountType}-group`] = acc.id;

    if (a.key) {
      await prisma.defaultAccountSetting.upsert({
        where: {
          businessId_settingKey: { businessId: business.id, settingKey: a.key }
        },
        create: {
          id: id('das'),
          businessId: business.id,
          settingKey: a.key,
          accountId: acc.id
        },
        update: { accountId: acc.id }
      });
    }
  }

  // Financial year
  const year = new Date().getFullYear();
  let fy = await prisma.financialYear.findFirst({
    where: { businessId: business.id, name: `FY ${year}` }
  });
  if (!fy) {
    fy = await prisma.financialYear.create({
      data: {
        id: id('fy'),
        businessId: business.id,
        name: `FY ${year}`,
        startsOn: new Date(`${year}-01-01`),
        endsOn: new Date(`${year}-12-31`)
      }
    });
    for (let m = 1; m <= 12; m++) {
      const startsOn = new Date(year, m - 1, 1);
      const endsOn = new Date(year, m, 0);
      await prisma.accountingPeriod.create({
        data: {
          id: id('ap'),
          businessId: business.id,
          financialYearId: fy.id,
          name: startsOn.toLocaleString('en', { month: 'long' }),
          periodNo: m,
          startsOn,
          endsOn
        }
      });
    }
  }

  // ─── Phase 2: UoM, categories, products, opening stock ───────────────────
  const uomDefs = [
    { code: 'PCS', name: 'Piece', unitCategory: 'Count', allowsDecimal: false },
    { code: 'CTN', name: 'Carton', unitCategory: 'Packaging', allowsDecimal: false },
    { code: 'PK', name: 'Pack', unitCategory: 'Packaging', allowsDecimal: false },
    { code: 'BTL', name: 'Bottle', unitCategory: 'Count', allowsDecimal: false },
    { code: 'KG', name: 'Kilogram', unitCategory: 'Weight', allowsDecimal: true },
    { code: 'G', name: 'Gram', unitCategory: 'Weight', allowsDecimal: true },
    { code: 'L', name: 'Litre', unitCategory: 'Volume', allowsDecimal: true },
    { code: 'ML', name: 'Millilitre', unitCategory: 'Volume', allowsDecimal: true },
    { code: 'M', name: 'Metre', unitCategory: 'Length', allowsDecimal: true },
    { code: 'DZ', name: 'Dozen', unitCategory: 'Packaging', allowsDecimal: false }
  ];
  const uomIds: Record<string, string> = {};
  for (const u of uomDefs) {
    let row = await prisma.unitOfMeasure.findFirst({
      where: { businessId: business.id, code: u.code }
    });
    if (!row) {
      row = await prisma.unitOfMeasure.create({
        data: { id: id('uom'), businessId: business.id, ...u }
      });
    }
    uomIds[u.code] = row.id;
  }

  let beverages = await prisma.productCategory.findFirst({
    where: { businessId: business.id, name: 'Beverages' }
  });
  if (!beverages) {
    beverages = await prisma.productCategory.create({
      data: { id: id('cat'), businessId: business.id, name: 'Beverages', code: 'BEV' }
    });
  }
  let fashion = await prisma.productCategory.findFirst({
    where: { businessId: business.id, name: 'Fashion' }
  });
  if (!fashion) {
    fashion = await prisma.productCategory.create({
      data: { id: id('cat'), businessId: business.id, name: 'Fashion', code: 'FSH' }
    });
  }
  let brandNike = await prisma.brand.findFirst({
    where: { businessId: business.id, name: 'Nike' }
  });
  if (!brandNike) {
    brandNike = await prisma.brand.create({
      data: { id: id('brd'), businessId: business.id, name: 'Nike', code: 'NIKE' }
    });
  }

  let soda = await prisma.product.findFirst({
    where: { businessId: business.id, sku: 'BEV-SODA-500' }
  });
  if (!soda) {
    soda = await prisma.product.create({
      data: {
        id: id('prd'),
        businessId: business.id,
        name: 'Sparkle Cola 500ml',
        sku: 'BEV-SODA-500',
        barcode: '6001234567890',
        categoryId: beverages.id,
        trackingMode: 'expiry',
        trackBatch: true,
        trackExpiry: true,
        baseUomId: uomIds.BTL,
        purchaseUomId: uomIds.CTN,
        sellingUomId: uomIds.BTL,
        reorderLevel: 48,
        minStock: 24,
        defaultPurchaseCost: 150,
        defaultSellingPrice: 250,
        wholesalePrice: 220,
        retailPrice: 250,
        expiryAlertDaysJson: JSON.stringify([180, 90, 60, 30, 7]),
        variants: {
          create: [
            {
              id: id('var'),
              businessId: business.id,
              name: 'Default',
              sku: 'BEV-SODA-500-DEF',
              isDefault: true,
              purchaseCost: 150,
              sellingPrice: 250
            }
          ]
        },
        conversions: {
          create: [
            {
              id: id('puc'),
              businessId: business.id,
              fromUomId: uomIds.CTN,
              toUomId: uomIds.BTL,
              factor: 24
            },
            {
              id: id('puc'),
              businessId: business.id,
              fromUomId: uomIds.PK,
              toUomId: uomIds.BTL,
              factor: 6
            }
          ]
        }
      },
      include: { variants: true }
    });
  }

  let tee = await prisma.product.findFirst({
    where: { businessId: business.id, sku: 'NIK-TEE' }
  });
  if (!tee) {
    tee = await prisma.product.create({
      data: {
        id: id('prd'),
        businessId: business.id,
        name: 'Nike T-Shirt',
        sku: 'NIK-TEE',
        categoryId: fashion.id,
        brandId: brandNike.id,
        trackingMode: 'size_colour',
        hasVariants: true,
        baseUomId: uomIds.PCS,
        purchaseUomId: uomIds.PCS,
        sellingUomId: uomIds.PCS,
        reorderLevel: 10,
        defaultPurchaseCost: 4500,
        defaultSellingPrice: 7500,
        retailPrice: 7500,
        variants: {
          create: [
            {
              id: id('var'),
              businessId: business.id,
              name: 'Black / M',
              sku: 'NIK-BLK-M',
              colour: 'Black',
              size: 'M',
              isDefault: true,
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'Black / L',
              sku: 'NIK-BLK-L',
              colour: 'Black',
              size: 'L',
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'White / M',
              sku: 'NIK-WHT-M',
              colour: 'White',
              size: 'M',
              purchaseCost: 4500,
              sellingPrice: 7500
            },
            {
              id: id('var'),
              businessId: business.id,
              name: 'White / L',
              sku: 'NIK-WHT-L',
              colour: 'White',
              size: 'L',
              purchaseCost: 4500,
              sellingPrice: 7500
            }
          ]
        }
      },
      include: { variants: true }
    });
  }

  // Opening stock via inventory engine rules (direct lot+movement for seed speed)
  const sodaVar = await prisma.productVariant.findFirst({
    where: { productId: soda.id, isDefault: true }
  });
  if (sodaVar) {
    const existingLot = await prisma.stockLot.findFirst({
      where: { businessId: business.id, variantId: sodaVar.id, batchNumber: 'BATCH-A1' }
    });
    if (!existingLot) {
      const exp1 = new Date();
      exp1.setMonth(exp1.getMonth() + 8);
      const exp2 = new Date();
      exp2.setMonth(exp2.getMonth() + 3);
      for (const [batch, exp, qty, cost] of [
        ['BATCH-A1', exp1.toISOString().slice(0, 10), 120, 150],
        ['BATCH-B2', exp2.toISOString().slice(0, 10), 60, 155]
      ] as const) {
        const lotKey = `${sodaVar.id}|${warehouse.id}|${batch}|${exp}`;
        const lot = await prisma.stockLot.create({
          data: {
            id: id('lot'),
            businessId: business.id,
            productId: soda.id,
            variantId: sodaVar.id,
            warehouseId: warehouse.id,
            lotKey,
            batchNumber: batch,
            expiryDate: exp,
            quantityOnHand: qty,
            unitCost: cost
          }
        });
        await prisma.stockMovement.create({
          data: {
            id: id('sm'),
            businessId: business.id,
            productId: soda.id,
            variantId: sodaVar.id,
            warehouseId: warehouse.id,
            lotId: lot.id,
            movementType: 'opening',
            quantityIn: qty,
            unitCost: cost,
            totalCost: cost * qty,
            batchNumber: batch,
            expiryDate: exp,
            reason: 'Opening balance',
            performedById: owner.id,
            performedByName: owner.fullName,
            idempotencyKey: `opening:${lot.id}`
          }
        });
      }
    }
  }

  const teeVars = await prisma.productVariant.findMany({ where: { productId: tee.id } });
  for (const v of teeVars) {
    const exists = await prisma.stockLot.findFirst({
      where: { businessId: business.id, variantId: v.id }
    });
    if (exists) continue;
    const lotKey = `${v.id}|${warehouse.id}|BULK|NONE`;
    const lot = await prisma.stockLot.create({
      data: {
        id: id('lot'),
        businessId: business.id,
        productId: tee.id,
        variantId: v.id,
        warehouseId: warehouse.id,
        lotKey,
        batchNumber: 'BULK',
        quantityOnHand: 25,
        unitCost: 4500
      }
    });
    await prisma.stockMovement.create({
      data: {
        id: id('sm'),
        businessId: business.id,
        productId: tee.id,
        variantId: v.id,
        warehouseId: warehouse.id,
        lotId: lot.id,
        movementType: 'opening',
        quantityIn: 25,
        unitCost: 4500,
        totalCost: 112500,
        batchNumber: 'BULK',
        reason: 'Opening balance',
        performedById: owner.id,
        performedByName: owner.fullName,
        idempotencyKey: `opening:${lot.id}`
      }
    });
  }

  // Phase 3 — sample supplier + draft PO for Sparkle Cola
  let supplier = await prisma.supplier.findFirst({
    where: { businessId: business.id, code: 'SUP-BEV-01' }
  });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        id: id('sup'),
        businessId: business.id,
        code: 'SUP-BEV-01',
        name: 'Lagos Beverage Distributors',
        contactPerson: 'Ada Okonkwo',
        phone: '+2348012345678',
        email: 'orders@lagosbev.example',
        city: 'Lagos',
        paymentTermsDays: 14,
        createdById: owner.id
      }
    });
  }

  soda =
    (await prisma.product.findFirst({
      where: { businessId: business.id, sku: 'BEV-SODA-500' },
      include: { variants: true }
    })) || soda;

  let samplePo = await prisma.purchaseOrder.findFirst({
    where: { businessId: business.id, poNumber: 'PO-00001' }
  });
  if (!samplePo && soda) {
    const sodaVariant =
      (await prisma.productVariant.findFirst({
        where: { productId: soda.id, isDefault: true }
      })) ||
      (await prisma.productVariant.findFirst({ where: { productId: soda.id } }));
    samplePo = await prisma.purchaseOrder.create({
      data: {
        id: id('po'),
        businessId: business.id,
        branchId: branch.id,
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        poNumber: 'PO-00001',
        status: 'approved',
        orderDate: new Date(),
        expectedDate: new Date(Date.now() + 7 * 86400000),
        notes: 'Seed sample PO — ready to receive',
        subtotal: 3600,
        totalAmount: 3600,
        approvedById: owner.id,
        approvedAt: new Date(),
        createdById: owner.id,
        items: {
          create: [
            {
              id: id('poi'),
              productId: soda.id,
              variantId: sodaVariant?.id || null,
              uomId: soda.baseUomId,
              quantityOrdered: 24,
              unitCost: 150,
              lineTotal: 3600
            }
          ]
        }
      }
    });
  }

  // Phase 4 — walk-in customer, credit customer, sales rep
  let walkIn = await prisma.customer.findFirst({
    where: { businessId: business.id, code: 'WALK-IN' }
  });
  if (!walkIn) {
    walkIn = await prisma.customer.create({
      data: {
        id: id('cus'),
        businessId: business.id,
        code: 'WALK-IN',
        name: 'Walk-in Customer',
        customerType: 'walk_in',
        paymentTermsDays: 0,
        createdById: owner.id
      }
    });
  }

  let retailCustomer = await prisma.customer.findFirst({
    where: { businessId: business.id, code: 'CUS-RETAIL-01' }
  });
  if (!retailCustomer) {
    retailCustomer = await prisma.customer.create({
      data: {
        id: id('cus'),
        businessId: business.id,
        code: 'CUS-RETAIL-01',
        name: 'City Mart Retail',
        contactPerson: 'Chinedu Eze',
        phone: '+2348098765432',
        city: 'Abuja',
        customerType: 'retail',
        paymentTermsDays: 14,
        createdById: owner.id
      }
    });
  }

  // Sales rep = employee first + login; commercial SalesRep profile is separate
  let salesRepUser = await prisma.user.findFirst({
    where: {
      businessId: business.id,
      OR: [{ username: 'amaka.sales' }, { username: 'amaka' }]
    },
    orderBy: { username: 'desc' }
  });
  if (!salesRepUser) {
    const salesRepRole = await prisma.role.findFirst({
      where: {
        code: 'sales_representative',
        OR: [{ businessId: business.id }, { businessId: null }]
      }
    });
    salesRepUser = await prisma.user.create({
      data: {
        id: id('usr'),
        businessId: business.id,
        username: 'amaka.sales',
        passwordHash: await bcrypt.hash('password123', 10),
        fullName: 'Amaka Sales',
        role: 'sales_representative',
        phone: '+2348011122233',
        department: 'Sales',
        defaultBranchId: branch.id,
        createdById: owner.id,
        ...(salesRepRole ? { userRoles: { create: [{ roleId: salesRepRole.id }] } } : {}),
        userBranches: {
          create: [
            {
              branchId: branch.id,
              businessId: business.id,
              status: 'active',
              assignedById: owner.id
            }
          ]
        }
      }
    });
  }

  let salesRepEmployee =
    (await prisma.employee.findFirst({
      where: { businessId: business.id, userId: salesRepUser.id }
    })) ||
    (await prisma.employee.findFirst({
      where: {
        businessId: business.id,
        userId: null,
        OR: [{ code: 'REP-01' }, { code: 'EMP-REP-01' }]
      }
    }));
  if (!salesRepEmployee) {
    salesRepEmployee = await prisma.employee.create({
      data: {
        id: id('emp'),
        businessId: business.id,
        branchId: branch.id,
        userId: salesRepUser.id,
        code: 'EMP-REP-01',
        fullName: 'Amaka Sales',
        phone: '+2348011122233',
        department: 'Sales',
        jobTitle: 'Sales Representative',
        hireDate: new Date(`${year}-01-15`),
        baseSalary: 150000,
        status: 'active',
        createdById: owner.id
      }
    });
  } else if (salesRepEmployee.userId !== salesRepUser.id) {
    salesRepEmployee = await prisma.employee.update({
      where: { id: salesRepEmployee.id },
      data: {
        userId: salesRepUser.id,
        branchId: salesRepEmployee.branchId || branch.id,
        status: 'active'
      }
    });
  }

  let salesRep = await prisma.salesRep.findFirst({
    where: {
      businessId: business.id,
      OR: [{ employeeId: salesRepEmployee.id }, { code: 'REP-01' }, { code: 'EMP-REP-01' }]
    }
  });
  if (!salesRep) {
    salesRep = await prisma.salesRep.create({
      data: {
        id: id('rep'),
        businessId: business.id,
        employeeId: salesRepEmployee.id,
        code: 'REP-01',
        status: 'active',
        commissionPercent: 5,
        createdById: owner.id
      }
    });
  } else {
    salesRep = await prisma.salesRep.update({
      where: { id: salesRep.id },
      data: {
        employeeId: salesRep.employeeId || salesRepEmployee.id,
        status: 'active'
      }
    });
  }

  console.log('Seed complete.');
  console.log('Login: owner / password123');
  console.log(`Business: ${business.name} (${business.id})`);
  console.log(
    `Branches: ${branch.code}, ${branch2.code} | Warehouses: ${warehouse.code}, ${warehouse2.code}`
  );
  console.log('Phase 2 samples: Sparkle Cola (expiry batches), Nike T-Shirt (size/colour variants)');
  console.log(
    `Phase 3 samples: Supplier ${supplier.code}, approved PO ${samplePo?.poNumber || 'n/a'}`
  );
  console.log(
    `Phase 4 samples: ${walkIn.code}, ${retailCustomer.code}, rep ${salesRep.code}`
  );

  // Phase 5 — primary bank account linked to GL bank (1120)
  const bankGl = await prisma.account.findFirst({
    where: { businessId: business.id, code: '1120' }
  });
  let mainBank = await prisma.bankAccount.findFirst({
    where: { businessId: business.id, name: 'Main Operating Account' }
  });
  if (!mainBank && bankGl) {
    mainBank = await prisma.bankAccount.create({
      data: {
        id: id('bnk'),
        businessId: business.id,
        branchId: branch.id,
        name: 'Main Operating Account',
        bankName: 'Demo Bank',
        accountNumber: '0123456789',
        glAccountId: bankGl.id,
        openingBalance: 0,
        createdById: owner.id
      }
    });
  }
  console.log(`Phase 5 samples: Bank ${mainBank?.name || 'n/a'}`);

  // Phase 6 — sample fixed asset + budget
  let forklift = await prisma.fixedAsset.findFirst({
    where: { businessId: business.id, code: 'FA-FORK-01' }
  });
  if (!forklift) {
    forklift = await prisma.fixedAsset.create({
      data: {
        id: id('fa'),
        businessId: business.id,
        branchId: branch.id,
        code: 'FA-FORK-01',
        name: 'Warehouse Forklift',
        category: 'equipment',
        purchaseDate: new Date(`${year}-01-15`),
        purchaseCost: 4500000,
        salvageValue: 500000,
        usefulLifeMonths: 60,
        status: 'active',
        createdById: owner.id
      }
    });
  }

  let opexBudget = await prisma.budget.findFirst({
    where: { businessId: business.id, name: `FY ${year} OpEx` }
  });
  if (!opexBudget) {
    const rentAcc = await prisma.account.findFirst({
      where: { businessId: business.id, code: '6200' }
    });
    opexBudget = await prisma.budget.create({
      data: {
        id: id('bud'),
        businessId: business.id,
        branchId: branch.id,
        name: `FY ${year} OpEx`,
        fiscalYear: year,
        status: 'active',
        createdById: owner.id,
        lines: rentAcc
          ? {
              create: [
                {
                  id: id('bln'),
                  accountId: rentAcc.id,
                  periodNo: 0,
                  amount: 1200000
                }
              ]
            }
          : undefined
      }
    });
  }

  // Phase 7 — sample employee (+ login)
  let warehouseUser = await prisma.user.findFirst({
    where: { businessId: business.id, username: 'tunde' }
  });
  if (!warehouseUser) {
    const invRole = await prisma.role.findFirst({
      where: {
        code: 'inventory_officer',
        OR: [{ businessId: business.id }, { businessId: null }]
      }
    });
    warehouseUser = await prisma.user.create({
      data: {
        id: id('usr'),
        businessId: business.id,
        username: 'tunde',
        passwordHash: await bcrypt.hash('password123', 10),
        fullName: 'Tunde Warehouse',
        role: 'inventory_officer',
        department: 'Operations',
        defaultBranchId: branch.id,
        createdById: owner.id,
        ...(invRole ? { userRoles: { create: [{ roleId: invRole.id }] } } : {}),
        userBranches: {
          create: [
            {
              branchId: branch.id,
              businessId: business.id,
              status: 'active',
              assignedById: owner.id
            }
          ]
        }
      }
    });
  }

  let employee = await prisma.employee.findFirst({
    where: { businessId: business.id, code: 'EMP-01' }
  });
  if (!employee) {
    employee = await prisma.employee.create({
      data: {
        id: id('emp'),
        businessId: business.id,
        branchId: branch.id,
        userId: warehouseUser.id,
        code: 'EMP-01',
        fullName: 'Tunde Warehouse',
        department: 'Operations',
        jobTitle: 'Store Keeper',
        hireDate: new Date(`${year}-02-01`),
        baseSalary: 180000,
        status: 'active',
        createdById: owner.id
      }
    });
  } else if (!employee.userId) {
    employee = await prisma.employee.update({
      where: { id: employee.id },
      data: { userId: warehouseUser.id, branchId: employee.branchId || branch.id }
    });
  }

  // Phase 8 — sample vehicle
  let van = await prisma.vehicle.findFirst({
    where: { businessId: business.id, code: 'VAN-01' }
  });
  if (!van) {
    van = await prisma.vehicle.create({
      data: {
        id: id('veh'),
        businessId: business.id,
        code: 'VAN-01',
        name: 'Delivery Van 1',
        plateNumber: 'ABC-123-XY',
        status: 'available'
      }
    });
  }

  // Phase 9 — starter + growth plans, welcome notification
  let starter = await prisma.subscriptionPlan.findUnique({ where: { code: 'starter' } });
  if (!starter) {
    starter = await prisma.subscriptionPlan.create({
      data: {
        id: id('plan'),
        code: 'starter',
        name: 'Starter',
        description: 'Single-branch retail starter',
        monthlyPrice: 25000,
        yearlyPrice: 250000,
        maxUsers: 5,
        maxBranches: 1,
        maxWarehouses: 2,
        modulesJson: JSON.stringify(MODULES.filter((m) => m !== 'distribution' && m !== 'payroll'))
      }
    });
  }

  await prisma.appNotification.create({
    data: {
      id: id('ntf'),
      businessId: business.id,
      userId: owner.id,
      title: 'Welcome to TradeStratix',
      body: 'Phases 1–9 are ready: try Assets, HR, Payroll, Distribution, and Insights.',
      module: 'dashboard'
    }
  }).catch(() => undefined);

  // Ensure each user can operate warehouses in their authorised branches
  const businessUsers = await prisma.user.findMany({
    where: { businessId: business.id },
    select: { id: true }
  });
  let whAssignments = 0;
  for (const u of businessUsers) {
    const memberships = await prisma.userBranch.findMany({
      where: { userId: u.id, businessId: business.id, status: 'active' },
      select: { branchId: true }
    });
    const branchIds = memberships.map((m) => m.branchId);
    if (!branchIds.length) continue;
    const whs = await prisma.warehouse.findMany({
      where: { businessId: business.id, branchId: { in: branchIds }, isActive: true },
      select: { id: true }
    });
    for (const wh of whs) {
      await prisma.userWarehouse.upsert({
        where: { userId_warehouseId: { userId: u.id, warehouseId: wh.id } },
        create: {
          userId: u.id,
          businessId: business.id,
          warehouseId: wh.id,
          status: 'active',
          assignedById: owner.id
        },
        update: { status: 'active' }
      });
      whAssignments += 1;
    }
  }
  console.log(`User warehouse assignments synced (${whAssignments} rows touched)`);

  console.log(
    `Phase 6–9 samples: asset ${forklift.code}, budget ${opexBudget.name}, emp ${employee.code}, van ${van.code}, plan ${starter.code}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
