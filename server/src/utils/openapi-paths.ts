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
  },
  '/api/v1/assets': {
    get: {
      tags: ['Assets'],
      summary: 'List fixed assets',
      responses: { 200: { description: 'Asset list' } }
    },
    post: {
      tags: ['Assets'],
      summary: 'Create fixed asset (optional acquisition journal)',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/assets/depreciation/run': {
    post: {
      tags: ['Assets'],
      summary: 'Run monthly straight-line depreciation',
      responses: { 200: { description: 'Depreciation entries posted' } }
    }
  },
  '/api/v1/assets/depreciation/entries': {
    get: {
      tags: ['Assets'],
      summary: 'List depreciation entries',
      responses: { 200: { description: 'Entries' } }
    }
  },
  '/api/v1/budgets': {
    get: {
      tags: ['Accounting'],
      summary: 'List budgets',
      responses: { 200: { description: 'Budget list' } }
    },
    post: {
      tags: ['Accounting'],
      summary: 'Create budget with lines',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/budgets/{id}/vs-actual': {
    get: {
      tags: ['Accounting'],
      summary: 'Budget vs actual for fiscal year',
      responses: { 200: { description: 'Comparison by account' } }
    }
  },
  '/api/v1/hr/employees': {
    get: {
      tags: ['HR'],
      summary: 'List employees',
      responses: { 200: { description: 'Employee list' } }
    },
    post: {
      tags: ['HR'],
      summary: 'Create employee',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/hr/attendance': {
    get: {
      tags: ['HR'],
      summary: 'List attendance records',
      responses: { 200: { description: 'Attendance' } }
    },
    post: {
      tags: ['HR'],
      summary: 'Upsert attendance for employee/date',
      responses: { 201: { description: 'Saved' } }
    }
  },
  '/api/v1/hr/leave': {
    get: {
      tags: ['HR'],
      summary: 'List leave requests',
      responses: { 200: { description: 'Leave list' } }
    },
    post: {
      tags: ['HR'],
      summary: 'Create leave request',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/payroll/runs': {
    get: {
      tags: ['Payroll'],
      summary: 'List payroll runs',
      responses: { 200: { description: 'Payroll runs' } }
    },
    post: {
      tags: ['Payroll'],
      summary: 'Create payroll run from active employees',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/payroll/runs/{id}/post': {
    post: {
      tags: ['Payroll'],
      summary: 'Post payroll journal (expense / payables)',
      responses: { 200: { description: 'Posted' } }
    }
  },
  '/api/v1/payroll/runs/{id}/pay': {
    post: {
      tags: ['Payroll'],
      summary: 'Pay net salaries from bank/cash',
      responses: { 200: { description: 'Paid' } }
    }
  },
  '/api/v1/distribution/vehicles': {
    get: {
      tags: ['Distribution'],
      summary: 'List vehicles',
      responses: { 200: { description: 'Vehicle list' } }
    },
    post: {
      tags: ['Distribution'],
      summary: 'Create vehicle',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/distribution/vehicles/{id}': {
    patch: {
      tags: ['Distribution'],
      summary: 'Update vehicle',
      responses: { 200: { description: 'Updated' } }
    }
  },
  '/api/v1/distribution/deliveries': {
    get: {
      tags: ['Distribution'],
      summary: 'List delivery orders (filter by status)',
      responses: { 200: { description: 'Delivery list' } }
    },
    post: {
      tags: ['Distribution'],
      summary: 'Create delivery (from invoice or items)',
      responses: { 201: { description: 'Created' } }
    }
  },
  '/api/v1/distribution/deliveries/{id}/schedule': {
    post: {
      tags: ['Distribution'],
      summary: 'Schedule delivery',
      responses: { 200: { description: 'Scheduled' } }
    }
  },
  '/api/v1/distribution/deliveries/{id}/dispatch': {
    post: {
      tags: ['Distribution'],
      summary: 'Dispatch delivery',
      responses: { 200: { description: 'Dispatched' } }
    }
  },
  '/api/v1/distribution/deliveries/{id}/deliver': {
    post: {
      tags: ['Distribution'],
      summary: 'Mark delivery delivered',
      responses: { 200: { description: 'Delivered' } }
    }
  },
  '/api/v1/distribution/deliveries/{id}/cancel': {
    post: {
      tags: ['Distribution'],
      summary: 'Cancel delivery',
      responses: { 200: { description: 'Cancelled' } }
    }
  },
  '/api/v1/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List in-app notifications',
      responses: { 200: { description: 'Notification list' } }
    }
  },
  '/api/v1/notifications/{id}/read': {
    post: {
      tags: ['Notifications'],
      summary: 'Mark notification read',
      responses: { 200: { description: 'Updated' } }
    }
  },
  '/api/v1/notifications/read-all': {
    post: {
      tags: ['Notifications'],
      summary: 'Mark all notifications read',
      responses: { 200: { description: 'Updated count' } }
    }
  },
  '/api/v1/bi/insights': {
    get: {
      tags: ['BI'],
      summary: 'Business intelligence insight aggregates',
      responses: { 200: { description: 'Insights' } }
    }
  },
  '/api/v1/subscriptions/plans': {
    get: {
      tags: ['Subscriptions'],
      summary: 'List active SaaS subscription plans',
      responses: { 200: { description: 'Plans' } }
    }
  },
  '/api/v1/subscriptions/current': {
    get: {
      tags: ['Subscriptions'],
      summary: 'Current business subscription',
      responses: { 200: { description: 'Subscription or null' } }
    }
  },
  '/api/v1/mobile/home': {
    get: {
      tags: ['Mobile'],
      summary: 'Field-app dashboard lite',
      responses: { 200: { description: 'Home summary' } }
    }
  },
  '/api/v1/mobile/deliveries': {
    get: {
      tags: ['Mobile'],
      summary: 'Open/assigned deliveries for field app',
      responses: { 200: { description: 'Delivery list' } }
    }
  },
  '/api/v1/mobile/deliveries/{id}/deliver': {
    post: {
      tags: ['Mobile'],
      summary: 'Mark delivery delivered (mobile)',
      responses: { 200: { description: 'Delivered' } }
    }
  }
};
