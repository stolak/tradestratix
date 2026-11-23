# Deployment Guide

## Environment

Copy `server/.env` with:

- `PORT=5009`
- `DATABASE_URL=mysql://...`
- `JWT_SECRET=...` (required; no default — server refuses to start without it)
- `JWT_EXPIRES_IN=12h` (optional; access token lifetime)
- `CORS_ORIGIN=...` (comma-separated allowlist; unknown origins are denied)
- `ENABLE_DEMO_LOGIN=false` (keep off in production; `/auth/demo-users` is blocked unless explicitly `true`; when true, MFA uses fixed demo code `000000`)
- `LOGIN_RATE_LIMIT_MAX=30` (optional; login attempts per 15 minutes per IP)
- `TRUST_PROXY=true` (set when the API sits behind nginx/CDN so rate limits use the real client IP)
- `APP_URL=https://app.example.com` (client origin used in staff password-setup invite links)
- `MAIL_HOST` / `MAIL_PORT` / `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_FROM_ADDRESS` / `MAIL_ENCRYPTION` (SMTP for staff invites)

### MFA

- Role list is stored per business in setting `mfa_required_roles` (JSON array), editable under **Business settings**.
- After password login, matching roles must call `POST /api/v1/auth/mfa/verify` with `mfa_token` + 6-digit `code`.
- With demo login enabled, the UI shows code `000000`. Without demo mode, the OTP is logged server-side until email delivery is wired.

## Database

```bash
npm run setup:db
npm run seed
```

## Process

- Build server: `npm run build:server`
- Build client: `npm run build`
- Serve API with Node; host client static assets behind nginx or CDN

Rotate any credentials that were shared in plaintext during setup.
