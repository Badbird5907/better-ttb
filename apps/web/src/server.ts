import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import type { Env } from "./server/env";
import { createWorkerScraperDeps, runScheduledScrape } from "./server/scraper";

const start = createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});

export default {
  fetch(request) {
    return start.fetch(request);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runScheduledScrape(
        { sessions: parseSessions(env.SESSIONS) },
        createWorkerScraperDeps(env),
      )
        .then((result) => {
          if (result === null) {
            console.info(
              "Catalog scrape skipped because the published catalog is fresh",
            );
            return;
          }

          console.info("Catalog scrape chunk finished", {
            status: result.status,
            pagesDone: result.pagesDone,
            total: result.total,
            nextPage: result.cursor?.page ?? null,
            runId: result.cursor?.runId ?? null,
          });
        })
        .catch((error: unknown) => {
          console.error("Catalog scrape chunk failed", error);
          throw error;
        }),
    );
  },
} satisfies ExportedHandler<Env>;

function parseSessions(value: string): string[] {
  return value
    .split(",")
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
}
