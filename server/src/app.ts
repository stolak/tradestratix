import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import apiRouter from './routes/index.js';
import { swaggerSpec } from './utils/swagger.js';

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5177,http://localhost:5009')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id']
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Dashboard]
 *     security: []
 *     summary: Health check
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    application: 'TradeStratix ERP',
    database: 'MySQL (Prisma)',
    api: '/api/v1',
    timestamp: new Date().toISOString()
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

app.use('/api/v1', apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large (max 8 MB)' });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message || 'Request failed'
  });
});

export default app;
