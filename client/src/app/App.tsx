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
      content = <PlaceholderPage title="Sales" phase="Phase 4" />;
      break;
    case ROUTES.POS:
      content = <PlaceholderPage title="Point of Sale" phase="Phase 4" />;
      break;
    case ROUTES.PURCHASES:
      content = <PlaceholderPage title="Purchases" phase="Phase 3" />;
      break;
    case ROUTES.PRODUCTS:
      content = <PlaceholderPage title="Products" phase="Phase 2" />;
      break;
    case ROUTES.INVENTORY:
      content = <PlaceholderPage title="Inventory" phase="Phase 2" />;
      break;
    case ROUTES.BANKING:
      content = <PlaceholderPage title="Banking" phase="Phase 5" />;
      break;
    case ROUTES.EXPENSES:
      content = <PlaceholderPage title="Expenses" phase="Phase 5" />;
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
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem 1.5rem',
            borderBottom: '1px solid var(--line)',
            background: 'rgba(255,252,247,0.85)',
            backdropFilter: 'blur(8px)',
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}
        >
          <div style={{ color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            Signed in as <strong style={{ color: 'var(--ink)' }}>{user?.full_name}</strong> ·{' '}
            {user?.role}
          </div>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </header>
        <main style={{ padding: '1.5rem', flex: 1 }}>{content}</main>
      </div>
    </div>
  );
};
