import type { CatalogHealthResponse } from "@better-ttb/shared";
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { readCatalogSummary } from "@/server/catalog-storage";
import { bindings } from "@/server/env";
import { countFailuresSinceLatestSuccess } from "@/server/scrape-health";
import { createWorkerScraperDeps, getScrapeStatus } from "@/server/scraper";

const CATALOG_STALE_MS = 36 * 60 * 60 * 1000;
const SCRAPE_STALLED_MS = 2 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const sessions = bindings.SESSIONS.split(",")
          .map((session) => session.trim())
          .filter(Boolean);
        const [catalogSummary, status] = await Promise.all([
          readCatalogSummary(bindings.KV, sessions),
          getScrapeStatus(createWorkerScraperDeps(bindings).db, sessions),
        ]);
        const now = Date.now();
        const scrapedAt = catalogSummary?.scrapedAt ?? null;
        const scrapedMillis = scrapedAt ? Date.parse(scrapedAt) : Number.NaN;
        const ageSeconds = Number.isFinite(scrapedMillis)
          ? Math.max(0, Math.floor((now - scrapedMillis) / 1_000))
          : null;
        const stale = ageSeconds === null || ageSeconds * 1_000 > CATALOG_STALE_MS;
        const active = status.active;
        const progressMillis = active?.last_progress_at
          ? Date.parse(active.last_progress_at)
          : active?.started_at
            ? Date.parse(active.started_at)
            : Number.NaN;
        const stalled =
          Boolean(active) &&
          (!Number.isFinite(progressMillis) || now - progressMillis > SCRAPE_STALLED_MS);
        const failedRecently = countFailuresSinceLatestSuccess(status.recent, now);
        const body: CatalogHealthResponse = {
          ok: !stale && !stalled && failedRecently < 2,
          catalog: { scrapedAt, ageSeconds, stale },
          scrape: {
            status: active?.status ?? status.recent[0]?.status ?? null,
            pagesDone: active?.pages_done ?? null,
            totalPages: active?.total_pages ?? null,
            lastProgressAt: active?.last_progress_at ?? null,
            stalled,
          },
        };
        return Response.json(body, { status: body.ok ? 200 : 503 });
      },
    },
  },
});
