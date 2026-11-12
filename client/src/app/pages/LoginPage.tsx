import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { alertError } from '../utils/alerts';
import { api } from '../utils/api';
import { APP_NAME } from '../utils/env';

type DemoAccount = {
  username: string;
  fullName: string;
  label: string;
  role: string;
  password: string;
};

const FALLBACK_DEMOS: DemoAccount[] = [
  { username: 'owner', fullName: 'Ada Okoro', label: 'Super Admin', role: 'business_owner', password: 'password123' },
  { username: 'hr', fullName: 'Peace HR', label: 'HR', role: 'hr_manager', password: 'password123' },
  { username: 'amaka.sales', fullName: 'Amaka Sales', label: 'Sales Rep', role: 'sales_representative', password: 'password123' },
  { username: 'accountant', fullName: 'Sade Books', label: 'Accountant', role: 'accountant', password: 'password123' },
  { username: 'tunde', fullName: 'Tunde Warehouse', label: 'Store Keeper', role: 'inventory_officer', password: 'password123' },
  { username: 'branch.mgr', fullName: 'Ifeanyi Branch', label: 'Branch Manager', role: 'branch_manager', password: 'password123' },
  { username: 'customer', fullName: 'City Mart Contact', label: 'Customer', role: 'customer_portal', password: 'password123' },
  { username: 'supplier', fullName: 'Acme Supply Contact', label: 'Supplier', role: 'supplier_portal', password: 'password123' }
];

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('password123');
  const [busy, setBusy] = useState(false);
  const [demos, setDemos] = useState<DemoAccount[]>(FALLBACK_DEMOS);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .demoUsers()
      .then((res) => {
        if (!cancelled && res.accounts?.length) setDemos(res.accounts);
      })
      .catch(() => {
        /* keep fallback chips */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (user: string, pass: string) => {
    setBusy(true);
    setActiveUsername(user);
    try {
      await login(user, pass);
    } catch (err: any) {
      await alertError('Login failed', err.message || 'Invalid credentials');
    } finally {
      setBusy(false);
      setActiveUsername(null);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn(username, password);
  };

  const onDemoClick = async (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(account.password);
    await signIn(account.username, account.password);
  };

  return (
    <div className="login-shell">
      <section className="login-shell__hero">
        <div className="display" style={{ fontSize: 'clamp(2.8rem, 6vw, 4.5rem)', lineHeight: 1 }}>
          {APP_NAME}
        </div>
        <p style={{ maxWidth: 420, opacity: 0.9, fontSize: '1.05rem' }}>
          Distribution, wholesale and retail operations on one ledger-connected platform.
        </p>
      </section>

      <section className="login-shell__panel">
        <form onSubmit={onSubmit} className="card-surface login-form">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Sign in</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
              Use your business credentials, or click a demo user below.
            </p>
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy && !activeUsername ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-demo">
            <div className="login-demo__head">
              <span className="login-demo__title">Demo users</span>
              <span className="login-demo__hint">password123</span>
            </div>
            <div className="login-demo__grid">
              {demos.map((account) => {
                const loading = busy && activeUsername === account.username;
                return (
                  <button
                    key={account.username}
                    type="button"
                    className="login-demo__chip"
                    disabled={busy}
                    onClick={() => onDemoClick(account)}
                    title={`${account.fullName} · ${account.username}`}
                  >
                    <span className="login-demo__label">{account.label}</span>
                    <span className="login-demo__meta">
                      {loading ? 'Signing in…' : account.username}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
};
