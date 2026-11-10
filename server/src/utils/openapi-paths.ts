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
  }
};
