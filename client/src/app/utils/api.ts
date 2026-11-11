import { API_URL } from './env';
import { storage } from './storage';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = storage.getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const branchId = storage.getActiveBranchId();
  if (branchId) headers['X-Branch-Id'] = branchId;

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
      request<{
        token: string;
        user: any;
        business: any;
        permissions: string[];
        branches?: any[];
        active_branch_id?: string;
        is_sales_rep?: boolean;
        sales_rep?: any;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      }),
    me: () => request<any>('/auth/me'),
    switchBranch: (branchId: string) =>
      request<{ token: string; active_branch_id: string; branches: any[] }>(
        '/auth/switch-branch',
        {
          method: 'POST',
          body: JSON.stringify({ branch_id: branchId })
        }
      )
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
      request<any>(`/branches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    activate: (id: string) =>
      request<any>(`/branches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: true })
      }),
    deactivate: (id: string) =>
      request<any>(`/branches/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false })
      }),
    remove: (id: string) => request<{ deleted: boolean; id: string }>(`/branches/${id}`, { method: 'DELETE' }),
    members: (id: string) => request<any[]>(`/branches/${id}/members`),
    assignMember: (id: string, body: Record<string, unknown>) =>
      request<any>(`/branches/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
    revokeMember: (id: string, userId: string) =>
      request<any>(`/branches/${id}/members/${userId}`, { method: 'DELETE' })
  },
  warehouses: {
    list: (branchId?: string) =>
      request<any[]>(`/warehouses${branchId ? `?branch_id=${branchId}` : ''}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/warehouses', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/warehouses/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) =>
      request<{ deleted: boolean; id: string }>(`/warehouses/${id}`, { method: 'DELETE' })
  },
  users: {
    list: () => request<any[]>('/users'),
    create: (body: Record<string, unknown>) =>
      request<any>('/users', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  },
  rbac: {
    roles: () => request<any[]>('/rbac/roles'),
    role: (id: string) => request<any>(`/rbac/roles/${id}`),
    permissions: () => request<any[]>('/rbac/permissions'),
    menus: () => request<any[]>('/rbac/menus'),
    myMenus: () => request<any[]>('/rbac/me/menus'),
    updateRoleAccess: (id: string, body: Record<string, unknown>) =>
      request<any>(`/rbac/roles/${id}/access`, {
        method: 'PUT',
        body: JSON.stringify(body)
      })
  },
  accounting: {
    accounts: () => request<any[]>('/accounting/accounts'),
    journals: (params?: Record<string, string | undefined>) => {
      const q = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v) q.set(k, v);
        }
      }
      const qs = q.toString();
      return request<any[]>(`/accounting/journals${qs ? `?${qs}` : ''}`);
    },
    entityLedger: (entityType: string, entityId: string) =>
      request<any>(`/accounting/ledgers/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`),
    defaultAccounts: () => request<any[]>('/accounting/default-accounts'),
    defaultAccountStatus: () => request<any[]>('/accounting/default-accounts/status'),
    defaultAccountCatalog: () => request<any[]>('/accounting/default-accounts/catalog'),
    upsertDefaultAccount: (body: Record<string, unknown>) =>
      request<any>('/accounting/default-accounts', {
        method: 'PUT',
        body: JSON.stringify(body)
      }),
    trialBalance: () => request<any>('/accounting/trial-balance'),
    profitLoss: (from?: string, to?: string) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const q = params.toString();
      return request<any>(`/accounting/profit-loss${q ? `?${q}` : ''}`);
    },
    balanceSheet: (asOf?: string) =>
      request<any>(`/accounting/balance-sheet${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`),
    periods: () => request<any[]>('/accounting/periods'),
    lockPeriod: (id: string, locked: boolean) =>
      request<any>(`/accounting/periods/${id}/lock`, {
        method: 'POST',
        body: JSON.stringify({ locked })
      }),
    createJournal: (body: Record<string, unknown>) =>
      request<any>('/accounting/journals', { method: 'POST', body: JSON.stringify(body) })
  },
  banking: {
    accounts: () => request<any[]>('/banking/accounts'),
    createAccount: (body: Record<string, unknown>) =>
      request<any>('/banking/accounts', { method: 'POST', body: JSON.stringify(body) }),
    transactions: (bankAccountId?: string) =>
      request<any[]>(
        `/banking/transactions${bankAccountId ? `?bank_account_id=${encodeURIComponent(bankAccountId)}` : ''}`
      ),
    deposit: (body: Record<string, unknown>) =>
      request<any>('/banking/deposits', { method: 'POST', body: JSON.stringify(body) }),
    withdraw: (body: Record<string, unknown>) =>
      request<any>('/banking/withdrawals', { method: 'POST', body: JSON.stringify(body) }),
    transfer: (body: Record<string, unknown>) =>
      request<any>('/banking/transfers', { method: 'POST', body: JSON.stringify(body) })
  },
  expenses: {
    list: (status?: string) =>
      request<any[]>(`/expenses${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    get: (id: string) => request<any>(`/expenses/${id}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/expenses', { method: 'POST', body: JSON.stringify(body) }),
    post: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/expenses/${id}/post`, { method: 'POST', body: JSON.stringify(body) }),
    pay: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/expenses/${id}/pay`, { method: 'POST', body: JSON.stringify(body) })
  },
  reports: {
    arAging: (asOf?: string) =>
      request<any>(`/reports/ar-aging${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`),
    apAging: (asOf?: string) =>
      request<any>(`/reports/ap-aging${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''}`),
    customerStatement: (customerId: string) =>
      request<any>(`/reports/customers/${customerId}/statement`),
    supplierStatement: (supplierId: string) =>
      request<any>(`/reports/suppliers/${supplierId}/statement`)
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
    branchPrices: (branchId?: string, q?: string) => {
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', branchId);
      if (q) params.set('q', q);
      const qs = params.toString();
      return request<{ branch: any; products: any[] }>(
        `/products/branch-prices${qs ? `?${qs}` : ''}`
      );
    },
    setBranchPrice: (body: { branch_id: string; selling_price_id: string; unit_price: number }) =>
      request<any>('/products/branch-prices', { method: 'PUT', body: JSON.stringify(body) }),
    setBranchDiscount: (body: { branch_id: string; product_id: string; discount_percent: number }) =>
      request<any>('/products/branch-discounts', { method: 'PUT', body: JSON.stringify(body) }),
    clearBranchDiscount: (branchId: string, productId: string) =>
      request<{ ok: boolean }>(
        `/products/branch-discounts/${encodeURIComponent(branchId)}/${encodeURIComponent(productId)}`,
        { method: 'DELETE' }
      ),
    clearBranchPrice: (branchId: string, sellingPriceId: string) =>
      request<{ ok: boolean }>(
        `/products/branch-prices/${encodeURIComponent(branchId)}/${encodeURIComponent(sellingPriceId)}`,
        { method: 'DELETE' }
      ),
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
  suppliers: {
    list: (q?: string) =>
      request<any[]>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    get: (id: string) => request<any>(`/suppliers/${id}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/suppliers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  },
  purchases: {
    orders: (status?: string) =>
      request<any[]>(`/purchases/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    getOrder: (id: string) => request<any>(`/purchases/orders/${id}`),
    createOrder: (body: Record<string, unknown>) =>
      request<any>('/purchases/orders', { method: 'POST', body: JSON.stringify(body) }),
    submitOrder: (id: string) =>
      request<any>(`/purchases/orders/${id}/submit`, { method: 'POST', body: '{}' }),
    approveOrder: (id: string) =>
      request<any>(`/purchases/orders/${id}/approve`, { method: 'POST', body: '{}' }),
    cancelOrder: (id: string) =>
      request<any>(`/purchases/orders/${id}/cancel`, { method: 'POST', body: '{}' }),
    receipts: () => request<any[]>('/purchases/receipts'),
    receive: (body: Record<string, unknown>) =>
      request<any>('/purchases/receipts', { method: 'POST', body: JSON.stringify(body) }),
    bills: (supplierId?: string) =>
      request<any[]>(
        `/purchases/bills${supplierId ? `?supplier_id=${encodeURIComponent(supplierId)}` : ''}`
      ),
    payments: (supplierId?: string) =>
      request<any[]>(
        `/purchases/payments${supplierId ? `?supplier_id=${encodeURIComponent(supplierId)}` : ''}`
      ),
    recordPayment: (body: Record<string, unknown>) =>
      request<any>('/purchases/payments', { method: 'POST', body: JSON.stringify(body) })
  },
  customers: {
    list: (q?: string, status?: 'active' | 'inactive') => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const qs = params.toString();
      return request<any[]>(`/customers${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<any>(`/customers/${id}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/customers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    balances: (filter: { branch_id?: string; from?: string; to?: string; q?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
      const qs = params.toString();
      return request<any>(`/customers/balances${qs ? `?${qs}` : ''}`);
    },
    invoices: (
      id: string,
      filter: { branch_id?: string; from?: string; to?: string } = {}
    ) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
      const qs = params.toString();
      return request<any>(`/customers/${id}/invoices${qs ? `?${qs}` : ''}`);
    },
    activate: (id: string) => request<any>(`/customers/${id}/activate`, { method: 'POST' }),
    deactivate: (id: string) => request<any>(`/customers/${id}/deactivate`, { method: 'POST' }),
    remove: (id: string) => request<any>(`/customers/${id}`, { method: 'DELETE' }),
    addNote: (id: string, body: Record<string, unknown>) =>
      request<any>(`/customers/${id}/notes`, { method: 'POST', body: JSON.stringify(body) })
  },
  salesReps: {
    list: (branchId?: string) =>
      request<any[]>(
        `/sales-reps${branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''}`
      ),
    me: () => request<any | null>('/sales-reps/me'),
    create: (body: Record<string, unknown>) =>
      request<any>('/sales-reps', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales-reps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    activate: (id: string) =>
      request<any>(`/sales-reps/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ active: true })
      }),
    deactivate: (id: string) =>
      request<any>(`/sales-reps/${id}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({ active: false })
      }),
    remove: (id: string) => request<any>(`/sales-reps/${id}`, { method: 'DELETE' }),
    commissions: (salesRepId?: string) =>
      request<any[]>(
        `/sales-reps/commissions/list${salesRepId ? `?sales_rep_id=${encodeURIComponent(salesRepId)}` : ''}`
      )
  },
  sales: {
    invoices: (status?: string, channel?: string) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (channel) params.set('channel', channel);
      const q = params.toString();
      return request<any[]>(`/sales/invoices${q ? `?${q}` : ''}`);
    },
    getInvoice: (id: string) => request<any>(`/sales/invoices/${id}`),
    createInvoice: (body: Record<string, unknown>) =>
      request<any>('/sales/invoices', { method: 'POST', body: JSON.stringify(body) }),
    postInvoice: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/sales/invoices/${id}/post`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    posSale: (body: Record<string, unknown>) =>
      request<any>('/sales/pos', { method: 'POST', body: JSON.stringify(body) }),
    payments: (customerId?: string) =>
      request<any[]>(
        `/sales/payments${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''}`
      ),
    recordPayment: (body: Record<string, unknown>) =>
      request<any>('/sales/payments', { method: 'POST', body: JSON.stringify(body) })
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
  },
  assets: {
    list: (status?: string) =>
      request<any[]>(`/assets${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    get: (id: string) => request<any>(`/assets/${id}`),
    create: (body: Record<string, unknown>) =>
      request<any>('/assets', { method: 'POST', body: JSON.stringify(body) }),
    depreciationEntries: (assetId?: string) =>
      request<any[]>(
        `/assets/depreciation/entries${assetId ? `?asset_id=${encodeURIComponent(assetId)}` : ''}`
      ),
    runDepreciation: (body: Record<string, unknown> = {}) =>
      request<any>('/assets/depreciation/run', { method: 'POST', body: JSON.stringify(body) })
  },
  budgets: {
    list: () => request<any[]>('/budgets'),
    create: (body: Record<string, unknown>) =>
      request<any>('/budgets', { method: 'POST', body: JSON.stringify(body) }),
    activate: (id: string) =>
      request<any>(`/budgets/${id}/activate`, { method: 'POST', body: '{}' }),
    vsActual: (id: string) => request<any>(`/budgets/${id}/vs-actual`)
  },
  hr: {
    employees: (status?: string) =>
      request<any[]>(`/hr/employees${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    createEmployee: (body: Record<string, unknown>) =>
      request<any>('/hr/employees', { method: 'POST', body: JSON.stringify(body) }),
    updateEmployee: (id: string, body: Record<string, unknown>) =>
      request<any>(`/hr/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    attendance: (employeeId?: string) =>
      request<any[]>(
        `/hr/attendance${employeeId ? `?employee_id=${encodeURIComponent(employeeId)}` : ''}`
      ),
    upsertAttendance: (body: Record<string, unknown>) =>
      request<any>('/hr/attendance', { method: 'POST', body: JSON.stringify(body) }),
    leave: (status?: string) =>
      request<any[]>(`/hr/leave${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    createLeave: (body: Record<string, unknown>) =>
      request<any>('/hr/leave', { method: 'POST', body: JSON.stringify(body) }),
    approveLeave: (id: string, approve = true) =>
      request<any>(`/hr/leave/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approve })
      })
  },
  payroll: {
    runs: () => request<any[]>('/payroll/runs'),
    getRun: (id: string) => request<any>(`/payroll/runs/${id}`),
    createRun: (body: Record<string, unknown>) =>
      request<any>('/payroll/runs', { method: 'POST', body: JSON.stringify(body) }),
    postRun: (id: string) =>
      request<any>(`/payroll/runs/${id}/post`, { method: 'POST', body: '{}' }),
    payRun: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/payroll/runs/${id}/pay`, { method: 'POST', body: JSON.stringify(body) })
  },
  distribution: {
    vehicles: () => request<any[]>('/distribution/vehicles'),
    createVehicle: (body: Record<string, unknown>) =>
      request<any>('/distribution/vehicles', { method: 'POST', body: JSON.stringify(body) }),
    deliveries: (status?: string) =>
      request<any[]>(
        `/distribution/deliveries${status ? `?status=${encodeURIComponent(status)}` : ''}`
      ),
    createDelivery: (body: Record<string, unknown>) =>
      request<any>('/distribution/deliveries', { method: 'POST', body: JSON.stringify(body) }),
    schedule: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/distribution/deliveries/${id}/schedule`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    dispatch: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/distribution/deliveries/${id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    deliver: (id: string) =>
      request<any>(`/distribution/deliveries/${id}/deliver`, { method: 'POST', body: '{}' }),
    cancel: (id: string) =>
      request<any>(`/distribution/deliveries/${id}/cancel`, { method: 'POST', body: '{}' })
  },
  notifications: {
    list: (unreadOnly?: boolean) =>
      request<any[]>(`/notifications${unreadOnly ? '?unread_only=true' : ''}`),
    markRead: (id: string) =>
      request<any>(`/notifications/${id}/read`, { method: 'POST', body: '{}' }),
    markAllRead: () => request<any>('/notifications/read-all', { method: 'POST', body: '{}' })
  },
  bi: {
    insights: () => request<any>('/bi/insights')
  },
  subscriptions: {
    plans: () => request<any[]>('/subscriptions/plans'),
    current: () => request<any>('/subscriptions/current')
  },
  mobile: {
    home: () => request<any>('/mobile/home')
  }
};
