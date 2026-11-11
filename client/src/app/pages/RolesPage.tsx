import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab = 'permissions' | 'menus';

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item) || 'Other';
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()];
}

export const RolesPage: React.FC = () => {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [menus, setMenus] = useState<any[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissionIds, setPermissionIds] = useState<string[]>([]);
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('permissions');
  const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  const filteredPermissions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter(
      (p) =>
        p.code?.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.module?.toLowerCase().includes(q) ||
        p.action?.toLowerCase().includes(q)
    );
  }, [permissions, query]);

  const permissionGroups = useMemo(
    () => groupBy(filteredPermissions, (p) => String(p.module || 'other')),
    [filteredPermissions]
  );

  const menuGroups = useMemo(
    () => groupBy(menus, (m) => String(m.section || 'General')),
    [menus]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [roleRows, permRows, menuRows] = await Promise.all([
        api.rbac.roles(),
        api.rbac.permissions(),
        api.rbac.menus()
      ]);
      setRoles(roleRows);
      setPermissions(permRows);
      setMenus(menuRows);
      if (!selectedRoleId && roleRows[0]) {
        selectRole(roleRows[0], false);
      } else if (selectedRoleId) {
        const fresh = roleRows.find((r: any) => r.id === selectedRoleId);
        if (fresh) selectRole(fresh, false);
      }
    } catch (e: any) {
      await alertError('Roles', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectRole = (role: any, confirmIfDirty = true) => {
    if (confirmIfDirty && dirty) {
      const ok = window.confirm('You have unsaved changes. Switch role anyway?');
      if (!ok) return;
    }
    setSelectedRoleId(role.id);
    setPermissionIds(
      (role.role_permissions || [])
        .map((rp: any) => String(rp.permission_id || rp.permission?.id || ''))
        .filter(Boolean)
    );
    setMenuIds(
      (role.role_menus || [])
        .map((rm: any) => String(rm.menu_id || rm.menu?.id || ''))
        .filter(Boolean)
    );
    setDirty(false);
    setQuery('');
  };

  const togglePermission = (id: string) => {
    setPermissionIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setDirty(true);
  };

  const toggleMenu = (id: string) => {
    setMenuIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setDirty(true);
  };

  const setModuleAll = (modulePerms: any[], on: boolean) => {
    const ids = modulePerms.map((p) => p.id);
    setPermissionIds((current) => {
      if (on) return [...new Set([...current, ...ids])];
      return current.filter((id) => !ids.includes(id));
    });
    setDirty(true);
  };

  const setAllMenus = (on: boolean) => {
    setMenuIds(on ? menus.map((m) => m.id) : []);
    setDirty(true);
  };

  const setAllVisiblePermissions = (on: boolean) => {
    const ids = filteredPermissions.map((p) => p.id);
    setPermissionIds((current) => {
      if (on) return [...new Set([...current, ...ids])];
      return current.filter((id) => !ids.includes(id));
    });
    setDirty(true);
  };

  const save = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const updated = await api.rbac.updateRoleAccess(selectedRoleId, {
        permission_ids: permissionIds,
        menu_ids: menuIds
      });
      setRoles((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      selectRole(updated, false);
      await alertSuccess('Role access saved');
    } catch (e: any) {
      await alertError('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Roles & access
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Choose a role, then grant API permissions and navigation menus.
        </p>
      </header>

      {loading ? (
        <div className="card-surface roles-empty">Loading roles…</div>
      ) : (
        <div className="roles-layout">
          <aside className="card-surface roles-list" aria-label="Roles">
            {roles.map((role) => {
              const active = role.id === selectedRoleId;
              return (
                <button
                  key={role.id}
                  type="button"
                  className={`roles-list__item${active ? ' is-active' : ''}`}
                  onClick={() => selectRole(role)}
                >
                  <div className="roles-list__name">{role.name}</div>
                  <div className="roles-list__meta">
                    <span>{role.code}</span>
                    <span>{role.role_permissions?.length ?? 0} perms</span>
                    <span>{role.role_menus?.length ?? 0} menus</span>
                    {role.is_system ? <span>System</span> : null}
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="card-surface roles-editor">
            {!selectedRole ? (
              <div className="roles-empty">Select a role to manage access.</div>
            ) : (
              <>
                <div className="roles-editor__head">
                  <div>
                    <h2 className="display" style={{ margin: 0, fontSize: '1.7rem' }}>
                      {selectedRole.name}
                    </h2>
                    <p style={{ margin: '0.3rem 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                      {selectedRole.code}
                      {selectedRole.is_system ? ' · system template' : ''}
                      {selectedRole.description ? ` · ${selectedRole.description}` : ''}
                    </p>
                  </div>
                  <div style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                    {permissionIds.length} permissions · {menuIds.length} menus
                    {dirty ? ' · unsaved' : ''}
                  </div>
                </div>

                <div className="roles-editor__tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'permissions'}
                    className={`roles-tab${tab === 'permissions' ? ' is-active' : ''}`}
                    onClick={() => setTab('permissions')}
                  >
                    Permissions
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'menus'}
                    className={`roles-tab${tab === 'menus' ? ' is-active' : ''}`}
                    onClick={() => setTab('menus')}
                  >
                    Menus
                  </button>
                </div>

                {tab === 'permissions' ? (
                  <>
                    <div className="roles-toolbar">
                      <div className="field" style={{ flex: '1 1 220px' }}>
                        <label htmlFor="perm-search">Search permissions</label>
                        <input
                          id="perm-search"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="module, action, or code"
                        />
                      </div>
                      <div className="form-grid--actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setAllVisiblePermissions(true)}
                        >
                          Select visible
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setAllVisiblePermissions(false)}
                        >
                          Clear visible
                        </button>
                      </div>
                    </div>

                    <div className="roles-panel">
                      {permissionGroups.map(([module, items]) => {
                        const allOn = items.every((p) => permissionIds.includes(p.id));
                        return (
                          <div key={module} className="roles-module">
                            <div className="roles-module__head">
                              <h3 className="roles-module__title">{module.replace(/_/g, ' ')}</h3>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}
                                onClick={() => setModuleAll(items, !allOn)}
                              >
                                {allOn ? 'Clear module' : 'Select module'}
                              </button>
                            </div>
                            <div className="roles-module__grid">
                              {items.map((p) => {
                                const id = String(p.id);
                                const on = permissionIds.includes(id);
                                return (
                                  <label key={id} className={`roles-check${on ? ' is-on' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      onChange={() => togglePermission(id)}
                                    />
                                    <span className="roles-check__text">
                                      {p.name || p.action || p.code}
                                      <span className="roles-check__code">{p.code}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {!permissionGroups.length ? (
                        <div className="roles-empty">No permissions match your search.</div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="roles-toolbar">
                      <div style={{ color: 'var(--ink-muted)', fontSize: '0.88rem', flex: 1 }}>
                        Menus control what appears in navigation for this role.
                      </div>
                      <div className="form-grid--actions">
                        <button type="button" className="btn btn-ghost" onClick={() => setAllMenus(true)}>
                          Select all
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setAllMenus(false)}>
                          Clear all
                        </button>
                      </div>
                    </div>

                    <div className="roles-panel">
                      {menuGroups.map(([section, items]) => (
                        <div key={section} className="roles-module">
                          <div className="roles-module__head">
                            <h3 className="roles-module__title">{section}</h3>
                          </div>
                          <div className="roles-module__grid">
                            {items.map((m) => {
                              const id = String(m.id);
                              const on = menuIds.includes(id);
                              return (
                                <label key={id} className={`roles-check${on ? ' is-on' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleMenu(id)}
                                  />
                                  <span className="roles-check__text">
                                    {m.name || m.code}
                                    <span className="roles-check__code">
                                      {m.code}
                                      {m.route ? ` · ${m.route}` : ''}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {!menuGroups.length ? (
                        <div className="roles-empty">No menus available.</div>
                      ) : null}
                    </div>
                  </>
                )}

                <div className="roles-footer">
                  <span style={{ color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                    {dirty ? 'Changes are not saved yet.' : 'All changes saved.'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!dirty || saving}
                    onClick={() => void save()}
                  >
                    {saving ? 'Saving…' : 'Save access'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
