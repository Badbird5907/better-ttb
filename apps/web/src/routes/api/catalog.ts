import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { getCatalogResponse } from "@/server/catalog-storage";
import { bindings } from "@/server/env";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sessions = parseSessions(
          url.searchParams.get("sessions") ?? bindings.SESSIONS,
        );
        if (sessions.length === 0) {
          return Response.json({ error: "invalid_sessions" }, { status: 400 });
        }
        const response = await getCatalogResponse(bindings.KV, sessions, request);
        return response ?? Response.json({ error: "not_found" }, { status: 404 });
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
