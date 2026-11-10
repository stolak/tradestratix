# TradeStratix Guidelines

- Follow layered architecture: routes → controllers → services → Prisma.
- Enforce tenant isolation on every query.
- Never mutate stock outside inventory services.
- Never post unbalanced journals; never mutate posted journals.
- Prefer decimal-safe money helpers over raw floats.
- Update `docs/implementation-progress.md` after milestones.
