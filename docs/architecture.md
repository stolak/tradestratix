# TradeStratix Architecture

## Style

Modular monolith with layered boundaries:

1. **Presentation** — React client (`client/`)
2. **API / Controllers** — Express handlers (`server/src/controllers`)
3. **Application / Services** — business logic & Prisma (`server/src/services`)
4. **Domain rules** — inventory posting, accounting engine, RBAC, approvals
5. **Data** — MySQL via Prisma
6. **Infrastructure** — mail, S3, jobs, Swagger

## Multi-tenancy

- Root tenant entity: `Business`
- Every operational table carries `businessId`
- JWT includes `businessId`, `userId`, role codes, and optional branch scope
- Queries always filter by tenant; cross-tenant access is rejected in middleware/services

## Multi-branch (mandatory)

- Every business has ≥1 active branch (default **Head Office / HQ** on onboarding)
- Operational transactions carry `branchId` (inventory transfers also keep `fromBranchId` / `toBranchId`)
- Users ↔ branches via `UserBranch` (businessId, roleCode, status, assignedAt/By)
- Active branch selected via `X-Branch-Id` header; membership re-checked on every request from DB (revocation-safe)
- `POST /auth/switch-branch` issues a new token with `activeBranchId`
- List/report APIs scope to the active branch unless consolidated access (`business_owner` / cross-branch roles / `branches.report_all`)
- Deactivated branches reject new writes; historical rows remain; last active branch cannot be deactivated

## API

- Base path: `/api/v1`
- Auth: Bearer JWT
- Docs: OpenAPI 3 via Swagger UI (`/api-docs`)
- Consistent snake_case JSON responses (`serialize` helper)

## Critical engines (designed early)

| Engine | Responsibility |
|--------|----------------|
| Inventory service | Sole path for stock quantity changes |
| Accounting posting engine | Balanced, idempotent journals; immutable when posted |
| Permission service | RBAC + data-level restrictions |
| Audit logger | Append-only activity trail |

## Frontend

- Vite + React + TypeScript + Tailwind
- AuthContext + session storage
- Module navigation gated by permissions and subscription modules
- Portals grouped under `src/app/pages`

## Ports

- API default: **5009**
- Client Vite: **5177**
