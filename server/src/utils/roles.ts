export const SYSTEM_ROLES = [
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
  { code: 'delivery_officer', name: 'Delivery Officer', sortOrder: 16 },
  { code: 'customer_portal', name: 'Customer', sortOrder: 17 },
  { code: 'supplier_portal', name: 'Supplier', sortOrder: 18 }
] as const;

export type RoleCode = (typeof SYSTEM_ROLES)[number]['code'];

export const MODULES = [
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
] as const;

export const ACTIONS = [
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
] as const;
