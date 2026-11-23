import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';
import { APP_NAME } from '../utils/env';
import { setRouteInLocation, ROUTES } from '../routes';

function tokenFromHash(): string {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(query).get('token') || '';
}

export const SetPasswordPage: React.FC = () => {
  const [token] = useState(() => tokenFromHash());
  const [preview, setPreview] = useState<{
    username: string;
    full_name: string;
    email?: string | null;
    business_name?: string | null;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError('Missing invite token');
      setLoading(false);
      return;
    }
    api.auth
      .previewPasswordSetup(token)
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Invalid or expired invite link');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      await alertError('Password', 'Use at least 6 characters');
      return;
    }
    if (password !== confirm) {
      await alertError('Password', 'Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.auth.completePasswordSetup(token, password);
      await alertSuccess('Password saved. You can sign in now.');
      setRouteInLocation(ROUTES.DASHBOARD);
      window.location.reload();
    } catch (err: any) {
      await alertError('Could not save password', err.message);
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
          Create your staff login password.
        </p>
      </section>
      <section className="login-shell__panel">
        <form onSubmit={onSubmit} className="card-surface login-form">
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Set password</h1>
            {loading ? (
              <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>Checking invite…</p>
            ) : error ? (
              <p style={{ margin: '0.35rem 0 0', color: 'crimson' }}>{error}</p>
            ) : (
              <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)' }}>
                {preview?.full_name} · username <strong>{preview?.username}</strong>
                {preview?.business_name ? ` · ${preview.business_name}` : ''}
              </p>
            )}
          </div>
          {!loading && !error ? (
            <>
              <div className="field">
                <label htmlFor="password">New password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save password'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setRouteInLocation(ROUTES.DASHBOARD);
              window.location.reload();
            }}
          >
            Back to sign in
          </button>
        </form>
      </section>
    </div>
  );
};
