/** Static OpenAPI path catalogue (enriched by route @openapi comments). */
export const apiPaths: Record<string, unknown> = {
  '/health': {
    get: {
      tags: ['Dashboard'],
      security: [],
      summary: 'Health check',
      responses: { 200: { description: 'OK' } }
    }
  },
  '/api/v1/auth/login': {
    post: {
      tags: ['Auth'],
      security: [],
      summary: 'Login',
      responses: { 200: { description: 'JWT + user' } }
    }
  },
  '/api/v1/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Current user',
      responses: { 200: { description: 'User profile' } }
    }
  },
  '/api/v1/businesses/current': {
    get: {
      tags: ['Businesses'],
      summary: 'Current business profile',
      responses: { 200: { description: 'Business' } }
    }
  },
  '/api/v1/branches': {
    get: {
      tags: ['Branches'],
      summary: 'List branches',
      responses: { 200: { description: 'Branch list' } }
    },
    post: {
      tags: ['Branches'],
      summary: 'Create branch',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/warehouses': {
    get: {
      tags: ['Warehouses'],
      summary: 'List warehouses',
      responses: { 200: { description: 'Warehouse list' } }
    },
    post: {
      tags: ['Warehouses'],
      summary: 'Create warehouse',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/accounting/accounts': {
    get: {
      tags: ['Accounting'],
      summary: 'Chart of accounts',
      responses: { 200: { description: 'Accounts' } }
    }
  },
  '/api/v1/suppliers': {
    get: {
      tags: ['Suppliers'],
      summary: 'List suppliers',
      responses: { 200: { description: 'Supplier list' } }
    },
    post: {
      tags: ['Suppliers'],
      summary: 'Create supplier',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/purchases/orders': {
    get: {
      tags: ['Purchases'],
      summary: 'List purchase orders',
      responses: { 200: { description: 'PO list' } }
    },
    post: {
      tags: ['Purchases'],
      summary: 'Create purchase order',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/purchases/receipts': {
    get: {
      tags: ['Purchases'],
      summary: 'List goods receipts',
      responses: { 200: { description: 'GRN list' } }
    },
    post: {
      tags: ['Purchases'],
      summary: 'Post GRN against PO (stock + AP)',
      responses: { 201: { description: 'Posted' } }
    }
  },
  '/api/v1/purchases/bills': {
    get: {
      tags: ['Purchases'],
      summary: 'List supplier bills',
      responses: { 200: { description: 'AP bills' } }
    }
  },
  '/api/v1/purchases/payments': {
    get: {
      tags: ['Purchases'],
      summary: 'List supplier payments',
      responses: { 200: { description: 'Payments' } }
    },
    post: {
      tags: ['Purchases'],
      summary: 'Record supplier payment',
      responses: { 201: { description: 'Posted' } }
    }
  },
  '/api/v1/customers': {
    get: {
      tags: ['Customers'],
      summary: 'List customers',
      responses: { 200: { description: 'Customer list' } }
    },
    post: {
      tags: ['Customers'],
      summary: 'Create customer',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/sales/invoices': {
    get: {
      tags: ['Sales'],
      summary: 'List sales invoices',
      responses: { 200: { description: 'Invoice list' } }
    },
    post: {
      tags: ['Sales'],
      summary: 'Create sales invoice (draft or auto-post)',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/sales/pos': {
    post: {
      tags: ['POS'],
      summary: 'Create and settle POS sale',
      responses: { 201: { description: 'Posted & paid' } }
    }
  },
  '/api/v1/sales/payments': {
    get: {
      tags: ['Sales'],
      summary: 'List customer payments',
      responses: { 200: { description: 'Payments' } }
    },
    post: {
      tags: ['Sales'],
      summary: 'Record customer payment against AR',
      responses: { 201: { description: 'Posted' } }
    }
  },
  '/api/v1/sales-reps': {
    get: {
      tags: ['Sales Reps'],
      summary: 'List sales reps',
      responses: { 200: { description: 'Rep list' } }
    },
    post: {
      tags: ['Sales Reps'],
      summary: 'Create sales rep',
      responses: { 201: { description: 'Created' } }
    }
  }
};
