# TradeStratix ERP

Unified Distribution, Wholesale, Retail, Inventory, Accounting and Business Management platform.

## Stack

- **Client:** React + TypeScript + Vite + Tailwind CSS
- **Server:** Node.js + Express + TypeScript
- **ORM / DB:** Prisma + MySQL
- **API docs:** Swagger UI at `/api-docs`

## Quick start

```bash
# Root tooling
npm install

# Database (creates MySQL DB + pushes schema)
npm run setup:db

# Seed demo tenant + chart of accounts
npm run seed

# Run API (PORT 5008) + client (5176)
npm run dev
```

- API: http://localhost:5009/api/v1  
- Swagger: http://localhost:5009/api-docs  
- Client: http://localhost:5177  

Default seed login: `owner` / `password123`

## Documentation

See `/docs` for architecture, schema, accounting rules, and implementation progress.
