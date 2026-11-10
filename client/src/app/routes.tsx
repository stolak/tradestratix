export const ROUTES = {
  DASHBOARD: 'dashboard',
  SALES: 'sales',
  POS: 'pos',
  PURCHASES: 'purchases',
  PRODUCTS: 'products',
  INVENTORY: 'inventory',
  WAREHOUSES: 'warehouses',
  SUPPLIERS: 'suppliers',
  CUSTOMERS: 'customers',
  SALES_REPS: 'sales_reps',
  DISTRIBUTION: 'distribution',
  ACCOUNTING: 'accounting',
  BANKING: 'banking',
  EXPENSES: 'expenses',
  ASSETS: 'assets',
  HR: 'hr',
  PAYROLL: 'payroll',
  REPORTS: 'reports',
  BRANCHES: 'branches',
  USERS: 'users',
  ROLES: 'roles',
  SETTINGS: 'settings',
  AUDIT: 'audit'
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

export function getRouteFromLocation(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return hash || null;
}

export function setRouteInLocation(route: string) {
  window.location.hash = `/${route}`;
}
