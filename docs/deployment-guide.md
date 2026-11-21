# Deployment Guide

## Environment

Copy `server/.env` with:

- `PORT=5009`
- `DATABASE_URL=mysql://...`
- `JWT_SECRET=...` (required; no default — server refuses to start without it)
- `JWT_EXPIRES_IN=12h` (optional; access token lifetime)
- `CORS_ORIGIN=...` (comma-separated allowlist; unknown origins are denied)
- `ENABLE_DEMO_LOGIN=false` (keep off in production; `/auth/demo-users` is blocked unless explicitly `true`)
- `LOGIN_RATE_LIMIT_MAX=30` (optional; login attempts per 15 minutes per IP)
- `TRUST_PROXY=true` (set when the API sits behind nginx/CDN so rate limits use the real client IP)

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
