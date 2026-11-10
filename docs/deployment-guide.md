# Deployment Guide

## Environment

Copy `server/.env` with:

- `PORT=5009`
- `DATABASE_URL=mysql://...`
- `JWT_SECRET=...`
- `CORS_ORIGIN=...`

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
