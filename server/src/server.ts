import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { expireReservations } from './services/sales-order.service.js';

const PORT = Number(process.env.PORT) || 5009;
const RESERVATION_SWEEP_MS = Number(process.env.RESERVATION_SWEEP_MS) || 15 * 60 * 1000;

app.listen(PORT, () => {
  console.log(`TradeStratix ERP API running on http://localhost:${PORT}`);
  console.log(`REST API:     http://localhost:${PORT}/api/v1`);
  console.log(`Swagger UI:   http://localhost:${PORT}/api-docs`);
  console.log(`Health:      http://localhost:${PORT}/health`);
});

let sweeping = false;
setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const { expired } = await expireReservations();
    if (expired) console.log(`Reservation sweep: released ${expired} expired pickup order(s)`);
  } catch (err) {
    console.error('Reservation sweep failed', err);
  } finally {
    sweeping = false;
  }
}, RESERVATION_SWEEP_MS).unref();
