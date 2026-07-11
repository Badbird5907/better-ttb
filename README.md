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

```sh
npm install
```

## Commands

```sh
npm run dev
npm run typecheck
npm run test
npm run build
npm run alchemy
```

`apps/web` is a TanStack Start app targeting Cloudflare Workers through Alchemy. The build script uses plain `vite build`; Alchemy resource deployment is handled by `npm run alchemy`.

The Alchemy Vite plugin requires Alchemy's generated `.alchemy/local/wrangler.jsonc`. Standalone `npm run build` skips that plugin; `npm run alchemy` enables it through Alchemy's build environment.

## Deploy

Deployment provisions the Worker, D1 database, and KV namespace via Alchemy:

```sh
ADMIN_TOKEN=<secret> npm run deploy   # or: npm run alchemy
```

Set the `ADMIN_TOKEN` secret before deploying; it guards the scrape endpoint.
After the first deploy the catalog is empty — populate it by calling the admin
scrape endpoint (also run daily by the configured cron):

```sh
curl -X POST https://<your-worker>/api/admin/scrape \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Architecture

Turborepo workspace: a TanStack Start (React 19 + Tailwind v4 + shadcn/ui) app
in `apps/web` with server routes on Cloudflare Workers (D1 + KV), sharing
`@better-ttb/shared` types and the `@better-ttb/generator` scheduling engine.
