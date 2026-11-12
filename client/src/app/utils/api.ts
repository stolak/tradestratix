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

/** Multipart upload (do not set Content-Type — the browser adds the boundary). */
async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const token = storage.getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const branchId = storage.getActiveBranchId();
  if (branchId) headers['X-Branch-Id'] = branchId;
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Upload failed (${res.status})`);
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
    stockBalance: (
      filter: { branch_ids?: string[]; warehouse_ids?: string[]; q?: string; include_zero?: boolean } = {}
    ) => {
      const params = new URLSearchParams();
      if (filter.branch_ids?.length) params.set('branch_ids', filter.branch_ids.join(','));
      if (filter.warehouse_ids?.length) params.set('warehouse_ids', filter.warehouse_ids.join(','));
      if (filter.q) params.set('q', filter.q);
      if (filter.include_zero) params.set('include_zero', '1');
      const qs = params.toString();
      return request<any>(`/reports/stock-balance${qs ? `?${qs}` : ''}`);
    },
    customerStatement: (customerId: string) =>
      request<any>(`/reports/customers/${customerId}/statement`),
    supplierStatement: (supplierId: string) =>
      request<any>(`/reports/suppliers/${supplierId}/statement`),
    interBranchClearing: (filter: { from?: string; to?: string; consolidated?: boolean } = {}) => {
      const params = new URLSearchParams();
      if (filter.from) params.set('from', filter.from);
      if (filter.to) params.set('to', filter.to);
      if (filter.consolidated) params.set('consolidated', '1');
      const qs = params.toString();
      return request<any>(`/reports/inter-branch-clearing${qs ? `?${qs}` : ''}`);
    },
    fulfilmentSummary: (filter: { from?: string; to?: string; consolidated?: boolean } = {}) => {
      const params = new URLSearchParams();
      if (filter.from) params.set('from', filter.from);
      if (filter.to) params.set('to', filter.to);
      if (filter.consolidated) params.set('consolidated', '1');
      const qs = params.toString();
      return request<any>(`/reports/fulfilment-summary${qs ? `?${qs}` : ''}`);
    },
    salesByBranch: (filter: { from?: string; to?: string; consolidated?: boolean } = {}) => {
      const params = new URLSearchParams();
      if (filter.from) params.set('from', filter.from);
      if (filter.to) params.set('to', filter.to);
      if (filter.consolidated !== false) params.set('consolidated', '1');
      const qs = params.toString();
      return request<any>(`/reports/sales-by-branch${qs ? `?${qs}` : ''}`);
    }
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
    list: (q?: string, status?: 'active' | 'inactive', opts?: { includeWalkIn?: boolean }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (opts?.includeWalkIn) params.set('include_walk_in', '1');
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
    list: (branchId?: string, opts?: { all?: boolean; withBalances?: boolean }) => {
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', branchId);
      if (opts?.all) params.set('all', '1');
      if (opts?.withBalances) params.set('with_balances', '1');
      const qs = params.toString();
      return request<any[]>(`/sales-reps${qs ? `?${qs}` : ''}`);
    },
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
      request<any>(`/sales/invoices/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    cancelOrder: (id: string, body: { reason: string; lines?: { invoice_item_id: string; quantity: number }[] }) =>
      request<any>(`/sales/invoices/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) }),
    amendOrder: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales/invoices/${id}/amend`, { method: 'POST', body: JSON.stringify(body) }),
    reallocateOrder: (
      id: string,
      body: { from_warehouse_id: string; to_warehouse_id?: string; invoice_item_id?: string; reason: string; allow_backorder?: boolean }
    ) => request<any>(`/sales/invoices/${id}/reallocate`, { method: 'POST', body: JSON.stringify(body) }),
    allocateBackorders: (id: string) =>
      request<any>(`/sales/invoices/${id}/allocate`, { method: 'POST', body: '{}' }),
    allocationPreview: (body: Record<string, unknown>) =>
      request<{ lines: any[] }>('/sales/allocation-preview', { method: 'POST', body: JSON.stringify(body) }),
    posSale: (body: Record<string, unknown>) =>
      request<any>('/sales/pos', { method: 'POST', body: JSON.stringify(body) }),
    fulfilmentOptions: (productIds: string[] = []) =>
      request<{
        branches: { id: string; name: string; code: string }[];
        warehouses: any[];
        availability: Record<string, Record<string, number>>;
      }>(
        `/sales/fulfilment-options${
          productIds.length ? `?product_ids=${encodeURIComponent(productIds.join(','))}` : ''
        }`
      ),
    pendingPickups: (filter: { warehouse_id?: string; q?: string } = {}) => {
      const params = new URLSearchParams();
      if (filter.warehouse_id) params.set('warehouse_id', filter.warehouse_id);
      if (filter.q) params.set('q', filter.q);
      const qs = params.toString();
      return request<{ warehouses: any[]; rows: any[] }>(
        `/sales/fulfilments/pending${qs ? `?${qs}` : ''}`
      );
    },
    fulfilments: (warehouseId?: string) =>
      request<any[]>(
        `/sales/fulfilments${warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : ''}`
      ),
    fulfil: (body: Record<string, unknown>) =>
      request<any>('/sales/fulfilments', { method: 'POST', body: JSON.stringify(body) }),
    warehouseDashboard: (filter: { warehouse_id?: string; q?: string; status?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
      const qs = params.toString();
      return request<{ warehouses: any[]; summary: Record<string, number>; awaiting: any[]; tasks: any[] }>(
        `/sales/fulfilments/dashboard${qs ? `?${qs}` : ''}`
      );
    },
    lookupPickupByCode: (code: string) =>
      request<any>('/sales/pickups/by-code', {
        method: 'POST',
        body: JSON.stringify({ code })
      }),
    fulfilment: (id: string) => request<any>(`/sales/fulfilments/${id}`),
    startPicking: (body: { invoice_id: string; warehouse_id: string; notes?: string }) =>
      request<any>('/sales/fulfilments/picking', { method: 'POST', body: JSON.stringify(body) }),
    confirmPicking: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales/fulfilments/${id}/pick`, { method: 'POST', body: JSON.stringify(body) }),
    releaseFulfilment: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales/fulfilments/${id}/release`, { method: 'POST', body: JSON.stringify(body) }),
    cancelFulfilment: (id: string, reason: string) =>
      request<any>(`/sales/fulfilments/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    dispatchFulfilment: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales/fulfilments/${id}/dispatch`, { method: 'POST', body: JSON.stringify(body) }),
    deliverFulfilment: (id: string, body: Record<string, unknown>) =>
      request<any>(`/sales/fulfilments/${id}/deliver`, { method: 'POST', body: JSON.stringify(body) }),
    listFulfilmentProofs: (id: string) => request<any[]>(`/sales/fulfilments/${id}/proofs`),
    uploadFulfilmentProof: (id: string, file: File, kind?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (kind) form.append('kind', kind);
      return uploadForm<any>(`/sales/fulfilments/${id}/proofs`, form);
    },
    deleteFulfilmentProof: (id: string, proofId: string) =>
      request<{ deleted: boolean; id: string }>(`/sales/fulfilments/${id}/proofs/${proofId}`, {
        method: 'DELETE'
      }),
    reissuePickupCode: (id: string, reason: string) =>
      request<{ pickup_code: string; pickup_code_expires_at: string | null }>(`/sales/invoices/${id}/pickup-code`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
    payments: (customerId?: string) =>
      request<any[]>(
        `/sales/payments${customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''}`
      ),
    recordPayment: (body: Record<string, unknown>) =>
      request<any>('/sales/payments', { method: 'POST', body: JSON.stringify(body) }),
    returnPreview: (invoiceId: string) =>
      request<any>(`/sales/invoices/${invoiceId}/return-preview`),
    returns: (filter: { invoice_id?: string; customer_id?: string; status?: string; q?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
      const qs = params.toString();
      return request<any[]>(`/sales/returns${qs ? `?${qs}` : ''}`);
    },
    getReturn: (id: string) => request<any>(`/sales/returns/${id}`),
    createReturn: (body: Record<string, unknown>) =>
      request<any>('/sales/returns', { method: 'POST', body: JSON.stringify(body) }),
    postReturn: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/sales/returns/${id}/post`, { method: 'POST', body: JSON.stringify(body) }),
    voidReturn: (id: string, reason: string) =>
      request<any>(`/sales/returns/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    customerCredit: (customerId: string) =>
      request<{ total: number; payments: any[] }>(`/sales/customers/${customerId}/credit`),
    applyCredit: (body: Record<string, unknown>) =>
      request<any>('/sales/credits/apply', { method: 'POST', body: JSON.stringify(body) }),
    refundCredit: (body: Record<string, unknown>) =>
      request<any>('/sales/credits/refund', { method: 'POST', body: JSON.stringify(body) })
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
    deliver: (id: string, body: Record<string, unknown> = {}) =>
      request<any>(`/distribution/deliveries/${id}/deliver`, { method: 'POST', body: JSON.stringify(body) }),
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
