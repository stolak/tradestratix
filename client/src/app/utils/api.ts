import { API_URL } from './env';
import { storage } from './storage';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = storage.getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ token: string; user: any; business: any; permissions: string[] }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      }),
    me: () => request<any>('/auth/me')
  },
  dashboard: {
    summary: () => request<any>('/dashboard/summary')
  },
  businesses: {
    current: () => request<any>('/businesses/current'),
    update: (body: Record<string, unknown>) =>
      request<any>('/businesses/current', { method: 'PATCH', body: JSON.stringify(body) })
  },
  branches: {
    list: () => request<any[]>('/branches'),
    create: (body: Record<string, unknown>) =>
      request<any>('/branches', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  },
  warehouses: {
    list: (branchId?: string) =>
      request<any[]>(`/warehouses${branchId ? `?branch_id=${branchId}` : ''}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/warehouses', { method: 'POST', body: JSON.stringify(body) })
  },
  users: {
    list: () => request<any[]>('/users'),
    create: (body: Record<string, unknown>) =>
      request<any>('/users', { method: 'POST', body: JSON.stringify(body) })
  },
  rbac: {
    roles: () => request<any[]>('/rbac/roles'),
    permissions: () => request<any[]>('/rbac/permissions'),
    menus: () => request<any[]>('/rbac/me/menus')
  },
  accounting: {
    accounts: () => request<any[]>('/accounting/accounts'),
    journals: () => request<any[]>('/accounting/journals'),
    trialBalance: () => request<any>('/accounting/trial-balance'),
    createJournal: (body: Record<string, unknown>) =>
      request<any>('/accounting/journals', { method: 'POST', body: JSON.stringify(body) })
  },
  audit: {
    list: () => request<any[]>('/audit')
  }
};
