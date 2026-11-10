import React, { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BranchesPage } from './pages/BranchesPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { UsersPage } from './pages/UsersPage';
import { RolesPage } from './pages/RolesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountingPage } from './pages/AccountingPage';
import { AuditPage } from './pages/AuditPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { UnitsOfMeasurePage } from './pages/UnitsOfMeasurePage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CustomersPage } from './pages/CustomersPage';
import { SalesPage } from './pages/SalesPage';
import { PosPage } from './pages/PosPage';
import { SalesRepsPage } from './pages/SalesRepsPage';
import { BankingPage } from './pages/BankingPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReportsPage } from './pages/ReportsPage';
import { getRouteFromLocation, ROUTES, setRouteInLocation } from './routes';

export const App: React.FC = () => {
  const { user, loading, isAuthenticated, logout, can } = useAuth();
  const [route, setRoute] = useState(() => getRouteFromLocation() || ROUTES.DASHBOARD);

  useEffect(() => {
    const onHash = () => setRoute(getRouteFromLocation() || ROUTES.DASHBOARD);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: string) => {
    setRoute(next);
    setRouteInLocation(next);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        Loading TradeStratix…
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  let content: React.ReactNode;
  switch (route) {
    case ROUTES.DASHBOARD:
      content = <DashboardPage />;
      break;
    case ROUTES.BRANCHES:
      content = <BranchesPage />;
      break;
    case ROUTES.WAREHOUSES:
      content = <WarehousesPage />;
      break;
    case ROUTES.USERS:
      content = <UsersPage />;
      break;
    case ROUTES.ROLES:
      content = <RolesPage />;
      break;
    case ROUTES.SETTINGS:
      content = <SettingsPage />;
      break;
    case ROUTES.ACCOUNTING:
      content = <AccountingPage />;
      break;
    case ROUTES.AUDIT:
      content = <AuditPage />;
      break;
    case ROUTES.SALES:
      content = <SalesPage />;
      break;
    case ROUTES.POS:
      content = <PosPage />;
      break;
    case ROUTES.PURCHASES:
      content = <PurchasesPage />;
      break;
    case ROUTES.SUPPLIERS:
      content = <SuppliersPage />;
      break;
    case ROUTES.CUSTOMERS:
      content = <CustomersPage />;
      break;
    case ROUTES.SALES_REPS:
      content = <SalesRepsPage />;
      break;
    case ROUTES.PRODUCTS:
      content = <ProductsPage />;
      break;
    case ROUTES.INVENTORY:
      content = <InventoryPage />;
      break;
    case 'uoms':
      content = <UnitsOfMeasurePage />;
      break;
    case ROUTES.BANKING:
      content = <BankingPage />;
      break;
    case ROUTES.EXPENSES:
      content = <ExpensesPage />;
      break;
    case ROUTES.REPORTS:
      content = <ReportsPage />;
      break;
    case ROUTES.ASSETS:
      content = <PlaceholderPage title="Assets" phase="Phase 6" />;
      break;
    default:
      content = <DashboardPage />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        current={route}
        onNavigate={navigate}
        can={can}
        businessName={user?.business?.name}
      />
      <div className="app-shell__main">
        <header className="app-shell__header">
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem', minWidth: 0 }}>
            Signed in as <strong style={{ color: 'var(--ink)' }}>{user?.full_name}</strong> ·{' '}
            {user?.role}
          </div>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </header>
        <main className="app-shell__content">{content}</main>
      </div>
    </div>
  );
};
