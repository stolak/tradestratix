/**
 * Demo one-click login is for local/dev only.
 * Production: off unless ENABLE_DEMO_LOGIN=true (explicit opt-in).
 * Non-production: on unless ENABLE_DEMO_LOGIN=false.
 */
export function isDemoLoginEnabled(): boolean {
  const flag = process.env.ENABLE_DEMO_LOGIN?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}
