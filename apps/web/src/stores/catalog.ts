import type {
  Course,
  DivisionalEnrolmentIndicators,
  TtbCourseLookupResponse,
} from "@better-ttb/shared";
import { create } from "zustand";

import { getCatalogCache, putCatalogCache } from "@/lib/idb";
import { extractLiveCourse } from "@/lib/live-course";
import { getCourseLevel } from "@/lib/search";

export type CatalogStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface CatalogArtifact {
  sessions: string[];
  scrapedAt: string;
  total: number;
  courses: Course[];
  divisionalEnrolmentIndicators?: DivisionalEnrolmentIndicators;
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
  divisionalEnrolmentIndicators: DivisionalEnrolmentIndicators;
  lastCheckedAt: string | null;
  loadCatalog: (sessions: string[]) => Promise<void>;
  refreshCourse: (course: Course) => Promise<Course>;
}

const catalogLoads = new Map<string, Promise<void>>();

export const useCatalogStore = create<CatalogState>((set, get) => ({
  status: "idle",
  catalog: null,
  etag: null,
  error: null,
  sessionsKey: null,
  departments: [],
  levels: [],
  divisionalEnrolmentIndicators: {},
  lastCheckedAt: null,
  loadCatalog: (sessions) => {
    const normalizedSessions = normalizeSessions(sessions);
    const key = normalizedSessions.join(",");
    const existing = catalogLoads.get(key);

    if (existing) {
      return existing;
    }

    const load = loadCatalog(normalizedSessions, key, set, get).finally(() => {
      catalogLoads.delete(key);
    });
    catalogLoads.set(key, load);
    return load;
  },
  refreshCourse: async (course) => {
    const params = new URLSearchParams({ sectionCode: course.sectionCode });
    const response = await fetch(`/api/course/${course.code}?${params.toString()}`, {
      cache: "no-cache",
    });

    if (!response.ok) {
      throw new Error(`Refresh failed with HTTP ${response.status}`);
    }

    const liveCourse = extractLiveCourse(
      (await response.json()) as TtbCourseLookupResponse,
      course,
    );

    if (!liveCourse) {
      throw new Error("Live course response did not include an unambiguous matching offering");
    }

    const current = get();
    const catalog = current.catalog;

    if (!catalog) {
      throw new Error("Cannot refresh a course before its catalog is loaded");
    }

    let replaced = false;
    const courses = catalog.courses.map((candidate) => {
      if (sameOffering(candidate, course)) {
        replaced = true;
        return liveCourse;
      }

      return candidate;
    });

    if (!replaced) {
      throw new Error("The refreshed offering is not present in the loaded catalog");
    }

    setCatalogReady(
      set,
      { ...catalog, courses },
      current.etag,
      current.sessionsKey ?? normalizeSessions(course.sessions).join(","),
      null,
    );
    return liveCourse;
  },
}));

async function loadCatalog(
  normalizedSessions: string[],
  key: string,
  set: (partial: Partial<CatalogState>) => void,
  get: () => CatalogState,
): Promise<void> {
  const currentAtStart = get();
  const hasCurrentCatalog =
    currentAtStart.sessionsKey === key && currentAtStart.catalog !== null;
  const cached = await readCachedCatalog(key);

  if (cached && !hasCurrentCatalog) {
    setCatalogReady(set, cached.body, cached.etag, key, null);
  } else if (!hasCurrentCatalog && !cached) {
    set({
      status: "loading",
      catalog: null,
      etag: null,
      error: null,
      sessionsKey: key,
      departments: [],
      levels: [],
      divisionalEnrolmentIndicators: {},
    });
  }

  try {
    const response = await fetchCatalog(
      normalizedSessions,
      get().sessionsKey === key ? get().etag : cached?.etag ?? null,
    );

    if (response.status === 304) {
      const current = get();

      if (current.sessionsKey !== key) {
        return;
      }

      if (cached || (current.catalog && current.sessionsKey === key)) {
        set({
          status: "ready",
          error: null,
          sessionsKey: key,
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }

      throw new Error("Catalog was not modified but no cached catalog exists");
    }

    if (response.status === 404) {
      if (get().sessionsKey !== key) {
        return;
      }

      set({
        status: "empty",
        catalog: null,
        etag: null,
        error: null,
        sessionsKey: key,
        departments: [],
        levels: [],
        divisionalEnrolmentIndicators: {},
        lastCheckedAt: new Date().toISOString(),
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

    if (get().sessionsKey !== key) {
      return;
    }

    setCatalogReady(set, body, etag, key, null);
    set({ lastCheckedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (cached || (get().catalog && get().sessionsKey === key)) {
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
      divisionalEnrolmentIndicators: {},
    });
  }
}

function fetchCatalog(sessions: string[], etag: string | null): Promise<Response> {
  const params = new URLSearchParams({ sessions: sessions.join(",") });
  const headers = new Headers();

  if (etag) {
    headers.set("If-None-Match", etag);
  }

  return fetch(`/api/catalog?${params.toString()}`, {
    headers,
    cache: "no-cache",
  });
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
    divisionalEnrolmentIndicators: catalog.divisionalEnrolmentIndicators ?? {},
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

function sameOffering(left: Course, right: Course): boolean {
  if (left.id === right.id) {
    return true;
  }

  if (left.code !== right.code || left.sectionCode !== right.sectionCode) {
    return false;
  }

  if (left.sessions.length !== right.sessions.length) {
    return false;
  }

  const rightSessions = new Set(right.sessions);
  return left.sessions.every((session) => rightSessions.has(session));
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

  const divisionalEnrolmentIndicators = parseDivisionalEnrolmentIndicators(
    value.divisionalEnrolmentIndicators,
  );

  return {
    sessions,
    scrapedAt,
    total,
    courses: courses as Course[],
    ...(divisionalEnrolmentIndicators
      ? { divisionalEnrolmentIndicators }
      : {}),
  };
}

function parseDivisionalEnrolmentIndicators(
  value: unknown,
): DivisionalEnrolmentIndicators | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: DivisionalEnrolmentIndicators = {};

  for (const [division, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    const indicators = entries.filter(
      (entry): entry is { code: string; name: string } =>
        isRecord(entry) &&
        typeof entry.code === "string" &&
        typeof entry.name === "string",
    );

    if (indicators.length > 0) {
      result[division] = indicators;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
