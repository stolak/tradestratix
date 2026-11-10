import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Monitor,
  Truck,
  Package,
  Boxes,
  Warehouse,
  Factory,
  Users,
  UserCheck,
  Route,
  BookOpen,
  Landmark,
  Receipt,
  Building2,
  BadgeCheck,
  Wallet,
  BarChart3,
  MapPin,
  UserCog,
  Shield,
  Settings,
  ScrollText
} from 'lucide-react';
import { APP_NAME } from '../utils/env';
import { ROUTES } from '../routes';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  LayoutDashboard,
  ShoppingCart,
  Monitor,
  Truck,
  Package,
  Boxes,
  Warehouse,
  Factory,
  Users,
  UserCheck,
  Route,
  BookOpen,
  Landmark,
  Receipt,
  Building2,
  BadgeCheck,
  Wallet,
  BarChart3,
  MapPin,
  UserCog,
  Shield,
  Settings,
  ScrollText
};

const NAV = [
  { section: 'Overview', items: [{ route: ROUTES.DASHBOARD, label: 'Dashboard', icon: 'LayoutDashboard', perm: 'dashboard.view' }] },
  {
    section: 'Commerce',
    items: [
      { route: ROUTES.SALES, label: 'Sales', icon: 'ShoppingCart', perm: 'sales.view' },
      { route: ROUTES.POS, label: 'POS', icon: 'Monitor', perm: 'pos.view' },
      { route: ROUTES.PURCHASES, label: 'Purchases', icon: 'Truck', perm: 'purchases.view' }
    ]
  },
  {
    section: 'Inventory',
    items: [
      { route: ROUTES.PRODUCTS, label: 'Products', icon: 'Package', perm: 'products.view' },
      { route: ROUTES.INVENTORY, label: 'Inventory', icon: 'Boxes', perm: 'inventory.view' },
      { route: 'uoms', label: 'Units', icon: 'Package', perm: 'products.view' },
      { route: ROUTES.WAREHOUSES, label: 'Warehouses', icon: 'Warehouse', perm: 'warehouses.view' }
    ]
  },
  {
    section: 'Partners',
    items: [
      { route: ROUTES.CUSTOMERS, label: 'Customers', icon: 'Users', perm: 'customers.view' },
      { route: ROUTES.SUPPLIERS, label: 'Suppliers', icon: 'Factory', perm: 'suppliers.view' },
      { route: ROUTES.SALES_REPS, label: 'Sales reps', icon: 'UserCheck', perm: 'sales_reps.view' }
    ]
  },
  {
    section: 'Finance',
    items: [
      { route: ROUTES.ACCOUNTING, label: 'Accounting', icon: 'BookOpen', perm: 'accounting.view' },
      { route: ROUTES.BANKING, label: 'Banking', icon: 'Landmark', perm: 'banking.view' },
      { route: ROUTES.EXPENSES, label: 'Expenses', icon: 'Receipt', perm: 'expenses.view' },
      { route: ROUTES.REPORTS, label: 'Statements', icon: 'BarChart3', perm: 'reports.view' },
      { route: ROUTES.ASSETS, label: 'Assets', icon: 'Building2', perm: 'assets.view', soon: true }
    ]
  },
  {
    section: 'Organisation',
    items: [
      { route: ROUTES.BRANCHES, label: 'Branches', icon: 'MapPin', perm: 'branches.view' },
      { route: ROUTES.USERS, label: 'Users', icon: 'UserCog', perm: 'users.view' },
      { route: ROUTES.ROLES, label: 'Roles', icon: 'Shield', perm: 'roles.view' },
      { route: ROUTES.SETTINGS, label: 'Settings', icon: 'Settings', perm: 'settings.view' },
      { route: ROUTES.AUDIT, label: 'Audit', icon: 'ScrollText', perm: 'audit.view' }
    ]
  }
];

type Props = {
  current: string;
  onNavigate: (route: string) => void;
  can: (...codes: string[]) => boolean;
  businessName?: string;
};

export const Sidebar: React.FC<Props> = ({ current, onNavigate, can, businessName }) => {
  return (
    <aside
      className="app-shell__sidebar"
      style={{
        background: 'linear-gradient(180deg, #0a3f35 0%, #0f5c4c 55%, #134e4a 100%)',
        color: '#e8f5f1',
        padding: '1.25rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}
    >
      <div>
        <div className="display" style={{ fontSize: '1.75rem', color: 'white' }}>
          {APP_NAME}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: 4 }}>
          {businessName || 'Business ERP'}
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'auto' }}>
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <div
                style={{
                  fontSize: '0.7rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  opacity: 0.55,
                  marginBottom: 6,
                  paddingLeft: 10
                }}
              >
                {group.section}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {items.map((item) => {
                  const Icon = ICONS[item.icon] || LayoutDashboard;
                  const active = current === item.route;
                  return (
                    <button
                      key={item.route}
                      type="button"
                      onClick={() => onNavigate(item.route)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        border: 'none',
                        borderRadius: 10,
                        padding: '0.65rem 0.75rem',
                        background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
                        color: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <Icon size={16} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.soon ? (
                        <span style={{ fontSize: 10, opacity: 0.6 }}>soon</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};
