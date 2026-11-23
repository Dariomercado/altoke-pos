# AlToke

A point of sale for small kioscos and neighbourhood shops: it charges, prints an 80 mm ticket, and
keeps working with the internet unplugged.

The counter is the design constraint. A kiosco cashier sells with one hand while the other counts
change, so the screen is a **tactile tray**: categories on the rail, products on the grid, the sale
pinned to the bottom with COBRAR within thumb reach. Nothing on screen moves unless it has to.

> **Status.** The point of sale works end to end — sale, cobro, ticket, cierre de caja — against a
> local event ledger. There is no API and no fiscal integration yet: the ticket is a **ticket
> interno**, and it says so on the paper.

## What it does

- **Sells and charges.** The shelf price already includes IVA, and the IVA is inverted out of it, so
  the number the customer pays is the number that gets printed. Money is integer cents everywhere.
- **Writes to a local ledger.** Every sale, shift opening and shift closing is an event in an
  append-only ledger persisted in IndexedDB, one database per tenant. Stock and shift totals are
  projections of that ledger, never a second source of truth.
- **Refuses a bad sale.** Without an open shift it does not charge. If the payments do not cover the
  total it does not confirm, and it says how much is missing.
- **Prints at 80 mm.** `@page 80mm auto`, 72 mm of useful width (the thermal head does not reach the
  rest), monospace and tabular figures so the money column lines up. Printing hides everything else
  in the app, so the paper is the only thing that comes out.
- **Closes the shift by denomination.** One row per bill and coin, a running count, and a verdict —
  cuadrado, faltante or sobrante — with the word, the sign and the colour, never colour alone.
- **Wears the tenant's brand.** Five CSS holes (`--brand-primary/accent/surface/text/logo`) restyle
  the POS and the ticket at once, and a contrast guard rejects a brand that would make the counter
  illegible.

## Run it

Requires **Node ≥ 22** and **pnpm 12** (`packageManager` is pinned in `package.json`).

```bash
pnpm install
pnpm --filter @altoke/web dev     # the POS on http://localhost:5173
```

Open the till, and start selling. Data lives in your browser's IndexedDB: to start from scratch,
clear the site storage for localhost.

### The API

M2 adds `apps/api` (Fastify + Postgres) for sync and auth. It needs a database:

```bash
pnpm db:up        # Postgres 16 on port 5435, database/user altoke
pnpm db:migrate   # applies apps/api/migrations in order
pnpm dev:api      # the API on http://localhost:3001, GET /salud reports the database
pnpm db:down
```

Migrations run as the database owner; the API connects as `altoke_app`, a role without ownership or
DDL, so row-level security actually isolates tenants instead of being decorative. `MIGRATIONS_DATABASE_URL`
defaults to `DATABASE_URL`; on a server they differ. Configuration is plain environment variables —
no dotenv: `node --env-file=.env src/index.ts`.

### Checks

```bash
pnpm typecheck                    # tsc --noEmit, whole workspace
pnpm test                         # vitest, whole workspace
pnpm lint                         # eslint
pnpm --filter @altoke/web build   # production bundle
```

## Layout

```
apps/web                 the POS: screens, cobro sheet, cierre, 80 mm ticket
apps/api                 Fastify + Postgres: sync between terminals, auth, fiscal outbox (M2)
packages/domain          pure logic — money, event ledger, projections, arqueo. No IO.
packages/store           persistence ports and their adapters (in-memory, IndexedDB)
packages/ui              design tokens and shared components
packages/contracts       zod schemas shared between web and api
docs/specs               architecture (0001), fiscal/cobros (0002), API and sync (0003)
design/                  the design system board and the POS artboards
odd/tasks/               the task records: specs, tasks and the log of each feature
```

Two rules hold the thing together:

1. **`packages/domain` does not import React.** A lint rule enforces it.
2. **Only `apps/web/src/pos/caja.ts` writes events.** It is the only code that knows the rules of a
   shift, so the invariants above live in one place.

## Design

`design/system.md` is synced from `packages/ui/src/tokens.css`, so the design system cannot drift
from the code: the tokens are the source and the board is generated from them. The artboards in
`design/pos-kiosco/` are the visual contract for the sale, cobro, ticket and cierre screens.

Invariants the UI does not get to break: focus is always visible, scrollbars stay visible, text
contrast is AA, state is never communicated by colour alone, and motion — only `transform` and
`opacity`, three moments, all of it disabled under `prefers-reduced-motion`.

**Offline is a feature, not a fallback.** No remote fonts, no CDN, no external images: the app boots
with the network down because there is nothing to fetch.

## Roadmap

- **M2** — API and sync between terminals, fiscal outbox, `schemaVersion` migration on read, tenant
  validation on read.
- Reopening and voiding sales from the screen (`caja.anular` exists and is tested; it has no screen).

## License

No license file yet: all rights reserved.
