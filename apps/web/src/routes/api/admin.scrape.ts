import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";
import {
  abandonActiveRun,
  createWorkerScraperDeps,
  getScrapeStatus,
  runScrapeChunk,
  SCRAPE_CURSOR_KEY,
} from "@/server/scraper";
import { readCatalogManifest } from "@/server/catalog-storage";

export const Route = createFileRoute("/api/admin/scrape")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const url = new URL(request.url);
        const sessions = parseSessions(
          url.searchParams.get("sessions")?.split(","),
          bindings.SESSIONS,
        );
        const [status, manifest, legacyCursor] = await Promise.all([
          getScrapeStatus(createWorkerScraperDeps(bindings).db, sessions),
          readCatalogManifest(bindings.KV, sessions),
          bindings.KV.get(SCRAPE_CURSOR_KEY),
        ]);
        return Response.json({
          ...status,
          manifest,
          legacyCursorPresent: legacyCursor !== null,
        });
      },
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const body = await readJsonBody(request);

        if (body === false) {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const sessions = parseSessions(body?.sessions, bindings.SESSIONS);
        const maxPages = parseMaxPages(body?.maxPages);

        if (body?.reset === true) {
          await abandonActiveRun(
            createWorkerScraperDeps(bindings).db,
            sessions,
          );
          await bindings.KV.delete(SCRAPE_CURSOR_KEY);
        }

        const result = await runScrapeChunk(
          maxPages
            ? { sessions, maxPages, triggerSource: "manual" }
            : { sessions, triggerSource: "manual" },
          createWorkerScraperDeps(bindings),
        );

        return Response.json(result, { status: 202 });
      },
    },
  },
});

interface AdminScrapeBody {
  sessions?: string[];
  maxPages?: number;
  reset?: boolean;
}

async function readJsonBody(request: Request): Promise<AdminScrapeBody | null | false> {
  const rawBody = await request.text();

  if (rawBody.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;

    if (!isRecord(parsed)) {
      return false;
    }

    const body: AdminScrapeBody = {};

    if (
      Array.isArray(parsed.sessions) &&
      parsed.sessions.every((session) => typeof session === "string")
    ) {
      body.sessions = parsed.sessions;
    }

    if (typeof parsed.maxPages === "number") {
      body.maxPages = parsed.maxPages;
    }

    if (typeof parsed.reset === "boolean") {
      body.reset = parsed.reset;
    }

    return body;
  } catch {
    return false;
  }
}

function parseSessions(value: unknown, fallback: string): string[] {
  if (Array.isArray(value)) {
    return value
      .map((session) => session.trim())
      .filter((session) => session.length > 0);
  }

  return fallback
    .split(",")
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
}

function parseMaxPages(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(25, Math.max(1, Math.floor(value)));
}

function isAuthorized(request: Request): boolean {
  return (
    request.headers.get("Authorization") === `Bearer ${bindings.ADMIN_TOKEN}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
