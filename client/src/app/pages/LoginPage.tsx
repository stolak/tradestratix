import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { alertError } from '../utils/alerts';
import { APP_NAME } from '../utils/env';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('password123');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
    } catch (err: any) {
      await alertError('Login failed', err.message || 'Invalid credentials');
    } finally {
      setBusy(false);
    }
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

      <section
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: 'clamp(1.25rem, 4vw, 2rem)',
          background: 'var(--bg)'
        }}
      >
        <form
          onSubmit={onSubmit}
          className="card-surface"
          style={{ width: 'min(420px, 100%)', padding: '2rem', display: 'grid', gap: '1rem' }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Sign in</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
              Use your business credentials to continue.
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
};
