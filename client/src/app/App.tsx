import React, { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
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
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { UnitsOfMeasurePage } from './pages/UnitsOfMeasurePage';
import { BranchPricingPage } from './pages/BranchPricingPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { CustomersPage } from './pages/CustomersPage';
import { SalesPage } from './pages/SalesPage';
import { PosPage } from './pages/PosPage';
import { PickupsPage } from './pages/PickupsPage';
import { SalesRepsPage } from './pages/SalesRepsPage';
import { BankingPage } from './pages/BankingPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReportsPage } from './pages/ReportsPage';
import { AssetsPage } from './pages/AssetsPage';
import { HrPage } from './pages/HrPage';
import { PayrollPage } from './pages/PayrollPage';
import { DistributionPage } from './pages/DistributionPage';
import { InsightsPage } from './pages/InsightsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { BranchSwitcher } from './components/BranchSwitcher';
import { getRouteFromLocation, ROUTES, setRouteInLocation } from './routes';

export const App: React.FC = () => {
  const { user, loading, isAuthenticated, logout, can, activeBranchId } = useAuth();
  const [route, setRoute] = useState(() => getRouteFromLocation() || ROUTES.DASHBOARD);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(getRouteFromLocation() || ROUTES.DASHBOARD);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [route]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const navigate = (next: string) => {
    setRoute(next);
    setRouteInLocation(next);
    setNavOpen(false);
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
    case ROUTES.PICKUPS:
      content = <PickupsPage />;
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
    case ROUTES.BRANCH_PRICING:
      content = <BranchPricingPage />;
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
      content = <AssetsPage />;
      break;
    case ROUTES.HR:
      content = <HrPage />;
      break;
    case ROUTES.PAYROLL:
      content = <PayrollPage />;
      break;
    case ROUTES.DISTRIBUTION:
      content = <DistributionPage />;
      break;
    case ROUTES.INSIGHTS:
      content = <InsightsPage />;
      break;
    case ROUTES.NOTIFICATIONS:
      content = <NotificationsPage />;
      break;
    case ROUTES.SUBSCRIPTIONS:
      content = <SubscriptionsPage />;
      break;
    default:
      content = <DashboardPage />;
  }

  return (
    <div className="app-shell">
      {navOpen ? (
        <button
          type="button"
          className="app-shell__backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <Sidebar
        current={route}
        onNavigate={navigate}
        can={can}
        businessName={user?.business?.name}
        open={navOpen}
      />
      <div className="app-shell__main">
        <header className="app-shell__header">
          <div className="app-shell__header-start">
            <button
              type="button"
              className="btn btn-ghost app-shell__menu-btn"
              aria-label="Open menu"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Menu size={18} />
              Menu
            </button>
            <div className="app-shell__user">
              Signed in as <strong style={{ color: 'var(--ink)' }}>{user?.full_name}</strong> ·{' '}
              {user?.role}
            </div>
          </div>
          <div className="app-shell__header-end">
            <BranchSwitcher />
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="app-shell__content" key={activeBranchId || 'no-branch'}>
          {content}
        </main>
      </div>
    </div>
  );
};
