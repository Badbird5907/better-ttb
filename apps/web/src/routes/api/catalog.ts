import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";
import { catalogKey, catalogMetaKey } from "@/server/scraper";

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

        const key = catalogKey(sessions);
        const [catalog, rawMeta] = await Promise.all([
          bindings.KV.get(key),
          bindings.KV.get(catalogMetaKey(sessions)),
        ]);

        if (!catalog) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }

        const meta = parseCatalogMeta(rawMeta);
        const etag = meta ? formatEtag(meta.etag) : undefined;
        const headers = new Headers({
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=0, must-revalidate",
        });

        if (etag) {
          headers.set("ETag", etag);

          if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
            return new Response(null, {
              status: 304,
              headers,
            });
          }
        }

        return new Response(catalog, { headers });
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

function parseCatalogMeta(
  value: string | null,
): { etag: string; scrapedAt: string; total: number } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    const { etag, scrapedAt, total } = parsed;

    if (
      typeof etag !== "string" ||
      typeof scrapedAt !== "string" ||
      typeof total !== "number"
    ) {
      return null;
    }

    return { etag, scrapedAt, total };
  } catch {
    return null;
  }
}

function formatEtag(value: string): string {
  return `"${value.replaceAll('"', "")}"`;
}

function matchesIfNoneMatch(value: string | null, etag: string): boolean {
  return (
    value
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === etag || candidate === "*") ?? false
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
