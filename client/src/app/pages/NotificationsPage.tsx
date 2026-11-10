import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

export const NotificationsPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async (unread = unreadOnly) => {
    try {
      setRows(await api.notifications.list(unread));
    } catch (err: any) {
      await alertError('Notifications', err.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markRead = async (id: string) => {
    try {
      await api.notifications.markRead(id);
      await load();
    } catch (err: any) {
      await alertError('Mark read failed', err.message);
    }
  };

  const markAll = async () => {
    try {
      await api.notifications.markAllRead();
      await alertSuccess('All notifications marked read');
      await load();
    } catch (err: any) {
      await alertError('Mark all failed', err.message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Notifications
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          In-app alerts for your user and business-wide notices.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={!unreadOnly ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => {
            setUnreadOnly(false);
            void load(false);
          }}
        >
          All
        </button>
        <button
          type="button"
          className={unreadOnly ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => {
            setUnreadOnly(true);
            void load(true);
          }}
        >
          Unread
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void markAll()}>
          Mark all read
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Body</th>
              <th>Module</th>
              <th>When</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_read ? 0.7 : 1 }}>
                <td style={{ fontWeight: r.is_read ? 400 : 700 }}>{r.title}</td>
                <td>{r.body}</td>
                <td>{r.module || '—'}</td>
                <td>{r.created_at ? String(r.created_at).slice(0, 19).replace('T', ' ') : '—'}</td>
                <td>{r.is_read ? 'Read' : 'Unread'}</td>
                <td>
                  {!r.is_read ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void markRead(r.id)}
                    >
                      Mark read
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>No notifications</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
};
