# better-ttb

UofT timetable builder monorepo.

A fast, keyboard-friendly builder for University of Toronto (St. George) Arts &
Science course timetables, running on Cloudflare Workers.

## Features

- **Builder** (`/`) — searchable course catalog with rich filters, a course
  detail sheet, and per-plan course pinning with section selection and conflict
  detection.
- **Timetable** (`/timetable`) — Fall/Winter week grid, a schedule generator
  with a rule editor, candidate gallery, and preview/apply, plus share, JSON
  export/import, and ICS export.
- **Map** (`/map`) — Leaflet campus map with day-by-day walking routes and tight
  transfer warnings.
- **Shared plans** (`/p/$id`) — read-only view of a shared plan.
- Light / dark / system theme with no-flash startup.

## Setup

This repo uses pnpm (pinned via the `packageManager` field). If pnpm isn't on
your PATH, run `corepack enable` once — modern Node ships with Corepack.

```sh
pnpm install
```

## Commands

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm alchemy
```

`apps/web` is a TanStack Start app targeting Cloudflare Workers through Alchemy. The build script uses plain `vite build`; Alchemy resource deployment is handled by `pnpm alchemy`.

The Alchemy Vite plugin requires Alchemy's generated `.alchemy/local/wrangler.jsonc`. Standalone `pnpm build` skips that plugin; `pnpm alchemy` enables it through Alchemy's build environment.

## Deploy

Deployment provisions the Worker, D1 database, and KV namespace via Alchemy.

One-time setup: `pnpm exec alchemy configure` (select Cloudflare, OAuth login), then
create a root `.env` (gitignored) with:

```
ADMIN_TOKEN=<secret>        # guards the scrape endpoint
ALCHEMY_PASSWORD=<secret>   # encrypts secrets in Alchemy state — keep stable across deploys
```

Then:

```sh
set -a && source .env && set +a && pnpm run deploy
```

(Use `pnpm run deploy`, not `pnpm deploy` — the latter is pnpm's built-in
deploy command, not this script.)

Note: deploy must go through the `alchemy` CLI (the pnpm script does), not plain
`tsx alchemy.run.ts` — the CLI generates `.alchemy/local/wrangler.jsonc`, which
the Alchemy Vite plugin requires during the build.
After the first deploy the catalog is empty — populate it by calling the admin
scrape endpoint. The configured hourly cron resumes a leased D1 scrape run and
starts a new complete run every 24 hours, measured from the prior run's start:

```sh
curl -X POST https://<your-worker>/api/admin/scrape \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The endpoint processes at most 25 pages per call. If the response has
`"status":"running"`, repeat the request until it returns `"status":"complete"`.
Use `{"reset":true}` once after migrating from the legacy KV cursor. Inspect
the active run, recent failures, and compressed catalog manifest with:

```sh
curl https://<your-worker>/api/admin/scrape \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

`GET /api/health` returns HTTP 503 when the catalog is older than 36 hours or
an active scrape has not progressed for two hours.

## Architecture

Turborepo workspace: a TanStack Start (React 19 + Tailwind v4 + shadcn/ui) app
in `apps/web` with server routes on Cloudflare Workers (D1 + KV), sharing
`@better-ttb/shared` types and the `@better-ttb/generator` scheduling engine.
Complete catalogs are stored as versioned gzip blobs in KV. Per-course live
refreshes and completed scrape pages are stored in D1 and delivered as catalog
deltas, so updated rooms, meeting times, instructors, requisites, and enrolment
data survive reload before the next complete catalog publication.

### Walking distances and routes

Back-to-back class walkability uses real pedestrian durations rather than
straight-line estimates:

- `apps/web/src/data/buildings.json` is the runtime source of truth for building
  names and coordinates. It is maintained offline from the original Cobalt
  dataset, TTB-linked Concept3D locations, reviewed overrides, and the LSM
  classroom directory. New LSM-only buildings are geocoded through a cached,
  bounded Nominatim maintenance lookup; the deployed app does not contact these
  sources.
- `tools/walk-matrix.json` (vendored to `apps/web/src/data/walk-matrix.json`) is
  a precomputed `codes × codes` matrix of foot-profile walking seconds between
  every UTSG building, generated from the OSRM foot profile at
  `routing.openstreetmap.de` (FOSSGIS). The web app flattens the relevant pairs
  into the generator's `walkSeconds` config; the `@better-ttb/generator` package
  stays data-free and falls back to a haversine estimate for unknown pairs.
- The `/api/walk-route` worker route fetches live walking geometry from the same OSRM
  service on demand and caches it permanently in KV (`route:v1:<from>:<to>`); the
  `/map` view draws these routes and falls back to a dashed straight line on
  failure.
- UofT classes start 10 minutes after their listed time
  (`UOFT_TRANSFER_GRACE_MINUTES` in `@better-ttb/shared`), so transfer
  feasibility is judged against `(next listed start + 10 min) − prev listed end`.

Routing and matrix data derive from OpenStreetMap (© OpenStreetMap
contributors, ODbL) via OSRM. Coordinates resolved through Nominatim carry the
same OpenStreetMap attribution. Detailed source precedence, caching policy, and
the refresh procedure are documented in `docs/api-notes.md`.
