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

type MfaPending = {
  mfa_token: string;
  message?: string;
  demo_code?: string;
};

export const LoginPage: React.FC = () => {
  const { login, verifyMfa } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [demos, setDemos] = useState<DemoAccount[]>([]);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);
  const [mfaPending, setMfaPending] = useState<MfaPending | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.auth
      .demoUsers()
      .then((res) => {
        if (!cancelled && res.accounts?.length) setDemos(res.accounts);
      })
      .catch(() => {
        if (!cancelled) setDemos([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (user: string, pass: string) => {
    setBusy(true);
    setActiveUsername(user);
    try {
      const outcome = await login(user, pass);
      if (outcome.status === 'mfa_required') {
        setMfaPending({
          mfa_token: outcome.mfa_token,
          message: outcome.message,
          demo_code: outcome.demo_code
        });
        setMfaCode(outcome.demo_code || '');
      }
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

  const onMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPending) return;
    setBusy(true);
    try {
      await verifyMfa(mfaPending.mfa_token, mfaCode.trim());
      setMfaPending(null);
      setMfaCode('');
    } catch (err: any) {
      await alertError('MFA failed', err.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const onDemoClick = async (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(account.password);
    setMfaPending(null);
    setMfaCode('');
    await signIn(account.username, account.password);
  };

  const cancelMfa = () => {
    setMfaPending(null);
    setMfaCode('');
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
        {mfaPending ? (
          <form onSubmit={onMfaSubmit} className="card-surface login-form">
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Verify MFA</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
                {mfaPending.message || 'Enter the 6-digit verification code to continue.'}
              </p>
              {mfaPending.demo_code && (
                <p style={{ margin: '0.65rem 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                  Demo MFA code: <strong>{mfaPending.demo_code}</strong>
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="mfaCode">Authentication code</label>
              <input
                id="mfaCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || mfaCode.length !== 6}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={cancelMfa}>
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="card-surface login-form">
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Sign in</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
                {demos.length
                  ? 'Use your business credentials, or click a demo user below.'
                  : 'Use your business credentials to continue.'}
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

            {demos.length > 0 && (
              <div className="login-demo">
                <div className="login-demo__head">
                  <span className="login-demo__title">Demo users</span>
                  <span className="login-demo__hint">password123 · MFA 000000</span>
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
            )}
          </form>
        )}
      </section>
    </div>
  );
};
