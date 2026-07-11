# API Notes

These notes document reverse-engineered, unofficial APIs used by better-ttb for maintenance purposes.

## TTB access model

The University of Toronto Timetable Builder API is available server-side at `https://api.easi.utoronto.ca/ttb` without auth or cookies, but it is not usable directly from the browser. CORS is locked to `https://ttb.utoronto.ca`; other origins can receive HTTP 200 with an empty body and no CORS headers. better-ttb therefore needs a server proxy for live reads and a scheduled scraper for catalog data.

## Pagination and scraping

`POST /getPageableCourses` has a server-side `pageSize` hard cap of 20. A full ARTSC Fall-Winter scrape for `20269`, `20271`, and `20269-20271` is about 3,751 courses, or roughly 188 page requests.

The scraper should run in chunks:

- Store progress in a KV cursor: sessions, division, current page, total if known, and scrape artifact id.
- Process at most about 40 TTB pages per invocation to stay below Cloudflare free-plan limits, especially the 50-subrequest ceiling.
- Resume from cron or `POST /api/admin/scrape`; allow `reset` to discard the cursor and start from page 1.
- Detect completion when a page returns fewer than 20 courses, or when the known `total` has been consumed.

No rate limit was observed in testing, but bursts should stay modest. Avoid proxying bulk user traffic live when a nightly artifact is enough.

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

The primary buildings dataset is vendored rather than loaded from Concept3D at runtime. Provenance:

- `cobalt-uoft/datasets`, filtered to UTSG buildings.
- Hand patches for post-2017 buildings and known naming/code gaps.
- Concept3D behind `map.utoronto.ca` can be used as reference material for one-off refreshes.

Concept3D's observed public embedded key is `0001085cc708b9cef47080f064612ca5`. Treat it as unofficial and unstable.
