import type { Course } from "@better-ttb/shared";
import { create } from "zustand";

import { getCatalogCache, putCatalogCache } from "@/lib/idb";
import { getCourseLevel } from "@/lib/search";

export type CatalogStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface CatalogArtifact {
  sessions: string[];
  scrapedAt: string;
  total: number;
  courses: Course[];
}

export interface CatalogDepartment {
  value: string;
  label: string;
  count: number;
}

interface CatalogState {
  status: CatalogStatus;
  catalog: CatalogArtifact | null;
  etag: string | null;
  error: string | null;
  sessionsKey: string | null;
  departments: CatalogDepartment[];
  levels: string[];
  loadCatalog: (sessions: string[]) => Promise<void>;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  status: "idle",
  catalog: null,
  etag: null,
  error: null,
  sessionsKey: null,
  departments: [],
  levels: [],
  loadCatalog: async (sessions) => {
    const normalizedSessions = normalizeSessions(sessions);
    const key = normalizedSessions.join(",");
    const cached = await readCachedCatalog(key);

    if (cached) {
      setCatalogReady(set, cached.body, cached.etag, key, null);
    } else if (get().sessionsKey !== key || get().status === "idle") {
      set({
        status: "loading",
        catalog: null,
        etag: null,
        error: null,
        sessionsKey: key,
        departments: [],
        levels: [],
      });
    }

    try {
      const response = await fetchCatalog(normalizedSessions, cached?.etag ?? null);

      if (response.status === 304) {
        const current = get();

        if (cached || (current.catalog && current.sessionsKey === key)) {
          set({
            status: "ready",
            error: null,
            sessionsKey: key,
          });
          return;
        }

        throw new Error("Catalog was not modified but no cached catalog exists");
      }

      if (response.status === 404) {
        set({
          status: "empty",
          catalog: null,
          etag: null,
          error: null,
          sessionsKey: key,
          departments: [],
          levels: [],
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`Catalog request failed with HTTP ${response.status}`);
      }

      const body = parseCatalogArtifact(await response.json());
      const etag = response.headers.get("ETag");
      await putCatalogCache<CatalogArtifact>({
        key,
        etag,
        body,
        updatedAt: new Date().toISOString(),
      });
      setCatalogReady(set, body, etag, key, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (cached) {
        set({ status: "ready", error: message, sessionsKey: key });
        return;
      }

      set({
        status: "error",
        catalog: null,
        etag: null,
        error: message,
        sessionsKey: key,
        departments: [],
        levels: [],
      });
    }
  },
}));

function fetchCatalog(sessions: string[], etag: string | null): Promise<Response> {
  const params = new URLSearchParams({ sessions: sessions.join(",") });
  const headers = new Headers();

  if (etag) {
    headers.set("If-None-Match", etag);
  }

  return fetch(`/api/catalog?${params.toString()}`, { headers });
}

async function readCachedCatalog(
  key: string,
): Promise<{ body: CatalogArtifact; etag: string | null } | null> {
  try {
    const cached = await getCatalogCache<CatalogArtifact>(key);

    if (!cached) {
      return null;
    }

    return {
      body: cached.body,
      etag: cached.etag,
    };
  } catch {
    return null;
  }
}

function setCatalogReady(
  set: (partial: Partial<CatalogState>) => void,
  catalog: CatalogArtifact,
  etag: string | null,
  sessionsKey: string,
  error: string | null,
): void {
  set({
    status: "ready",
    catalog,
    etag,
    error,
    sessionsKey,
    departments: deriveDepartments(catalog.courses),
    levels: deriveLevels(catalog.courses),
  });
}

function deriveDepartments(courses: readonly Course[]): CatalogDepartment[] {
  const departments = new Map<string, CatalogDepartment>();

  courses.forEach((course) => {
    const value = course.department.code || course.department.name;
    const current = departments.get(value);

    departments.set(value, {
      value,
      label:
        course.department.code && course.department.name
          ? `${course.department.code} · ${course.department.name}`
          : course.department.name || course.department.code,
      count: (current?.count ?? 0) + 1,
    });
  });

  return [...departments.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function deriveLevels(courses: readonly Course[]): string[] {
  const levels = new Set<string>();

  courses.forEach((course) => {
    const level = getCourseLevel(course);

    if (level) {
      levels.add(level);
    }
  });

  return [...levels].sort();
}

function normalizeSessions(sessions: string[]): string[] {
  return sessions
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
}

function parseCatalogArtifact(value: unknown): CatalogArtifact {
  if (!isRecord(value)) {
    throw new Error("Catalog response must be an object");
  }

  const sessions = value.sessions;
  const scrapedAt = value.scrapedAt;
  const total = value.total;
  const courses = value.courses;

  if (
    !Array.isArray(sessions) ||
    !sessions.every((session) => typeof session === "string") ||
    typeof scrapedAt !== "string" ||
    typeof total !== "number" ||
    !Array.isArray(courses)
  ) {
    throw new Error("Catalog response has an unexpected shape");
  }

  return {
    sessions,
    scrapedAt,
    total,
    courses: courses as Course[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
