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
  },
  products: {
    list: (q?: string) => request<any[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (id: string) => request<any>(`/products/${id}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/products', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ ok: boolean; id: string }>(`/products/${id}`, { method: 'DELETE' }),
    categories: () => request<any[]>('/products/categories'),
    createCategory: (body: Record<string, unknown>) =>
      request<any>('/products/categories', { method: 'POST', body: JSON.stringify(body) }),
    brands: () => request<any[]>('/products/brands'),
    createBrand: (body: Record<string, unknown>) =>
      request<any>('/products/brands', { method: 'POST', body: JSON.stringify(body) }),
    addConversion: (productId: string, body: Record<string, unknown>) =>
      request<any>(`/products/${productId}/conversions`, {
        method: 'POST',
        body: JSON.stringify(body)
      })
  },
  uoms: {
    list: () => request<any[]>('/uoms'),
    create: (body: Record<string, unknown>) =>
      request<any>('/uoms', { method: 'POST', body: JSON.stringify(body) })
  },
  inventory: {
    board: (warehouseId?: string) =>
      request<any[]>(
        `/inventory/board${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`
      ),
    lots: () => request<any[]>('/inventory/lots'),
    movements: () => request<any[]>('/inventory/movements'),
    expiry: (withinDays = 90) =>
      request<any[]>(`/inventory/expiry?within_days=${withinDays}`),
    receive: (body: Record<string, unknown>) =>
      request<any>('/inventory/receive', { method: 'POST', body: JSON.stringify(body) }),
    issue: (body: Record<string, unknown>) =>
      request<any>('/inventory/issue', { method: 'POST', body: JSON.stringify(body) }),
    adjust: (body: Record<string, unknown>) =>
      request<any>('/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
    transfers: () => request<any[]>('/inventory/transfers'),
    createTransfer: (body: Record<string, unknown>) =>
      request<any>('/inventory/transfers', { method: 'POST', body: JSON.stringify(body) }),
    approveTransfer: (id: string) =>
      request<any>(`/inventory/transfers/${id}/approve`, { method: 'POST', body: '{}' }),
    dispatchTransfer: (id: string) =>
      request<any>(`/inventory/transfers/${id}/dispatch`, { method: 'POST', body: '{}' }),
    receiveTransfer: (id: string) =>
      request<any>(`/inventory/transfers/${id}/receive`, { method: 'POST', body: '{}' })
  }
};
