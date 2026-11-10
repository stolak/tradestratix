import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';

const PORT = Number(process.env.PORT) || 5008;

app.listen(PORT, () => {
  console.log(`TradeStratix ERP API running on http://localhost:${PORT}`);
  console.log(`REST API:     http://localhost:${PORT}/api/v1`);
  console.log(`Swagger UI:   http://localhost:${PORT}/api-docs`);
  console.log(`Health:      http://localhost:${PORT}/health`);
});
