import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError } from '../utils/alerts';

export const RolesPage: React.FC = () => {
  const [roles, setRoles] = useState<any[]>([]);

  useEffect(() => {
    api.rbac
      .roles()
      .then(setRoles)
      .catch((e) => alertError('Roles', e.message));
  }, []);

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Roles & access
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          System role templates with permission grants enforced on the API.
        </p>
      </header>
      <div className="card-surface" style={{ padding: '0.5rem 0' }}>
        <div className="table-wrap">
          <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Permissions</th>
              <th>Menus</th>
              <th>System</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.role_permissions?.length ?? 0}</td>
                <td>{r.role_menus?.length ?? 0}</td>
                <td>{r.is_system ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
