import swaggerJsdoc from 'swagger-jsdoc';
import { apiPaths } from './openapi-paths.js';

const port = process.env.PORT || 5009;

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TradeStratix ERP API',
      version: '1.0.0',
      description:
        'Distribution, Wholesale, Retail & Business Management ERP — Express + Prisma + MySQL. Authorize with Bearer JWT from POST /api/v1/auth/login.'
    },
    servers: [{ url: `http://localhost:${port}`, description: 'Local development' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth' },
      { name: 'Businesses' },
      { name: 'Branches' },
      { name: 'Warehouses' },
      { name: 'Users' },
      { name: 'RBAC' },
      { name: 'Accounting' },
      { name: 'Products' },
      { name: 'Inventory' },
      { name: 'Dashboard' },
      { name: 'Audit' }
    ],
    paths: apiPaths
  },
  apis: ['./src/routes/*.ts', './src/app.ts']
};

export const swaggerSpec = swaggerJsdoc(options);
