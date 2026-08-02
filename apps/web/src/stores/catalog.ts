import type {
  CatalogDeltaCursor,
  CatalogUpdatesResponse,
  Course,
  CourseRefreshPendingResponse,
  CourseRefreshResponse,
  DivisionalEnrolmentIndicators,
} from "@better-ttb/shared";
import { create } from "zustand";

import { getCatalogCache, putCatalogCache } from "@/lib/idb";
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
  deltaCursor: CatalogDeltaCursor | null;
  loadCatalog: (sessions: string[]) => Promise<void>;
  refreshCourse: (course: Course) => Promise<CourseRefreshResponse>;
}

const catalogLoads = new Map<string, Promise<void>>();
const courseRefreshes = new Map<string, Promise<CourseRefreshResponse>>();

export class CourseRefreshRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Refresh failed with HTTP ${status}`);
    this.name = "CourseRefreshRequestError";
  }
}

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
  deltaCursor: null,
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
  refreshCourse: (course) => {
    const current = get();
    const catalog = current.catalog;

    if (!catalog) {
      return Promise.reject(
        new Error("Cannot refresh a course before its catalog is loaded"),
      );
    }

    const requestedSessionsKey =
      current.sessionsKey ?? normalizeSessions(catalog.sessions).join(",");
    const refreshKey = `${requestedSessionsKey}:${course.id}`;
    const existing = courseRefreshes.get(refreshKey);
    if (existing) {
      return existing;
    }

    const refresh = (async () => {
      const refreshed = await requestCourseRefresh(course, catalog.sessions);
      const latest = get();

      // A navigation may have loaded a different session catalog while the
      // refresh request was waiting on another course's claim. The D1 write is
      // still durable, but it must not be merged into an unrelated catalog.
      if (
        latest.sessionsKey !== null &&
        latest.sessionsKey !== requestedSessionsKey
      ) {
        return refreshed;
      }

      const latestCatalog = latest.catalog ?? catalog;
      const courses = mergeCourses(latestCatalog.courses, [refreshed.course]);
      const nextCatalog = { ...latestCatalog, courses };
      const sessionsKey = latest.sessionsKey ?? requestedSessionsKey;

      setCatalogReady(
        set,
        nextCatalog,
        latest.etag,
        sessionsKey,
        latest.error,
        latest.deltaCursor,
      );
      try {
        await putCatalogCache<CatalogArtifact>({
          key: sessionsKey,
          etag: latest.etag,
          body: nextCatalog,
          updatedAt: new Date().toISOString(),
          ...(latest.deltaCursor ? { deltaCursor: latest.deltaCursor } : {}),
        });
      } catch {
        // The D1 update is already durable; a later delta fetch repairs this cache.
      }
      return refreshed;
    })().finally(() => {
      courseRefreshes.delete(refreshKey);
    });
    courseRefreshes.set(refreshKey, refresh);
    return refresh;
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
    setCatalogReady(
      set,
      cached.body,
      cached.etag,
      key,
      null,
      cached.deltaCursor,
    );
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
      deltaCursor: null,
    });
  }

  try {
    const response = await fetchCatalog(
      normalizedSessions,
      get().sessionsKey === key ? get().etag : cached?.etag ?? null,
    );

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
        deltaCursor: null,
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    if (!response.ok && response.status !== 304) {
      throw new Error(`Catalog request failed with HTTP ${response.status}`);
    }

    const current = get();
    let body: CatalogArtifact;
    let etag: string | null;
    let deltaCursor: CatalogDeltaCursor;
    if (response.status === 304) {
      const source =
        current.sessionsKey === key && current.catalog
          ? {
              body: current.catalog,
              etag: current.etag,
              deltaCursor: current.deltaCursor,
            }
          : cached;
      if (!source) {
        throw new Error("Catalog was not modified but no cached catalog exists");
      }
      body = source.body;
      etag = source.etag;
      deltaCursor = source.deltaCursor ?? {
        updatedAt: body.scrapedAt,
        id: "",
      };
    } else {
      body = parseCatalogArtifact(await response.json());
      etag = response.headers.get("ETag");
      deltaCursor = { updatedAt: body.scrapedAt, id: "" };
    }

    let deltaError: string | null = null;
    try {
      const deltas = await fetchCatalogUpdates(normalizedSessions, deltaCursor);
      body = { ...body, courses: mergeCourses(body.courses, deltas.courses) };
      deltaCursor = deltas.cursor;
    } catch (error) {
      deltaError = error instanceof Error ? error.message : String(error);
    }
    await putCatalogCache<CatalogArtifact>({
      key,
      etag,
      body,
      updatedAt: new Date().toISOString(),
      deltaCursor,
    });

    if (get().sessionsKey !== key) {
      return;
    }

    setCatalogReady(set, body, etag, key, deltaError, deltaCursor);
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
      deltaCursor: null,
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
): Promise<{
  body: CatalogArtifact;
  etag: string | null;
  deltaCursor: CatalogDeltaCursor | null;
} | null> {
  try {
    const cached = await getCatalogCache<CatalogArtifact>(key);

    if (!cached) {
      return null;
    }

    return {
      body: cached.body,
      etag: cached.etag,
      deltaCursor: cached.deltaCursor ?? null,
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
  deltaCursor: CatalogDeltaCursor | null,
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
    deltaCursor,
  });
}

async function fetchCatalogUpdates(
  sessions: string[],
  initialCursor: CatalogDeltaCursor,
): Promise<{ courses: Course[]; cursor: CatalogDeltaCursor }> {
  const courses: Course[] = [];
  let cursor = initialCursor;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      sessions: sessions.join(","),
      afterUpdatedAt: cursor.updatedAt,
      afterId: cursor.id,
    });
    const response = await fetch(`/api/catalog/updates?${params.toString()}`, {
      cache: "no-cache",
    });
    if (!response.ok) {
      throw new Error(`Catalog updates request failed with HTTP ${response.status}`);
    }
    const body = parseCatalogUpdatesResponse(await response.json());
    courses.push(...body.courses);
    cursor = body.nextCursor;
    if (!body.hasMore) {
      return { courses, cursor };
    }
  }

  throw new Error("Catalog updates exceeded the pagination safety limit");
}

async function requestCourseRefresh(
  course: Course,
  catalogSessions: string[],
): Promise<CourseRefreshResponse> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`/api/course/${encodeURIComponent(course.code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: course.id,
        sectionCode: course.sectionCode,
        sessions: catalogSessions,
      }),
    });
    if (response.status === 202) {
      if (attempt >= 3) {
        throw new Error("Course refresh is still in progress");
      }
      const pending = (await response.json()) as CourseRefreshPendingResponse;
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const requested =
        Number.isFinite(seconds) && seconds > 0
          ? seconds
          : pending.retryAfterSeconds || 2;
      await delay(1_000 * Math.min(Math.max(requested, 1), 10));
      continue;
    }
    if (!response.ok) {
      throw new CourseRefreshRequestError(
        response.status,
        parseRetryAfterSeconds(response.headers.get("Retry-After")),
      );
    }
    return parseCourseRefreshResponse(await response.json());
  }
  // The loop returns or throws on every iteration; retained for TypeScript's
  // control-flow analysis.
  throw new Error("Course refresh is still in progress");
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function parseCourseRefreshResponse(value: unknown): CourseRefreshResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.course) ||
    typeof value.course.id !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.cached !== "boolean"
  ) {
    throw new Error("Course refresh response has an unexpected shape");
  }
  return value as unknown as CourseRefreshResponse;
}

function parseCatalogUpdatesResponse(value: unknown): CatalogUpdatesResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.courses) ||
    !isRecord(value.nextCursor) ||
    typeof value.nextCursor.updatedAt !== "string" ||
    typeof value.nextCursor.id !== "string" ||
    typeof value.hasMore !== "boolean"
  ) {
    throw new Error("Catalog updates response has an unexpected shape");
  }
  return value as unknown as CatalogUpdatesResponse;
}

function mergeCourses(base: readonly Course[], updates: readonly Course[]): Course[] {
  if (updates.length === 0) {
    return [...base];
  }
  const merged = [...base];
  const byId = new Map(merged.map((course, index) => [course.id, index]));

  for (const update of updates) {
    let index = byId.get(update.id);
    if (index === undefined) {
      index = merged.findIndex((candidate) => sameOffering(candidate, update));
    }
    if (index >= 0) {
      const previous = merged[index];
      merged[index] = update;
      if (previous && previous.id !== update.id) {
        byId.delete(previous.id);
      }
      byId.set(update.id, index);
    } else {
      byId.set(update.id, merged.length);
      merged.push(update);
    }
  }
  return merged;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
