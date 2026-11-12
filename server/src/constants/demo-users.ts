/**
 * Demo login accounts for seed + public /auth/demo-users.
 * Password is always DEMO_LOGIN_PASSWORD for every account.
 */
export const DEMO_LOGIN_PASSWORD = 'password123';

export type DemoBranchScope = 'all' | 'hq' | 'ikeja';

export type DemoUserSpec = {
  username: string;
  fullName: string;
  /** System role code (must exist in seed SYSTEM_ROLES). */
  role: string;
  /** Short label shown on the login page chip. */
  label: string;
  email?: string;
  phone?: string;
  department?: string;
  branches: DemoBranchScope;
  /** Create / link Employee + SalesRep profile (sales reps). */
  asSalesRep?: boolean;
  /** Stable employee code when creating an Employee row. */
  employeeCode?: string;
  jobTitle?: string;
};

export const DEMO_USERS: DemoUserSpec[] = [
  {
    username: 'owner',
    fullName: 'Ada Okoro',
    role: 'business_owner',
    label: 'Super Admin',
    email: 'owner@demodistro.local',
    department: 'Executive',
    branches: 'all',
    jobTitle: 'Business Owner'
  },
  {
    username: 'md',
    fullName: 'Chidi Adebayo',
    role: 'managing_director',
    label: 'Managing Director',
    email: 'md@demodistro.local',
    department: 'Executive',
    branches: 'all',
    jobTitle: 'Managing Director'
  },
  {
    username: 'gm',
    fullName: 'Ngozi Eze',
    role: 'general_manager',
    label: 'General Manager',
    email: 'gm@demodistro.local',
    department: 'Operations',
    branches: 'all',
    jobTitle: 'General Manager'
  },
  {
    username: 'branch.mgr',
    fullName: 'Ifeanyi Branch',
    role: 'branch_manager',
    label: 'Branch Manager',
    email: 'branch@demodistro.local',
    department: 'Operations',
    branches: 'hq',
    employeeCode: 'EMP-BM-01',
    jobTitle: 'Branch Manager'
  },
  {
    username: 'warehouse.mgr',
    fullName: 'Kemi Stores',
    role: 'warehouse_manager',
    label: 'Warehouse Manager',
    email: 'warehouse@demodistro.local',
    department: 'Warehouse',
    branches: 'hq',
    employeeCode: 'EMP-WM-01',
    jobTitle: 'Warehouse Manager'
  },
  {
    username: 'tunde',
    fullName: 'Tunde Warehouse',
    role: 'inventory_officer',
    label: 'Store Keeper',
    email: 'tunde@demodistro.local',
    department: 'Operations',
    branches: 'hq',
    employeeCode: 'EMP-01',
    jobTitle: 'Store Keeper'
  },
  {
    username: 'procurement',
    fullName: 'Bola Procurement',
    role: 'procurement_officer',
    label: 'Procurement',
    email: 'procurement@demodistro.local',
    department: 'Procurement',
    branches: 'hq',
    employeeCode: 'EMP-PO-01',
    jobTitle: 'Procurement Officer'
  },
  {
    username: 'sales.mgr',
    fullName: 'Yemi Sales Lead',
    role: 'sales_manager',
    label: 'Sales Manager',
    email: 'sales.mgr@demodistro.local',
    department: 'Sales',
    branches: 'all',
    employeeCode: 'EMP-SM-01',
    jobTitle: 'Sales Manager'
  },
  {
    username: 'amaka.sales',
    fullName: 'Amaka Sales',
    role: 'sales_representative',
    label: 'Sales Rep',
    email: 'amaka@demodistro.local',
    phone: '+2348011122233',
    department: 'Sales',
    branches: 'hq',
    asSalesRep: true,
    employeeCode: 'EMP-REP-01',
    jobTitle: 'Sales Representative'
  },
  {
    username: 'cashier',
    fullName: 'Funke Cashier',
    role: 'cashier',
    label: 'Cashier',
    email: 'cashier@demodistro.local',
    department: 'Retail',
    branches: 'ikeja',
    employeeCode: 'EMP-CA-01',
    jobTitle: 'Cashier'
  },
  {
    username: 'accountant',
    fullName: 'Sade Books',
    role: 'accountant',
    label: 'Accountant',
    email: 'accountant@demodistro.local',
    department: 'Finance',
    branches: 'hq',
    employeeCode: 'EMP-AC-01',
    jobTitle: 'Accountant'
  },
  {
    username: 'finance.mgr',
    fullName: 'Tola Finance',
    role: 'finance_manager',
    label: 'Finance Manager',
    email: 'finance@demodistro.local',
    department: 'Finance',
    branches: 'all',
    employeeCode: 'EMP-FM-01',
    jobTitle: 'Finance Manager'
  },
  {
    username: 'hr',
    fullName: 'Peace HR',
    role: 'hr_manager',
    label: 'HR',
    email: 'hr@demodistro.local',
    department: 'People',
    branches: 'hq',
    employeeCode: 'EMP-HR-01',
    jobTitle: 'HR Manager'
  },
  {
    username: 'payroll',
    fullName: 'Dayo Payroll',
    role: 'payroll_officer',
    label: 'Payroll',
    email: 'payroll@demodistro.local',
    department: 'People',
    branches: 'hq',
    employeeCode: 'EMP-PR-01',
    jobTitle: 'Payroll Officer'
  },
  {
    username: 'auditor',
    fullName: 'Grace Audit',
    role: 'auditor',
    label: 'Auditor',
    email: 'auditor@demodistro.local',
    department: 'Compliance',
    branches: 'all',
    employeeCode: 'EMP-AU-01',
    jobTitle: 'Internal Auditor'
  },
  {
    username: 'delivery',
    fullName: 'Musa Delivery',
    role: 'delivery_officer',
    label: 'Delivery',
    email: 'delivery@demodistro.local',
    department: 'Logistics',
    branches: 'hq',
    employeeCode: 'EMP-DL-01',
    jobTitle: 'Delivery Officer'
  },
  {
    username: 'customer',
    fullName: 'City Mart Contact',
    role: 'customer_portal',
    label: 'Customer',
    email: 'customer@demodistro.local',
    phone: '+2348098765432',
    department: 'Partner',
    branches: 'hq',
    jobTitle: 'Customer Portal'
  },
  {
    username: 'supplier',
    fullName: 'Acme Supply Contact',
    role: 'supplier_portal',
    label: 'Supplier',
    email: 'supplier@demodistro.local',
    department: 'Partner',
    branches: 'hq',
    jobTitle: 'Supplier Portal'
  }
];

export function publicDemoAccounts() {
  return DEMO_USERS.map((u) => ({
    username: u.username,
    fullName: u.fullName,
    label: u.label,
    role: u.role,
    password: DEMO_LOGIN_PASSWORD
  }));
}
