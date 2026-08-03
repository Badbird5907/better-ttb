# API Notes

These notes document reverse-engineered, unofficial APIs used by better-ttb for maintenance purposes.

## TTB access model

The University of Toronto Timetable Builder API is available server-side at `https://api.easi.utoronto.ca/ttb` without auth or cookies, but it is not usable directly from the browser. CORS is locked to `https://ttb.utoronto.ca`; other origins can receive HTTP 200 with an empty body and no CORS headers. better-ttb therefore needs a server proxy for live reads and a scheduled scraper for catalog data.

## Pagination and scraping

`POST /getPageableCourses` has a server-side `pageSize` hard cap of 20. A full ARTSC Fall-Winter scrape for `20269`, `20271`, and `20269-20271` is about 3,751 courses, or roughly 188 page requests.

The scraper runs in D1-backed chunks:

- Store progress, leases, failures, and timestamps in `scrape_runs`; only one running row is allowed per session set.
- Process at most 25 TTB pages and 45 upstream attempts per invocation, leaving room below Cloudflare's external-subrequest ceiling.
- Resume from cron or `POST /api/admin/scrape`; `reset` abandons the active run and starts from page 1.
- Detect completion when a page returns fewer than 20 courses, or when the known `total` has been consumed.
- Commit each page's course upserts and progress update in one D1 batch transaction.

No rate limit was observed in testing, but bursts should stay modest. Avoid proxying bulk user traffic live when a nightly artifact is enough.

The Cloudflare cron trigger is declared in `alchemy.run.ts` and handled by `apps/web/src/server.ts`. It resumes active work hourly and starts complete runs on a 24-hour cadence based on the prior successful run's start time.

## Catalog publication and deltas

Complete artifacts are gzip-compressed and stored under versioned KV blob keys.
A small manifest points to the active and previous versions so readers can fall
back while KV changes propagate. The legacy uncompressed key remains readable
during rollout. Catalog responses use a weak ETag and accept both weak and
strong `If-None-Match` forms.

Every scraper page updates complete course JSON in D1. `GET
/api/catalog/updates` exposes rows newer than a `(updated_at, id)` cursor in
pages of 500. Clients merge these deltas with the base catalog and persist the
result in IndexedDB.

`POST /api/course/{code}` performs a shared durable refresh. It replaces the
entire course payload—including rooms, times, instructors, section topology,
requisites, notes, enrolment controls, and seat/waitlist state—while preserving
the row's scrape-run ownership. Refreshes have a per-course 30-minute freshness
window. Fresh cached reads bypass the per-IP limiter; only the request that wins
the refresh claim and contacts TTB consumes rate-limit capacity.

## TTB semantics

No results use HTTP 404 with the internal 4404 shape:

```json
{"payload":null,"status":[{"code":4404}]}
```

The search term should be sent in both `courseCodeAndTitleProps.courseCode` and `courseCodeAndTitleProps.courseTitle`, matching the official SPA. `page` is 1-indexed.

Session codes use `{year}{month}`:

- `20269`: Fall 2026
- `20271`: Winter 2027
- `20269-20271`: Fall-Winter 2026-2027 year-long

Future terms should be configured from `GET /reference-data`, not guessed from the calendar alone. Meeting `day` values are `1=Monday` through `7=Sunday`; `millisofday` is milliseconds since midnight.

## Buildings

The primary buildings dataset is vendored rather than loaded from any upstream service at runtime.
The app reads `apps/web/src/data/buildings.json`; its map, generator, walk connector, and
`/api/walk-route` validation all resolve building codes from that file.

Maintenance provenance and resolution order:

- `cobalt-uoft/datasets`, filtered to UTSG buildings.
- TTB meeting `buildingUrl` IDs joined to the Concept3D locations API.
- Reviewed overrides in `tools/building-overrides.json` for known code/source gaps.
- The LSM classroom directory for supplemental building codes, names, and addresses.
- OpenStreetMap Nominatim for new LSM buildings that lack Concept3D IDs.

`tools/refresh-buildings.mjs` writes a review artifact to
`tools/buildings.refreshed.json`; it never changes the app dataset directly. The refresh fails
before publishing the artifact when a geographic code cannot be resolved. Known non-geographic
TTB encodings, currently `ON` + `LINE`, are reported separately and excluded from the geographic
dataset.

LSM is a useful but incomplete source: it lists centrally managed classroom buildings and rooms,
not every UTSG location, and it does not provide coordinates. The refresh only fetches an LSM
building detail page when a new code needs metadata for geocoding.

Nominatim is maintenance-only and is never called by the application. The script:

- sends an identifying `better-ttb-building-refresh` User-Agent;
- uses a Canada-only, UTSG-bounded search;
- accepts only one strong building-name match and fails ambiguous results for review;
- runs requests sequentially with at least 1.1 seconds between cache misses;
- stores responses in `tools/nominatim-cache.json`, retaining positive results and retrying
  negative results only after 30 days; and
- allows the provider base URL to be changed with `NOMINATIM_BASE_URL`.

The public Nominatim service is capacity-constrained. Keep this as a manually invoked, cached
maintenance task and follow the current policy at
`https://operations.osmfoundation.org/policies/nominatim/`. Nominatim/OpenStreetMap data is ODbL
licensed and requires OpenStreetMap attribution.

Maintenance sequence:

1. Run `pnpm buildings:refresh`.
2. Review `tools/buildings.refreshed.json` and the printed resolution report.
3. Copy the reviewed file to `apps/web/src/data/buildings.json`.
4. Run `pnpm buildings:matrix`.
5. Review and copy `tools/walk-matrix.json` to `apps/web/src/data/walk-matrix.json`.
6. Run tests, typecheck, and build; the data tests require the building and matrix code lists to
   match exactly.

Concept3D's observed public embedded key is `0001085cc708b9cef47080f064612ca5`. Treat it as unofficial and unstable.
