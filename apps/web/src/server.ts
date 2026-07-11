import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import type { Env } from "./server/env";
import { createWorkerScraperDeps, runScrapeChunk } from "./server/scraper";

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
      runScrapeChunk(
        { sessions: parseSessions(env.SESSIONS) },
        createWorkerScraperDeps(env),
      ).then(() => undefined),
    );
  },
} satisfies ExportedHandler<Env>;

function parseSessions(value: string): string[] {
  return value
    .split(",")
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
}
