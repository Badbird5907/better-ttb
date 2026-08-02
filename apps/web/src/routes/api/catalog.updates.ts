import type { CatalogDeltaCursor } from "@better-ttb/shared";
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { readCatalogUpdates } from "@/server/catalog-courses";
import { bindings } from "@/server/env";

export const Route = createFileRoute("/api/catalog/updates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sessions = parseSessions(
          url.searchParams.get("sessions") ?? bindings.SESSIONS,
        );
        const updatedAt = url.searchParams.get("afterUpdatedAt");
        const id = url.searchParams.get("afterId") ?? "";
        if (sessions.length === 0 || !updatedAt || !isIsoDate(updatedAt)) {
          return Response.json({ error: "invalid_cursor" }, { status: 400 });
        }
        const cursor: CatalogDeltaCursor = { updatedAt, id };
        const body = await readCatalogUpdates(bindings.DB, sessions, cursor);
        return Response.json(body, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});

function parseSessions(value: string): string[] {
  return value
    .split(",")
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
